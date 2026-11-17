// Écran de veille façon Steam (« Big Art ») : après quelques minutes sans activité dans KaneMode, les
// grandes illustrations des jeux défilent lentement en fondu, avec leur logo et l'heure. Le premier
// bouton ferme l'écran de veille sans rien déclencher d'autre. Délai : Paramètres → Veille.
import { locale } from './i18n.js';
import { $, el, esc, lib, settings } from './core.js';
import { inputLock } from './nav.js';

const SLIDE_MS = 9000;
let layer = null, timer = 0, clockTimer = 0, queue = [], shown = false, front = 0;

/** Jeux avec une grande illustration : les derniers joués d'abord, puis le reste au hasard. */
function pickGames() {
  const withArt = lib.games.filter(g => !g.hidden && !g.removed && g.type !== 'app' && g.art && (g.art.hero || g.art.header));
  const when = g => +new Date(g.lastPlayed || 0) || 0;
  const recent = withArt.filter(when).sort((a, b) => when(b) - when(a)).slice(0, 8);
  const rest = withArt.filter(g => !recent.includes(g));
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  return [...recent, ...rest].slice(0, 40);
}

function build() {
  layer = el('div', '', `<div class="ss-slide"></div><div class="ss-slide"></div>
    <div class="ss-info"><div class="ss-title"></div><div class="ss-clock"><b></b><small></small></div></div>`);
  layer.id = 'screensaver';
  layer.setAttribute('aria-hidden', 'true');
  document.body.append(layer);
}

function tick() {
  const now = new Date();
  $('.ss-clock b', layer).textContent = now.toLocaleTimeString(locale, { hour: settings.clock24 ? '2-digit' : 'numeric', minute: '2-digit', hour12: !settings.clock24 });
  $('.ss-clock small', layer).textContent = now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' });
}

function next() {
  if (!shown) return;
  if (!queue.length) queue = pickGames();
  const g = queue.shift();
  const slides = layer.querySelectorAll('.ss-slide');
  const incoming = slides[front], outgoing = slides[1 - front];
  front = 1 - front;
  const title = $('.ss-title', layer);
  if (g) {
    const url = g.art.hero || g.art.header;
    incoming.style.backgroundImage = `url("${String(url).replace(/"/g, '%22')}")`;
    title.innerHTML = g.art.logo ? `<img src="${esc(g.art.logo)}" alt="">` : `<span>${esc(g.name)}</span>`;
  } else {
    incoming.style.backgroundImage = '';
    title.innerHTML = '<span>KaneMode</span>';
  }
  // Relance du zoom lent à chaque image
  incoming.classList.remove('on');
  void incoming.offsetWidth;
  incoming.classList.add('on');
  outgoing.classList.remove('on');
  title.classList.remove('in');
  void title.offsetWidth;
  title.classList.add('in');
}

/** Affiche l'écran de veille (inactivité de KaneMode, voir power.js). */
export function showScreensaver() {
  if (shown) return;
  if (!layer) build();
  shown = true;
  queue = pickGames();
  inputLock.on = true;
  layer.classList.add('open');
  tick();
  next();
  timer = setInterval(next, SLIDE_MS);
  clockTimer = setInterval(tick, 10000);
}

/**
 * Ferme l'écran de veille ; l'appui qui l'a fermé ne déclenche rien d'autre. keepLock : la veille du
 * PC prend la suite et garde les entrées bloquées.
 */
export function hideScreensaver({ keepLock = false } = {}) {
  if (!shown) return false;
  shown = false;
  clearInterval(timer);
  clearInterval(clockTimer);
  layer.classList.remove('open');
  layer.querySelectorAll('.ss-slide').forEach(s => s.classList.remove('on'));
  if (!keepLock) setTimeout(() => { if (!shown) inputLock.on = false; }, 400);
  return true;
}

export const screensaverShown = () => shown;
