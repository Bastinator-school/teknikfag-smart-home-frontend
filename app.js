// Smart Home Control - Vanilla JS
const http_host = "127.0.0.1:8080";

document.addEventListener('DOMContentLoaded', () => {
    initializeLights();
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
    const { room = '', lamp = '', state = '' } = opts;

    // apply explicit state instead of blind toggling
    element.classList.toggle('active', state);
    element.setAttribute('aria-pressed', state ? 'true' : 'false');
    // expose a data-state attribute as "1" or "0" for easy inspection
    const stateStr = state ? '1' : '0';
    element.setAttribute('data-state', stateStr);

    // send update to backend (best-effort)
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

