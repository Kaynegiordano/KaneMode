// Moteur de navigation : pages, couches (menus, dialogues), focus spatial et entrées
// manette / clavier / souris.
import { $, $$, sfx, reduceMotion, settings } from './core.js';

export const DIRS = ['up', 'down', 'left', 'right'];
export const state = { page: null, history: [], layers: [], input: 'kbd', padStyle: 'xbox' };
const pages = {};
export const actions = {};     // actions des éléments statiques (data-action)
export const hooks = {};       // menu, qam, search : fournis par main.js

// ---------- Pages ----------
export function definePage(id, def) {
  def.id = id;
  def.el = $('#page-' + id);
  pages[id] = def;
  return def;
}
export const page = id => pages[id];
export const currentPage = () => pages[state.page];

export function go(id, params = {}, { push = true } = {}) {
  const from = pages[state.page], to = pages[id];
  if (!to) return;
  if (from) {
    from.savedFocus = focused && from.el.contains(focused) ? keyOf(focused) : from.savedFocus;
    if (push && from !== to) state.history.push({ id: from.id, params: from.params, focus: from.savedFocus });
    from.el.classList.remove('active');
    from.leave && from.leave();
  }
  to.params = params;
  state.page = id;
  to.el.classList.add('active');
  if (from !== to) to.el.scrollTop = 0;
  to.render(params);
  $('#page-title').textContent = to.title ? to.title(params) : '';
  $$('#menu [data-page]').forEach(m => m.classList.toggle('current', m.dataset.page === id));
  focusIn(to.el, params.focus || (from === to ? keyOf(focused) : null));
  renderHints();
}

/** Re-rend la page courante (données changées) en conservant le focus. */
export function refresh() {
  const p = currentPage();
  if (!p) return;
  const key = focused && p.el.contains(focused) ? keyOf(focused) : null;
  const top = p.el.scrollTop;
  p.render(p.params);
  p.el.scrollTop = top;
  if (!state.layers.length) focusIn(p.el, key, { scroll: false });
  renderHints();
}

export function back() {
  const L = topLayer();
  if (L) { sfx('back'); return closeLayer(L); }
  const p = currentPage();
  if (p.back && p.back() === true) return;
  if (!state.history.length) return;
  sfx('back');
  const h = state.history.pop();
  pages[h.id].savedFocus = h.focus;
  go(h.id, { ...h.params, focus: h.focus }, { push: false });
}

/** Retire de l'historique les pages d'un parcours terminé (ex. assistant d'ajout). */
export function dropHistory(ids) { state.history = state.history.filter(h => !ids.includes(h.id)); }
export function resetHistory() { state.history = []; }

// ---------- Couches ----------
export const topLayer = () => state.layers[state.layers.length - 1];

export function openLayer(layer) {
  layer.returnFocus = focused;
  state.layers.push(layer);
  layer.el.classList.add('open');
  if (layer.scrim) $('#scrim').classList.add('show');
  layer.onOpen && layer.onOpen();
  sfx('open');
  focusIn(layer.el, layer.focusKey, { scroll: false });
  renderHints();
  return layer;
}
export function closeLayer(layer = topLayer(), result) {
  if (!layer) return;
  state.layers = state.layers.filter(l => l !== layer);
  layer.el.classList.remove('open');
  if (!state.layers.some(l => l.scrim)) $('#scrim').classList.remove('show');
  if (layer.returnFocus && layer.returnFocus.isConnected) setFocus(layer.returnFocus, { scroll: false, sound: false });
  else focusIn(scope());
  layer.onClose && layer.onClose(result);
  renderHints();
}

export const scope = () => (topLayer() ? topLayer().el : currentPage() ? currentPage().el : document.body);

// ---------- Focus ----------
export let focused = null;
const keyOf = e => (e && e.dataset ? e.dataset.key || null : null);

export const navItems = (root = scope()) => $$('[data-nav]', root).filter(e => e.offsetParent !== null || e.getClientRects().length);

export function focusIn(root, key, opts) {
  const items = navItems(root);
  const target = (key && items.find(e => e.dataset.key === key)) || items.find(e => e.dataset.autofocus != null) || items[0];
  if (target) setFocus(target, { sound: false, ...opts });
}

export function setFocus(target, { scroll = true, sound = true } = {}) {
  if (!target) return;
  if (target !== focused) {
    if (focused) focused.classList.remove('focused');
    focused = target;
    target.classList.add('focused');
    if (sound) sfx('move');
  }
  if (scroll) target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  const owner = topLayer() || currentPage();
  if (owner && owner.onFocus) owner.onFocus(target);
}

export function move(dir) {
  const items = navItems();
  if (!items.length) return;
  if (!focused || !items.includes(focused)) return setFocus(items[0]);
  if (focused._dir && focused._dir(dir) === true) return; // ex. curseurs
  const r = focused.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const cands = [];
  for (const e of items) {
    if (e === focused) continue;
    const c = e.getBoundingClientRect();
    const ex = c.left + c.width / 2, ey = c.top + c.height / 2;
    let gap, off;
    if (dir === 'left' || dir === 'right') {
      if (dir === 'right' ? ex <= cx + 1 : ex >= cx - 1) continue;
      if (c.bottom <= r.top + 4 || c.top >= r.bottom - 4) continue; // même rangée
      gap = dir === 'right' ? c.left - r.right : r.left - c.right;
      off = Math.abs(ey - cy);
    } else {
      if (dir === 'down' ? ey <= cy + 1 : ey >= cy - 1) continue;
      gap = dir === 'down' ? c.top - r.bottom : r.top - c.bottom;
      off = Math.abs(ex - cx);
    }
    cands.push({ e, gap, off });
  }
  if (!cands.length) return;
  const min = Math.min(...cands.map(c => c.gap));
  setFocus(cands.filter(c => c.gap <= min + 30).sort((a, b) => a.off - b.off)[0].e);
}

/** Rend un élément navigable ; `act` est appelé à la validation. */
export function nav(elm, act, key) {
  elm.dataset.nav = '';
  if (key != null) elm.dataset.key = key;
  if (act) elm._act = act;
  return elm;
}

export function activate(t) {
  if (!t || !scope().contains(t)) return;
  const sound = t.dataset.sfx || 'select';
  if (t._act) { sfx(sound); return t._act(t); }
  const a = t.dataset.action && actions[t.dataset.action];
  if (a) { sfx(sound); a(t); }
}

// ---------- Dispatch des boutons ----------
export const inputLock = { on: false }; // vrai pendant la vidéo de démarrage
export function press(k) {
  if (inputLock.on) return;
  const L = topLayer(), P = currentPage();
  const owner = L || P;
  if (owner && owner.button && owner.button(k) === true) return;
  if (DIRS.includes(k)) return move(k);
  switch (k) {
    case 'a': return activate(focused);
    case 'b': return back();
    case 'menu':
      if (L && L.name === 'menu') return closeLayer(L);
      if (L && L.name !== 'qam') return;
      if (L) closeLayer(L);
      return hooks.menu && hooks.menu();
    case 'view':
      if (L && L.name === 'qam') return closeLayer(L);
      if (L && L.name !== 'menu') return;
      if (L) closeLayer(L);
      return hooks.qam && hooks.qam();
    case 'y':
      if (!L && state.page !== 'search') return go('search');
  }
}

// ---------- Indications de boutons ----------
const G = {
  xbox: { a: 'a|A', b: 'b|B', x: 'x|X', y: 'y|Y', lb: '|LB', rb: '|RB', lt: '|LT', rt: '|RT' },
  ps: { a: 'ps-a|✕', b: 'ps-b|○', x: 'ps-x|□', y: 'ps-y|△', lb: '|L1', rb: '|R1', lt: '|L2', rt: '|R2' },
  kbd: { a: 'key|Entrée', b: 'key|Échap', x: 'key|X', y: 'key|Y', lb: 'key|Pg↑', rb: 'key|Pg↓', lt: 'key|Début', rt: 'key|Fin', menu: 'key|M', view: 'key|Q' },
};
export function glyph(k) {
  const style = settings.padGlyphs === 'auto' ? state.padStyle : settings.padGlyphs;
  const set = state.input === 'pad' ? G[style] : G.kbd;
  if (state.input === 'pad' && (k === 'menu' || k === 'view')) return `<span class="glyph"><svg><use href="#i-${k === 'menu' ? 'menu' : 'more'}"/></svg></span>`;
  const [cls, label] = (set[k] || '|' + k).split('|');
  return `<span class="glyph ${cls}">${label}</span>`;
}

export function renderHints() {
  const L = topLayer(), P = currentPage();
  const h = (k, label) => {
    const keys = Array.isArray(k) ? k : [k];
    return `<span class="hint" data-hint="${keys[0]}">${keys.map(glyph).join('')}<span>${label}</span></span>`;
  };
  const right = (L && L.hints ? L.hints() : P && P.hints ? P.hints(P.params) : [['a', 'Sélectionner'], ['b', 'Retour']]);
  const left = L && L.noGlobal ? [] : [['menu', 'Menu'], ['view', '<span class="label-long">Accès rapide</span>']];
  $('#hints').innerHTML = `<span class="left">${left.map(x => h(...x)).join('')}</span>${right.map(x => h(...x)).join('')}`;
  $$('.shoulder[data-glyph]').forEach(s => { s.innerHTML = glyph(s.dataset.glyph); });
}

function setInput(mode, padStyle) {
  document.body.classList.toggle('pad-mode', mode === 'pad');
  const changed = mode !== state.input || (padStyle && padStyle !== state.padStyle);
  state.input = mode;
  if (padStyle) state.padStyle = padStyle;
  if (changed) renderHints();
}

// ---------- Clavier physique ----------
const KEYS = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Enter: 'a', ' ': 'a', Escape: 'b', Backspace: 'b',
  m: 'menu', M: 'menu', q: 'view', Q: 'view', x: 'x', X: 'x', f: 'x', F: 'x', y: 'y', Y: 'y', '/': 'y',
  PageUp: 'lb', PageDown: 'rb', Home: 'lt', End: 'rt',
};
addEventListener('keydown', e => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  // Saisie de texte (clavier virtuel ou recherche) : les caractères vont au champ.
  const typing = (topLayer() && topLayer().typing) || (!topLayer() && currentPage() && currentPage().typing);
  if (typing && typing(e) === true) { e.preventDefault(); setInput('kbd'); return; }
  const k = KEYS[e.key];
  if (!k) return;
  e.preventDefault();
  setInput('kbd');
  press(k);
});

// Coller du texte (Ctrl+V) dans un champ : utile pour une clé API.
document.addEventListener('paste', e => {
  const t = (topLayer() && topLayer().onPaste) || (!topLayer() && currentPage() && currentPage().onPaste);
  if (t) { e.preventDefault(); t(e.clipboardData.getData('text').trim()); }
});

// ---------- Manette (API Gamepad, disposition standard) ----------
const PAD = { 0: 'a', 1: 'b', 2: 'x', 3: 'y', 4: 'lb', 5: 'rb', 6: 'lt', 7: 'rt', 8: 'view', 9: 'menu', 10: 'l3', 11: 'r3', 12: 'up', 13: 'down', 14: 'left', 15: 'right', 16: 'menu' };
export const padLive = { id: '', buttons: [], axes: [0, 0, 0, 0], connected: 0 };
const held = {};
const armed = {};
// Certains pilotes signalent un stick en butée tant qu'il n'a pas bougé :
// un axe n'est pris en compte qu'après être passé une fois par le centre.
const axis = (p, i) => {
  const v = p.axes[i] || 0, key = p.index + ':' + i;
  if (Math.abs(v) < 0.3) armed[key] = true;
  return armed[key] ? v : 0;
};
const isSony = id => /054c|playstation|dualsense|dualshock|wireless controller/i.test(id);

function poll() {
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const now = performance.now();
  const down = new Set();
  let source = null;
  padLive.connected = pads.length;
  for (const p of pads) {
    const before = down.size;
    p.buttons.forEach((b, i) => { if (b.pressed && PAD[i]) down.add(PAD[i]); });
    const x = axis(p, 0), y = axis(p, 1);
    if (x < -0.55) down.add('left');
    if (x > 0.55) down.add('right');
    if (y < -0.55) down.add('up');
    if (y > 0.55) down.add('down');
    if (down.size > before || !source) {
      source = p;
      padLive.id = p.id;
      padLive.buttons = p.buttons.map(b => b.pressed);
      padLive.axes = [axis(p, 0), axis(p, 1), axis(p, 2), axis(p, 3)];
    }
  }
  for (const k of down) {
    if (!held[k]) {
      held[k] = now + 380; // délai avant répétition
      setInput('pad', source && isSony(source.id) ? 'ps' : 'xbox');
      press(k);
    } else if (DIRS.includes(k) && now >= held[k]) {
      held[k] = now + 90;
      press(k);
    }
  }
  for (const k in held) if (!down.has(k)) delete held[k];
  requestAnimationFrame(poll);
}
requestAnimationFrame(poll);

// ---------- Souris ----------
document.addEventListener('mousemove', e => {
  if (document.body.classList.contains('pad-mode')) setInput('kbd');
  const t = e.target.closest('[data-nav]');
  if (t && scope().contains(t) && t !== focused) setFocus(t, { scroll: false, sound: false });
});
document.addEventListener('click', e => {
  const hint = e.target.closest('[data-hint]');
  if (hint) return press(hint.dataset.hint);
  if (e.target.id === 'scrim') return closeLayer();
  const t = e.target.closest('[data-nav]');
  if (t && scope().contains(t)) {
    setFocus(t, { scroll: false, sound: false });
    if (t._click) return t._click(e);
    activate(t);
  }
});
