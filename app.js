// Smart Home Control - Vanilla JS
const http_host = "127.0.0.1:8080";

document.addEventListener('DOMContentLoaded', () => {
    initializeLights();
    initializeWebSocket();
});

function initializeLights() {
    const lights = document.querySelectorAll('.light');
    lights.forEach(light => {
        light.addEventListener('click', () => {
            // determine next state (true = on)
            const nextState = !light.classList.contains('active');

            // read room and lamp from data- attributes or fallback to plain attributes
            const room = light.dataset.room || light.getAttribute('room') || '';
            const lamp = light.dataset.light || light.getAttribute('data-light') || light.id || '';

            // pass the element itself instead of relying on an id
            toggleLight(light, { room, lamp, state: nextState });
        });
    });
}

/**
 * Toggle a light element to the given state and notify the backend.
 * @param {HTMLElement} element
 * @param {{room:string, lamp:string, state:boolean}} opts
 */
function toggleLight(element, opts) {
    // opts: { room, lamp, state, send }
    // `send` controls whether this function POSTs the change to the backend.
    // When updates originate from the server we call with send: false to avoid
    // creating a feedback loop.
    const { room = '', lamp = '', state = '', send = true } = opts;

    // apply explicit state instead of blind toggling
    const stateStr = state ? '1' : '0';

    // If the element already reflects the requested state, do nothing.
    // This avoids redundant POSTs and UI churn when the backend re-broadcasts state.
    if (element.getAttribute('data-state') === stateStr) return;

    element.classList.toggle('active', state);
    element.setAttribute('aria-pressed', state ? 'true' : 'false');
    // expose a data-state attribute as "1" or "0" for easy inspection
    element.setAttribute('data-state', stateStr);

    // send update to backend (best-effort) unless explicitly disabled
    if (send) {
        try {
            fetch(`http://${http_host}/set_lamp_state`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    Room: room,
                    Lamp: lamp || '',
                    State: stateStr
                })
            }).catch(err => {
                // network errors shouldn't break the UI; log for debugging
                console.warn('Failed to POST light state:', err);
            });
        } catch (err) {
            console.warn('toggleLight error:', err);
        }
    }
}


/**
 * Find a .light element using the topic string sent from the backend.
 * Supports several conventions:
 *  - data-topic attribute exactly equal to topic
 *  - id equal to topic
 *  - topic of the form "room/ lamp", "room.lamp" or "room:lamp" will match
 *    elements with data-room / data-light (or room / data-light attributes)
 * Returns the first matching element or null.
 */
function findLightByTopic(topic) {
    if (!topic) return null;

    // direct data-topic match
    let el = document.querySelector(`.light[data-topic="${topic}"]`);
    if (el) return el;

    // id match
    el = document.getElementById(topic);
    if (el && el.classList && el.classList.contains('light')) return el;

    // Prefer the structured topic format: e.g. "home/kitchen/lights/1/state"
    // Use parts[1] as room (second index) and parts[3] as lamp id (fourth index)
    if (topic.includes('/')) {
        const parts = topic.split('/').filter(p => p.length > 0);
        if (parts.length >= 4) {
            const room = parts[1];
            const lamp = parts[3];
            const candidates = document.querySelectorAll('.light');
            for (const c of candidates) {
                const cRoom = c.dataset.room || c.getAttribute('room') || '';
                const cLamp = c.dataset.light || c.getAttribute('data-light') || c.id || '';
                if (cRoom === room && cLamp === lamp) return c;
            }
        }
    }

    // Fallback: try other separators (., :) or generic last-part logic
    const sep = topic.includes('.') ? '.' : (topic.includes(':') ? ':' : null);
    if (!sep) return null;

    const parts = topic.split(sep);
    // last part is lamp, the rest is room
    const lamp = parts.pop();
    const room = parts.join(sep);

    // match by dataset.room + dataset.light
    const candidates = document.querySelectorAll('.light');
    for (const c of candidates) {
        const cRoom = c.dataset.room || c.getAttribute('room') || '';
        const cLamp = c.dataset.light || c.getAttribute('data-light') || c.id || '';
        if (!cLamp && !cRoom) continue;

        // compare various combinations
        if ((cRoom && cLamp) && (cRoom === room && cLamp === lamp)) return c;
        if ((cRoom && cLamp) && (cRoom === room && cLamp === topic)) return c;
    }

    return null;
}


/**
 * Connect to the backend websocket and listen for updates.
 * When a message arrives it expects JSON with a Payload map containing
 * {"topic": "...", "payload": "1"}
 */
function initializeWebSocket() {
    const wsUrl = `ws://${http_host}/ws`;
    let socket;
    let reconnectTimer = null;

    function connect() {
        socket = new WebSocket(wsUrl);

        socket.addEventListener('open', () => {
            console.info('WebSocket connected to', wsUrl);
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
        });

        socket.addEventListener('message', (ev) => {
            try {
                const msg = JSON.parse(ev.data);

                // Only handle server push messages
                if (msg.type && msg.type !== 'server_push') return;

                // Backend message shape expected:
                // { "type": "server_push", "payload": { "topic": "home/kitchen/lights/1/state", "payload": "1" } }
                const payloadMap = msg.payload || msg.Payload || null;
                if (!payloadMap || typeof payloadMap !== 'object') return;

                const topic = payloadMap.topic || payloadMap.Topic || '';
                const payloadStr = payloadMap.payload || payloadMap.Payload || '';
                if (!topic) return;

                const newState = (payloadStr === '1' || payloadStr === 'true' || payloadStr === 'on');

                // Try to extract room and lamp id from structured topic: home/<room>/lights/<id>/...
                let parsedRoom = '';
                let parsedLamp = '';
                if (topic.includes('/')) {
                    const parts = topic.split('/').filter(p => p.length > 0);
                    if (parts.length >= 4) {
                        parsedRoom = parts[1] || '';
                        parsedLamp = parts[3] || '';
                    }
                }

                // Find the element (findLightByTopic also understands structured topics)
                const el = findLightByTopic(topic);
                if (!el) {
                    console.debug('No .light element found for topic', topic, 'parsedRoom', parsedRoom, 'parsedLamp', parsedLamp);
                    return;
                }

                // prefer parsed values from topic when available
                const room = parsedRoom || el.dataset.room || el.getAttribute('room') || '';
                const lamp = parsedLamp || el.dataset.light || el.getAttribute('data-light') || el.id || '';

                toggleLight(el, { room, lamp, state: newState });
            } catch (err) {
                console.warn('Failed to handle WebSocket message:', err, ev.data);
            }
        });

        socket.addEventListener('close', (ev) => {
            console.warn('WebSocket closed; will attempt reconnect in 2s', ev);
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => connect(), 2000);
        });

        socket.addEventListener('error', (err) => {
            console.warn('WebSocket error', err);
            // close will trigger reconnect
            try { socket.close(); } catch (e) {}
        });
    }

    connect();
}



