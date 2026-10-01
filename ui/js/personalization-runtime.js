// Profils d'écran et mode immersif : uniquement des événements, sans boucle de sondage.
import { $, settings, on, emit, native } from './core.js';
import { state, inputLock, refresh } from './nav.js';
import { immersiveAllowed } from './personalization.js';

let idleTimer = 0, lastPointer = 0;
export function wakeInterface() {
  clearTimeout(idleTimer);
  document.body.classList.remove('immersive-idle');
  if (!settings.immersive || document.hidden) return;
  const delay = Math.max(3, Math.min(30, Number(settings.immersiveDelay) || 6));
  idleTimer = setTimeout(() => {
    if (immersiveAllowed({ enabled: settings.immersive, page: state.page, layers: state.layers.length, locked: inputLock.on,
      busy: !!$('#busy')?.textContent, hidden: document.hidden })) document.body.classList.add('immersive-idle');
  }, delay * 1000);
}
on('activity', wakeInterface);
on('settings', wakeInterface);
on('display', () => { refresh(); wakeInterface(); });
document.addEventListener('keydown', wakeInterface, { capture: true });
document.addEventListener('pointerdown', wakeInterface, { capture: true, passive: true });
document.addEventListener('wheel', wakeInterface, { passive: true });
document.addEventListener('pointermove', event => {
  if (Math.abs(event.movementX) + Math.abs(event.movementY) < 2 || Date.now() - lastPointer < 250) return;
  lastPointer = Date.now(); wakeInterface();
}, { passive: true });
document.addEventListener('visibilitychange', wakeInterface);
native.on(message => { if (['resume', 'wake', 'open', 'home'].includes(message.type)) wakeInterface(); });
// Un téléchargement ou une notification doit rester lisible même sans entrée utilisateur.
new MutationObserver(() => emit('activity')).observe($('#busy'), { childList: true, subtree: true });
setTimeout(wakeInterface, 0);
