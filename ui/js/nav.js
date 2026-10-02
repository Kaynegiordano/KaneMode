// Moteur de navigation : pages, couches (menus, dialogues), focus spatial et entrées
// manette / clavier / souris.
import { t } from './i18n.js';
import { $, $$, sfx, reduceMotion, settings, native, emit } from './core.js';
import { prioritizeArt } from './cards.js';
import { createInputGate } from './input-gate.js';
const inputGate = createInputGate();
let handoffTimer;
const canNavigate = () => inputGate.allows(!document.hidden, document.hasFocus());
export function suspendNavigation() {
  inputGate.suspend(); swallow = true;
  for (const k in startAt) delete startAt[k];
  clearTimeout(handoffTimer);
  // Un moteur qui ne s'ouvre pas ne doit pas bloquer définitivement l'interface.
  handoffTimer = setTimeout(resumeNavigation, 20000);
}
export function resumeNavigation() { clearTimeout(handoffTimer); inputGate.resume(); swallow = true; }
native.on(m => {
  if (m.type === 'background') { suspendNavigation(); clearTimeout(handoffTimer); }
  else if (m.type === 'resume') resumeNavigation();
});

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

export function go(id, params = {}, { push = true, scroll = null } = {}) {
  emit('activity');
  const from = pages[state.page], to = pages[id];
  if (!to) return;
  if (from) {
    from.savedFocus = focused && from.el.contains(focused) ? keyOf(focused) : from.savedFocus;
    if (push && from !== to) state.history.push({ id: from.id, params: from.params, focus: from.savedFocus, scroll: posOf(from.el, 'y') });
    anims.delete(from.el);
    from.el.classList.remove('active');
    from.leave && from.leave();
  }
  to.params = params;
  state.page = id;
  to.el.classList.add('active');
  for (const p of Object.values(pages)) {
    p.el.inert = p !== to;
    p.el.setAttribute('aria-hidden', String(p !== to));
  }
  const keep = from === to ? to.el.scrollTop : 0;
  anims.delete(to.el);
  to.render(params);
  // Retour sur une page : elle revient telle qu'on l'a quittée, sans remonter en haut puis
  // redescendre jusqu'au jeu choisi
  to.el.scrollTop = scroll != null ? scroll : keep;
  $('#page-title').textContent = to.title ? to.title(params) : '';
  $$('#menu [data-page]').forEach(m => m.classList.toggle('current', m.dataset.page === id));
  focusIn(to.el, params.focus || (to.initialFocus && to.initialFocus(params)) || (from === to ? keyOf(focused) : null), { scroll: 'instant' });
  renderHints();
}

/** Re-rend la page courante (données changées) en conservant le focus. */
export function refresh() {
  const p = currentPage();
  if (!p) return;
  const key = focused && p.el.contains(focused) ? keyOf(focused) : null;
  const top = p.el.scrollTop;
  p.render(p.params, { refresh: true });
  p.el.scrollTop = top;
  if (!state.layers.length) focusIn(p.el, key, { scroll: !!key && !p.el.querySelector(`[data-key="${CSS.escape(key)}"]`) });
  renderHints();
}

export function back() {
  const L = topLayer();
  if (L) { sfx('back'); return closeLayer(L); }
  const p = currentPage();
  // Widget Game Bar : pas de pages, B ferme la Game Bar (hooks.back, voir widget.js)
  if (!p) { if (hooks.back) { sfx('back'); hooks.back(); } return; }
  if (p.back && p.back() === true) return;
  if (!state.history.length) return;
  sfx('back');
  const h = state.history.pop();
  pages[h.id].savedFocus = h.focus;
  go(h.id, { ...h.params, focus: h.focus }, { push: false, scroll: h.scroll });
}

/** Retire de l'historique les pages d'un parcours terminé (ex. assistant d'ajout). */
export function dropHistory(ids) { state.history = state.history.filter(h => !ids.includes(h.id)); }
export function resetHistory() { state.history = []; }

// ---------- Couches ----------
export const topLayer = () => state.layers[state.layers.length - 1];

// Une couche modale garde le clavier et le lecteur d'écran dans ses propres contrôles.
function syncLayers() {
  const top = topLayer();
  const background = $('#pages') || $('#hud');
  if (background) background.inert = !!top;
  for (const layer of state.layers) layer.el.inert = layer !== top;
}

export function openLayer(layer) {
  layer.returnFocus = focused;
  state.layers.push(layer);
  emit('activity');
  layer.el.classList.add('open');
  layer.el.setAttribute('aria-hidden', 'false');
  if (layer.el.getAttribute('role') === 'dialog') {
    const title = layer.el.querySelector('h2, .osk-title');
    if (title) layer.el.setAttribute('aria-label', title.textContent);
  }
  syncLayers();
  if (layer.scrim && $('#scrim')) $('#scrim').classList.add('show');
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
  layer.el.inert = true;
  layer.el.setAttribute('aria-hidden', 'true');
  syncLayers();
  if (!state.layers.some(l => l.scrim) && $('#scrim')) $('#scrim').classList.remove('show'); // pas de voile dans le widget Game Bar
  if (layer.returnFocus && layer.returnFocus.isConnected) setFocus(layer.returnFocus, { scroll: false, sound: false });
  else focusIn(scope());
  layer.onClose && layer.onClose(result);
  emit('activity');
  renderHints();
}

export const scope = () => (topLayer() ? topLayer().el : currentPage() ? currentPage().el : document.body);

// ---------- Focus ----------
export let focused = null;
const keyOf = e => (e && e.dataset ? e.dataset.key || null : null);

export const navItems = (root = scope()) => $$('[data-nav]', root).filter(e => !e.disabled && e.getAttribute('aria-disabled') !== 'true' && !e.closest('[inert]') && (e.offsetParent !== null || e.getClientRects().length));

export function focusIn(root, key, opts) {
  const items = navItems(root);
  const target = (key && items.find(e => e.dataset.key === key)) || items.find(e => e.dataset.autofocus != null) || items[0];
  if (target) setFocus(target, { sound: false, ...opts });
}

// Place de l'élément sélectionné dans le contenu de la page (voir move)
let spot = null;
const spotOnScreen = () => spot && { x: spot.x, y: spot.y - (spot.sc ? spot.sc.scrollTop * spot.k : 0) };
export function setFocus(target, { scroll = true, sound = true } = {}) {
  if (!target) return;
  if (target !== focused) {
    if (focused) focused.classList.remove('focused');
    focused = target;
    target.classList.add('focused');
    // Le focus réel suit aussi la sélection : clavier et lecteurs d'écran retrouvent le même contrôle.
    target.tabIndex = -1;
    if (!target.hasAttribute('role') && !target.matches('button, input, select, textarea, a[href]')) target.setAttribute('role', 'button');
    if (target.classList.contains('card')) prioritizeArt(target);
    if (sound) sfx('move');
  }
  if (document.activeElement !== target && target.isConnected && !target.closest('[inert]')) target.focus({ preventScroll: true });
  // Mémoire de position : chaque rangée et chaque zone retient son dernier élément
  const row = target.closest('.row'), zone = target.closest('[data-zone]');
  if (row) row._navLast = target;
  if (zone) zone._navLast = target;
  if (scroll) reveal(target, scroll === 'instant');
  const sc = scrollerOf(target, 'y'), c = target.getBoundingClientRect();
  const k = sc ? sc.getBoundingClientRect().height / sc.offsetHeight || 1 : 1; // CSS zoom (voir reveal)
  spot = { sc, k, x: c.left + c.width / 2, y: c.top + c.height / 2 + (sc ? sc.scrollTop * k : 0) };
  const owner = topLayer() || currentPage();
  if (owner && owner.onFocus) owner.onFocus(target);
}

// ---------- Défilement ----------
// Défilement doux maison. scrollIntoView({behavior:'smooth'}) repartait de zéro à chaque répétition
// d'une direction maintenue (toutes les 90 ms) : la bibliothèque avançait par à-coups. Ici, chaque
// appui déplace seulement la cible ; l'animation en cours la rattrape sans jamais s'arrêter.
const anims = new Map(); // conteneur → { axis, target, last }
function scrollerOf(e, axis) {
  for (let p = e.parentElement; p && p !== document.documentElement; p = p.parentElement) {
    const cs = getComputedStyle(p);
    const o = axis === 'y' ? cs.overflowY : cs.overflowX;
    if ((o === 'auto' || o === 'scroll') && (axis === 'y' ? p.scrollHeight > p.clientHeight + 1 : p.scrollWidth > p.clientWidth + 1)) return p;
  }
  return null;
}
const px = v => parseFloat(v) || 0;
/** Position de défilement de `sc` en cours (ou visée par l'animation). */
const posOf = (sc, axis) => { const a = anims.get(sc); return a && a.axis === axis ? a.target : axis === 'y' ? sc.scrollTop : sc.scrollLeft; };
export function scrollToPos(sc, axis, want, instant) {
  const max = axis === 'y' ? sc.scrollHeight - sc.clientHeight : sc.scrollWidth - sc.clientWidth;
  want = Math.round(Math.max(0, Math.min(max, want)));
  const cur = axis === 'y' ? sc.scrollTop : sc.scrollLeft;
  const set = v => { if (axis === 'y') sc.scrollTop = v; else sc.scrollLeft = v; };
  if (instant || reduceMotion || settings.reduceMotion) { anims.delete(sc); set(want); return; }
  const a = anims.get(sc);
  if (a && a.axis === axis) { a.target = want; return; }
  if (Math.abs(want - cur) < 1) return;
  const anim = { axis, target: want, last: cur, t: performance.now() };
  anims.set(sc, anim);
  // Pas d'images dessinées (page que Chromium croit masquée) : on saute directement à la cible
  const watchdog = setInterval(() => {
    if (anims.get(sc) !== anim) return clearInterval(watchdog);
    if (performance.now() - anim.t > 150) { clearInterval(watchdog); anims.delete(sc); set(anim.target); }
  }, 150);
  const step = now => {
    if (anims.get(sc) !== anim) return;
    const pos = axis === 'y' ? sc.scrollTop : sc.scrollLeft;
    // Défilement par l'utilisateur (molette, doigt) pendant l'animation : on le laisse faire
    if (Math.abs(pos - anim.last) > 3) { anims.delete(sc); return; }
    const dt = Math.min(64, now - anim.t);
    anim.t = now;
    const d = anim.target - pos;
    if (Math.abs(d) < 1) { set(anim.target); anims.delete(sc); return; }
    // Rattrapage exponentiel indépendant de la fréquence de l'écran (60 ou 120 Hz)
    let move = d * (1 - Math.pow(0.78, dt / 16.7));
    if (Math.abs(move) < 1) move = Math.sign(d);
    set(pos + move);
    anim.last = axis === 'y' ? sc.scrollTop : sc.scrollLeft;
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
/** Fait défiler juste assez pour montrer l'élément (marges : scroll-padding du conteneur). */
function reveal(target, instant) {
  for (const axis of ['y', 'x']) {
    const sc = scrollerOf(target, axis);
    if (!sc) continue;
    const cs = getComputedStyle(sc), r = target.getBoundingClientRect(), c = sc.getBoundingClientRect();
    const cur = axis === 'y' ? sc.scrollTop : sc.scrollLeft, pos = posOf(sc, axis);
    const size = axis === 'y' ? sc.clientHeight : sc.clientWidth;
    // Interface agrandie ou réduite (CSS zoom) : les rectangles sont à l'échelle de l'écran, le
    // défilement à celle de la page
    const k = (axis === 'y' ? c.height / sc.offsetHeight : c.width / sc.offsetWidth) || 1;
    // Position de l'élément dans le contenu du conteneur
    const start = (axis === 'y' ? r.top - c.top : r.left - c.left) / k + cur;
    const end = start + (axis === 'y' ? r.height : r.width) / k;
    const padA = px(axis === 'y' ? cs.scrollPaddingTop : cs.scrollPaddingLeft), padB = px(axis === 'y' ? cs.scrollPaddingBottom : cs.scrollPaddingRight);
    let want = pos;
    if (start - padA < want) want = start - padA;
    else if (end + padB > want + size) want = Math.min(start - padA, end + padB - size);
    if (want !== pos) scrollToPos(sc, axis, want, instant);
  }
}

// Dernier élément visité d'un groupe (rangée, zone), s'il est toujours affiché
const lastOf = (group, items) => (group && group._navLast && group._navLast.isConnected && items.includes(group._navLast) ? group._navLast : null);

export function move(dir) {
  // Dans les rangées et grilles, le voisin est connu sans mesurer toute la bibliothèque.
  if (focused && focused.isConnected && scope().contains(focused) && !focused._dir) {
    const group = focused.parentElement;
    if (focused.classList.contains('card') && group && (group.classList.contains('grid') || group.classList.contains('row'))) {
      let candidate;
      if (dir === 'left' || dir === 'right') {
        candidate = dir === 'right' ? focused.nextElementSibling : focused.previousElementSibling;
        if (candidate && group.classList.contains('grid') && candidate.offsetTop !== focused.offsetTop) candidate = null;
      } else if (group.classList.contains('grid')) {
        const columns = getComputedStyle(group).gridTemplateColumns.split(' ').length;
        const index = Array.prototype.indexOf.call(group.children, focused);
        const next = index + (dir === 'down' ? columns : -columns);
        candidate = group.children[next];
        // Dernière ligne incomplète : garder la colonne la plus proche.
        if (!candidate && dir === 'down' && Math.floor(index / columns) < Math.floor((group.children.length - 1) / columns)) candidate = group.lastElementChild;
      }
      if (candidate && candidate.hasAttribute('data-nav') && candidate.getClientRects().length) return setFocus(candidate);
    }
  }
  let items = navItems();
  if (!items.length) return;
  if (!focused || !items.includes(focused)) {
    // Élément sélectionné retiré (bloc redessiné) : on reprend l'élément le plus proche de sa place,
    // au lieu du premier de la page (qui ramenait tout en haut)
    const at = spot && (!spot.sc || (spot.sc.isConnected && scope().contains(spot.sc))) ? spotOnScreen() : null;
    if (!at) return setFocus(items[0]);
    const d = e => { const c = e.getBoundingClientRect(); return Math.hypot(c.left + c.width / 2 - at.x, c.top + c.height / 2 - at.y); };
    return setFocus(items.reduce((a, b) => (d(b) < d(a) ? b : a)));
  }
  if (focused._dir && focused._dir(dir) === true) return; // ex. curseurs
  const vertical = dir === 'up' || dir === 'down';
  // Zones (ex. catégories et réglages des Paramètres) : haut et bas restent dans la zone,
  // gauche et droite passent d'une zone à l'autre.
  const zone = focused.closest('[data-zone]');
  if (vertical && zone) items = items.filter(e => zone.contains(e));
  const r = focused.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const cands = [];
  for (const e of items) {
    if (e === focused) continue;
    const c = e.getBoundingClientRect();
    if (!c.width && !c.height) continue;
    const ex = c.left + c.width / 2, ey = c.top + c.height / 2;
    let gap, off;
    if (!vertical) {
      if (dir === 'right' ? ex <= cx + 1 : ex >= cx - 1) continue;
      if (c.bottom <= r.top + 4 || c.top >= r.bottom - 4) continue; // même rangée
      gap = dir === 'right' ? c.left - r.right : r.left - c.right;
      off = Math.abs(ey - cy);
    } else {
      if (dir === 'down' ? ey <= cy + 1 : ey >= cy - 1) continue;
      gap = dir === 'down' ? c.top - r.bottom : r.top - c.bottom;
      // Un élément dans la même colonne passe avant un élément décalé
      const overlap = Math.min(c.right, r.right) - Math.max(c.left, r.left);
      off = overlap > 0 ? 0 : Math.abs(ex - cx);
    }
    cands.push({ e, gap: Math.max(gap, 0), off });
  }
  // Rien sur la même ligne : gauche et droite rejoignent quand même la zone voisine
  if (!cands.length && !vertical && zone) {
    const others = items.filter(e => {
      const z = e.closest('[data-zone]');
      if (!z || z === zone) return false;
      const c = e.getBoundingClientRect();
      return dir === 'right' ? c.left >= r.right - 1 : c.right <= r.left + 1;
    });
    if (!others.length) return;
    const near = others.slice().sort((a, b) => Math.abs(a.getBoundingClientRect().top - r.top) - Math.abs(b.getBoundingClientRect().top - r.top))[0];
    return setFocus(lastOf(near.closest('[data-zone]'), others) || near);
  }
  // Plus rien dans cette direction : on fait défiler pour montrer ce qui reste (notifications de
  // l'accès rapide, fin d'une page…), sinon ces informations resteraient sous la barre des boutons
  if (!cands.length) { if (vertical) nudgeScroll(focused, dir); return; }
  const min = Math.min(...cands.map(c => c.gap));
  let next = cands.filter(c => c.gap <= min + 30).sort((a, b) => a.off - b.off || a.gap - b.gap)[0].e;
  // Retour dans une rangée ou une zone déjà visitée : on retrouve l'élément quitté
  if (vertical) {
    const row = next.closest('.row');
    if (row && row !== focused.closest('.row')) next = lastOf(row, items) || next;
  } else {
    const z = next.closest('[data-zone]');
    if (z && z !== zone) next = lastOf(z, items) || next;
  }
  setFocus(next);
}

function nudgeScroll(from, dir) {
  for (let e = from.parentElement; e && e !== document.body; e = e.parentElement) {
    const oy = getComputedStyle(e).overflowY;
    if ((oy !== 'auto' && oy !== 'scroll') || e.scrollHeight <= e.clientHeight + 2) continue;
    const pos = posOf(e, 'y');
    const room = dir === 'down' ? e.scrollHeight - e.clientHeight - pos : pos;
    if (room < 2) continue;
    scrollToPos(e, 'y', pos + (dir === 'down' ? 1 : -1) * Math.min(room, e.clientHeight * 0.6));
    return;
  }
}

/** Rend un élément navigable ; `act` est appelé à la validation. */
export function nav(elm, act, key) {
  elm.dataset.nav = '';
  elm.tabIndex = -1;
  if (!elm.hasAttribute('role') && !elm.matches('button, input, select, textarea, a[href]')) elm.setAttribute('role', 'button');
  if (key != null) elm.dataset.key = key;
  if (act) elm._act = act;
  return elm;
}

export function activate(t) {
  if (!canNavigate() || inputLock.on) return;
  if (!t || !scope().contains(t) || t.disabled || t.getAttribute('aria-disabled') === 'true' || t.closest('[inert]')) return;
  const sound = t.dataset.sfx || 'select';
  if (t._act) { sfx(sound); return t._act(t); }
  const a = t.dataset.action && actions[t.dataset.action];
  if (a) { sfx(sound); a(t); }
}

// ---------- Dispatch des boutons ----------
export const inputLock = { on: false }; // vrai pendant la vidéo de démarrage
// Dernière action de l'utilisateur : les mises à jour de fond attendent qu'il ne navigue plus
export const input = { last: 0 };
export function press(k) {
  if (!canNavigate()) return;
  input.last = Date.now();
  emit('activity');
  if (inputLock.on) return;
  const L = topLayer(), P = currentPage();
  const owner = L || P;
  if (owner && owner.button && owner.button(k) === true) return;
  // Widget Game Bar : pas de pages, ses boutons propres (LB / RB : catégories) passent par hooks.button
  if (!owner && hooks.button && hooks.button(k) === true) return;
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
  xbox: { a: 'a|A', b: 'b|B', x: 'x|X', y: 'y|Y', lb: '|LB', rb: '|RB', lt: '|LT', rt: '|RT', left: '|◀', right: '|▶' },
  ps: { a: 'ps-a|✕', b: 'ps-b|○', x: 'ps-x|□', y: 'ps-y|△', lb: '|L1', rb: '|R1', lt: '|L2', rt: '|R2', left: '|◀', right: '|▶' },
  kbd: { a: 'key|' + t('Entrée'), b: 'key|' + t('Échap'), x: 'key|X', y: 'key|Y', lb: 'key|Pg↑', rb: 'key|Pg↓', lt: 'key|' + t('Début'), rt: 'key|' + t('Fin'), menu: 'key|M', view: 'key|Q', left: 'key|←', right: 'key|→' },
};
export function glyph(k) {
  const style = settings.padGlyphs === 'auto' ? state.padStyle : settings.padGlyphs;
  const set = state.input === 'pad' ? G[style] : G.kbd;
  // Menu principal et accès rapide : symbole du bouton Select (deux fenêtres) ou Start (trois traits)
  if (state.input === 'pad' && (k === 'menu' || k === 'view')) return `<span class="glyph"><svg><use href="#i-${padButton(k) === 'select' ? 'view' : 'menu'}"/></svg></span>`;
  const [cls, label] = (set[k] || '|' + k).split('|');
  return `<span class="glyph ${cls}">${label}</span>`;
}

export function renderHints() {
  if (!$('#hints')) return; // widget Game Bar : pas de barre d'indications
  const L = topLayer(), P = currentPage();
  const h = (k, label) => {
    const keys = Array.isArray(k) ? k : [k];
    return `<span class="hint" data-hint="${keys[0]}">${keys.map(glyph).join('')}<span>${label}</span></span>`;
  };
  const right = (L && L.hints ? L.hints() : P && P.hints ? P.hints(P.params) : [['a', t('Sélectionner')], ['b', t('Retour')]]);
  const left = L && L.noGlobal ? [] : [['menu', t('Menu')], ['view', t('<span class="label-long">Accès rapide</span>')]];
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
  if (e.key === 'Tab') {
    e.preventDefault();
    if (inputLock.on) return;
    setInput('kbd');
    input.last = Date.now();
    emit('activity');
    const items = navItems(), index = items.indexOf(focused);
    if (items.length) setFocus(items[index < 0 ? (e.shiftKey ? items.length - 1 : 0) : (index + (e.shiftKey ? -1 : 1) + items.length) % items.length]);
    return;
  }
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
// Select (View / Create) ouvre le menu principal, Start (Menu / Options) l'accès rapide ;
// Paramètres → Manette permet d'inverser.
const PAD = { 0: 'a', 1: 'b', 2: 'x', 3: 'y', 4: 'lb', 5: 'rb', 6: 'lt', 7: 'rt', 8: 'select', 9: 'start', 10: 'l3', 11: 'r3', 12: 'up', 13: 'down', 14: 'left', 15: 'right', 16: 'menu' };
const padAction = k => (k === 'select' ? (settings.padSwap ? 'view' : 'menu') : k === 'start' ? (settings.padSwap ? 'menu' : 'view') : k);
/** Bouton physique d'une action globale (pour les indications) */
const padButton = k => (k === 'menu' ? (settings.padSwap ? 'start' : 'select') : k === 'view' ? (settings.padSwap ? 'select' : 'start') : k);
export const padLive = { id: '', buttons: [], axes: [0, 0, 0, 0], connected: 0 };
let swallow = false;
addEventListener('focus', resumeNavigation);
document.addEventListener('visibilitychange', () => { if (!document.hidden) swallow = true; });
const armed = {};
// Certains pilotes signalent un stick en butée tant qu'il n'a pas bougé :
// un axe n'est pris en compte qu'après être passé une fois par le centre.
const axis = (p, i) => {
  const v = p.axes[i] || 0, key = p.index + ':' + i;
  if (Math.abs(v) < 0.3) armed[key] = true;
  return armed[key] ? v : 0;
};
const isSony = id => /054c|playstation|dualsense|dualshock|wireless controller/i.test(id);

// Manettes XInput lues par l'app native (native/KaneMode.App/XInputPads.cs) : l'API Gamepad de
// WebView2 ne les voyait plus toujours au retour d'une autre application (KanePlay). Les deux sources
// sont lues ensemble : une manette XInput vue par les deux compte une fois (même appui fusionné), et
// une manette vue par une seule marche quand même. En 1.8.0, les manettes de l'app remplaçaient
// celles de WebView2 : sur la ROG Ally X, une manette XInput inactive privait ainsi l'interface de
// la vraie manette.
let xpads = [];
// Boutons XInput → disposition standard de l'API Gamepad (A, B, X, Y, LB, RB, LT, RT, View, Menu, L3, R3, croix)
const XBITS = [0x1000, 0x2000, 0x4000, 0x8000, 0x100, 0x200, -1, -2, 0x20, 0x10, 0x40, 0x80, 0x1, 0x2, 0x4, 0x8, 0x400];
export function setNativePads(list) {
  const next = (Array.isArray(list) ? list : []).map(x => ({
    id: x.kind === 'ps' ? 'DualShock 4 (KaneMode)' : 'Manette XInput (KaneMode)', index: 100 + x.i, mapping: 'standard', native: true,
    buttons: XBITS.map(bit => ({ pressed: bit === -1 ? x.lt > 30 : bit === -2 ? x.rt > 30 : (x.b & bit) !== 0 })),
    axes: [x.lx, x.ly, x.rx, x.ry],
  }));
  // Retour au premier plan : un bouton encore enfoncé (celui qui a quitté KanePlay) ne compte pas
  if (next.length && !xpads.length) swallow = true;
  xpads = next;
  // Traité tout de suite, sans attendre l'image suivante (voir readPads)
  readPads();
}

// Journal de l'app (diagnostic sur la console) : premier appui reçu par chaque source
const logged = new Set();
function logSource(p) {
  const src = p.native ? p.id + ' (app)' : 'WebView2 : ' + p.id;
  if (logged.has(src)) return;
  logged.add(src);
  native.send('log', { text: t('Manette : premier appui reçu par {src}', { src }) });
}

// État de chaque bouton, par manette (une manette fantôme au bouton bloqué ne gêne pas les autres)
const heldBy = {};
// Dernier appui et dernière répétition de chaque action, toutes manettes : la même pression vue par
// l'app et par WebView2 n'agit qu'une fois
const lastPress = {}, lastRepeat = {};
const SAME_PRESS_MS = 90;

// Lecture des manettes à chaque image. Quand Chromium croit la page masquée (fenêtre recouverte,
// retour de KanePlay), requestAnimationFrame s'arrête : une minuterie prend alors le relais, et les
// messages de manette de l'app sont traités dès leur arrivée.
let lastRead = 0;
// Allègement (2.4.0) : quand l'app fournit les manettes (XInput et HID, messages `xpad` traités dès
// leur arrivée), WebView2 n'est plus lu à chaque image (120 fois par seconde sur la ROG Ally) mais
// 20 fois par seconde, 60 tant qu'une direction est tenue (répétition). Sans manette de l'app
// (manette PlayStation, navigateur), lecture à chaque image comme avant.
let rafOn = false;
const nativeFeed = () => xpads.length > 0;
function poll() {
  rafOn = false;
  readPads();
  if (!nativeFeed() && canNavigate()) { rafOn = true; requestAnimationFrame(poll); }
}
function tickPads() {
  if (performance.now() - lastRead > (nativeFeed() ? 40 : 100) && (!document.hidden || xpads.length || mouseMode.on)) readPads();
  if (!rafOn && !nativeFeed() && canNavigate()) { rafOn = true; requestAnimationFrame(poll); }
  setTimeout(tickPads, canNavigate() && Object.keys(heldBy).length ? 16 : 50);
}
// Widgets Game Bar, par-dessus un jeu : pas de lecture à chaque image (120 fois par seconde sur la
// ROG Ally), qui prenait du temps au jeu. Le moniteur n'a pas besoin de manette ; le widget la lit
// 60 fois par seconde, seulement quand il a le focus (à 20, un appui bref pouvait être manqué et la
// navigation paraissait molle).
const GAMEBAR_PAGE = /\/(widget|monitor)\.html$/.exec(location.pathname);
if (!GAMEBAR_PAGE) {
  rafOn = true;
  requestAnimationFrame(poll);
  setTimeout(tickPads, 50);
} else if (GAMEBAR_PAGE[1] === 'widget') {
  setInterval(() => { if (!document.hidden && document.hasFocus()) readPads(); }, 16);
}

function readPads() {
  lastRead = performance.now();
  if (!canNavigate()) {
    swallow = true;
    for (const k in startAt) delete startAt[k];
    // Le relais souris est distinct de la navigation : il reste permis derrière une autre fenêtre.
    if (mouseMode.on) relayMouse(navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [], performance.now());
    return; // Chromium peut toujours exposer une DualShock lorsque KanePlay a le premier plan.
  }
  const web = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const pads = [...xpads, ...web];
  const now = performance.now();
  let source = null;
  padLive.connected = Math.max(xpads.length, web.length);
  const seen = new Set();
  for (const p of pads) {
    const down = new Set();
    p.buttons.forEach((b, i) => { if (b.pressed && PAD[i]) down.add(PAD[i]); });
    const x = axis(p, 0), y = axis(p, 1);
    if (x < -0.55) down.add('left');
    if (x > 0.55) down.add('right');
    if (y < -0.55) down.add('up');
    if (y > 0.55) down.add('down');
    if (down.size || !source) {
      source = p;
      padLive.id = p.id;
      padLive.buttons = p.buttons.map(b => b.pressed);
      padLive.axes = [axis(p, 0), axis(p, 1), axis(p, 2), axis(p, 3)];
    }
    for (const k of down) {
      const id = p.index + ':' + k;
      seen.add(id);
      // Retour sur KaneMode (depuis KanePlay, un jeu) : un bouton encore enfoncé ne compte pas.
      // La souris est un contrôle supplémentaire : la navigation à la manette reste disponible.
      if (swallow) { heldBy[id] = Infinity; continue; }
      if (!heldBy[id]) {
        heldBy[id] = now + 380; // délai avant répétition
        // Start agit au relâchement : maintenu 1 s, il active le mode souris (app native)
        if (k === 'start') { startAt[id] = { t: now, mode: mouseMode.on }; continue; }
        if (now - (lastPress[k] || -1e9) < SAME_PRESS_MS) continue;
        lastPress[k] = now;
        logSource(p);
        setInput('pad', isSony(p.id) ? 'ps' : 'xbox');
        press(padAction(k));
      } else if (DIRS.includes(k) && now >= heldBy[id]) {
        heldBy[id] = now + 90;
        if (now - (lastRepeat[k] || -1e9) < 60) continue;
        lastRepeat[k] = now;
        press(k);
      }
    }
  }
  swallow = false;
  for (const id in heldBy) if (!seen.has(id)) delete heldBy[id];
  if (mouseMode.on) relayMouse(web, now);
  // Start relâché : appui court = son action (accès rapide ou menu) ; appui long = mode souris
  for (const id in startAt) {
    if (seen.has(id)) {
      // Toujours tenu après 1,3 s sans basculement natif : le relais de l'interface le demande.
      // Le mode initial évite un second basculement si le lecteur natif a déjà traité le maintien.
      if (!startAt[id].sent && mouseMode.on === startAt[id].mode && now - startAt[id].t >= 1300) { startAt[id].sent = true; native.send('mouse-mode', { on: !startAt[id].mode }); }
      continue;
    }
    const held = now - startAt[id].t;
    delete startAt[id];
    if (held >= START_HOLD_MS || now - (lastPress.start || -1e9) < SAME_PRESS_MS) continue;
    lastPress.start = now;
    press(padAction('start'));
  }
}

// Mode souris : la manette vue par WebView2 est relayée à l'app, qui déplace la souris. En mode Xbox,
// l'app ne recevait rien par XInput : le curseur apparaissait mais ni le stick ni les boutons ne
// répondaient. Envoyé à chaque changement, et 10 fois par seconde tant qu'un stick est poussé.
let relayed = '', relayedAt = 0;
function relayMouse(web, now) {
  const p = web.find(g => g.buttons.some(b => b.pressed) || g.axes.some(a => Math.abs(a) > 0.2)) || web[0];
  if (!p) {
    if (relayed) { relayed = ''; relayedAt = 0; native.send('mouse-pad', { b: 0, lx: 0, ly: 0, rx: 0, ry: 0 }); }
    return;
  }
  let b = 0;
  p.buttons.forEach((x, i) => { if (x.pressed && XBITS[i] > 0) b |= XBITS[i]; });
  const r = v => Math.round((v || 0) * 100) / 100;
  const msg = { b, lx: r(p.axes[0]), ly: r(p.axes[1]), rx: r(p.axes[2]), ry: r(p.axes[3]), source: p.id };
  const key = JSON.stringify(msg), moving = [msg.lx, msg.ly, msg.rx, msg.ry].some(a => Math.abs(a) > 0.2);
  if (key === relayed && !(moving || b) ) return;
  if (key === relayed && now - relayedAt < 100) return;
  relayed = key; relayedAt = now;
  native.send('mouse-pad', msg);
}

// Manettes déconnectées puis reconnectées par l'app (retour de KanePlay) : état remis à zéro
native.on(m => {
  if (m.type !== 'pads-reset') return;
  xpads = [];
  for (const o of [heldBy, lastPress, lastRepeat, armed, startAt]) for (const k in o) delete o[k];
  swallow = true;
  logged.clear();
});

// Mode souris (Start maintenu, voir native/KaneMode.App/XInputPads.cs) : l'app le signale
export const mouseMode = { on: false };
const startAt = {};
const START_HOLD_MS = 900;
native.on(m => {
  if (m.type !== 'mouse-mode') return;
  mouseMode.on = !!m.on;
  relayed = ''; relayedAt = 0;
  // En sortant du mode souris, Start (encore tenu) et le reste ne doivent pas agir
  if (!m.on) swallow = true;
  document.body.classList.toggle('mouse-mode', mouseMode.on);
});

// ---------- Souris ----------
document.addEventListener('mousemove', e => {
  // Le défilement ou un léger contact de la souris ne doit pas voler le focus à la manette
  if (Math.abs(e.movementX) + Math.abs(e.movementY) < 3 || (!mouseMode.on && Date.now() - input.last < 600)) return;
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
