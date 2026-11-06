// Thèmes du monde Émulation. « Moderne » (carrousel + étagère 3D) est dessiné par emulation.js ;
// les autres sont dessinés ici, avec les mêmes données et la même manette : des tuiles qu'on
// parcourt aux flèches (rangée ou grille selon le thème), un encart qui décrit la tuile choisie,
// A pour entrer dans une console ou jouer, Y pour la fiche, X favori, B retour.
import { t, tn } from '../i18n.js';
import { el, esc, icon, favs, fmt, store } from '../core.js';
import { nav, setFocus, renderHints, glyph, topLayer } from '../nav.js';
import { launch, setBackground } from './game.js';
import { LOOK, YEAR, lookOf, brandOf, kindOf, lastPlayedFirst } from './emulation.js';

export const THEMES = () => [
  ['modern', t('Moderne'), t('Carrousel de consoles et étagère de boîtes en 3D')],
  ['ps5', t('Style PS5'), t('Une rangée de vignettes, le jeu en grand derrière')],
  ['switch2', t('Style Switch 2'), t('Sombre et épuré, grandes vignettes carrées')],
  ['xbox', t('Style Xbox Series'), t('Mosaïque de tuiles, accent vert')],
  ['steam', t('Style Steam Big Picture'), t('Bannière du jeu et grille de jaquettes')],
  ['retro', t('Rétro'), t('Couleurs vives et manettes dessinées')],
];
// Disposition des jeux d'une console : une rangée ou une grille
const GRID = ['xbox', 'steam', 'retro'];

const glyphSpan = k => { const s = el('span', 'shoulder', glyph(k)); s.dataset.glyph = k; return s.outerHTML; };
const hasArt = g => !!(g.art && g.art.portrait);
const heroOf = g => g && g.art && (g.art.hero || g.art.header);
const colorOf = id => (id === 'all' || id === 'fav' ? 'var(--accent)' : LOOK[id] || '#7c9eff');

// ---------------------------------------------------------------- manettes dessinées (thème Rétro)
const FAMILY = {
  nes: 'flat', mastersystem: 'flat', atari2600: 'flat', pcengine: 'flat',
  snes: 'pill', megadrive: 'pill', saturn: 'pill', neogeo: 'pill', arcade: 'pill',
  gb: 'tall', gbc: 'tall', gba: 'wide', gamegear: 'wide', psp: 'wide', psvita: 'wide', nds: 'dual', n3ds: 'dual',
};
const INK = 'stroke="#23233a" stroke-width="3" stroke-linejoin="round"';
const dpad = (x, y, s = 1) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-3 -10h6v7h7v6h-7v7h-6v-7h-7v-6h7z" fill="#2b2b44"/></g>`;
const shine = (x, y, w, h) => `<ellipse cx="${x}" cy="${y}" rx="${w}" ry="${h}" fill="#fff" opacity=".35"/>`;
/** Petite console ou manette en dessin animé, aux couleurs de la console. */
export function toy(id) {
  const c = id === 'add' ? '#9aa7c7' : id === 'all' || id === 'fav' ? '#ffcf3f' : LOOK[id] || '#7c9eff';
  const body = `fill="${c}" ${INK}`;
  const f = FAMILY[id] || (id === 'all' || id === 'fav' || id === 'add' ? id : 'pad');
  let g;
  if (f === 'flat') {
    g = `<rect x="8" y="20" width="104" height="44" rx="9" ${body}/>${shine(30, 27, 16, 3)}<rect x="16" y="28" width="88" height="28" rx="5" fill="#eceff6" ${INK}/>
      ${dpad(34, 42)}<rect x="50" y="44" width="9" height="4" rx="2" fill="#2b2b44"/><rect x="62" y="44" width="9" height="4" rx="2" fill="#2b2b44"/>
      <circle cx="82" cy="45" r="6" fill="#ff4b5c" ${INK}/><circle cx="96" cy="39" r="6" fill="#ff4b5c" ${INK}/>`;
  } else if (f === 'pill') {
    g = `<rect x="6" y="18" width="108" height="46" rx="23" ${body}/>${shine(30, 25, 16, 3)}${dpad(30, 41)}
      <rect x="50" y="44" width="8" height="4" rx="2" fill="#2b2b44"/><rect x="62" y="44" width="8" height="4" rx="2" fill="#2b2b44"/>
      <circle cx="90" cy="31" r="5.5" fill="#4b7bff" ${INK}/><circle cx="101" cy="41" r="5.5" fill="#ff4b5c" ${INK}/>
      <circle cx="90" cy="51" r="5.5" fill="#3ddc84" ${INK}/><circle cx="79" cy="41" r="5.5" fill="#ffd23f" ${INK}/>`;
  } else if (f === 'tall') {
    g = `<rect x="34" y="2" width="52" height="76" rx="7" ${body}/>${shine(46, 8, 8, 2)}<rect x="41" y="9" width="38" height="30" rx="4" fill="#2b2b44"/>
      <rect x="45" y="13" width="30" height="22" rx="2" fill="#bfe3a0"/>${dpad(50, 57, .8)}
      <circle cx="69" cy="60" r="4.5" fill="#ff4b5c" ${INK}/><circle cx="78" cy="53" r="4.5" fill="#ff4b5c" ${INK}/>`;
  } else if (f === 'wide') {
    g = `<rect x="4" y="16" width="112" height="50" rx="22" ${body}/>${shine(26, 23, 12, 3)}<rect x="32" y="22" width="56" height="38" rx="5" fill="#2b2b44"/>
      <rect x="37" y="26" width="46" height="30" rx="3" fill="#9fd8ff"/>${dpad(18, 41, .8)}
      <circle cx="100" cy="36" r="4.5" fill="#ffd23f" ${INK}/><circle cx="106" cy="46" r="4.5" fill="#ff4b5c" ${INK}/>`;
  } else if (f === 'dual') {
    g = `<rect x="28" y="2" width="64" height="36" rx="6" ${body}/><rect x="37" y="7" width="46" height="26" rx="3" fill="#2b2b44"/><rect x="40" y="10" width="40" height="20" rx="2" fill="#9fd8ff"/>
      <rect x="28" y="40" width="64" height="38" rx="6" ${body}/>${shine(40, 45, 8, 2)}<rect x="44" y="45" width="32" height="24" rx="3" fill="#dfe8f5" ${INK}/>
      ${dpad(36, 62, .55)}<circle cx="84" cy="58" r="3.5" fill="#ff4b5c"/><circle cx="84" cy="68" r="3.5" fill="#3ddc84"/>`;
  } else if (f === 'all' || f === 'fav') {
    g = `<path d="M60 4l15 31 34 4-25 23 7 34-31-17-31 17 7-34-25-23 34-4z" transform="translate(0 -6) scale(1 .9)" fill="${f === 'fav' ? '#ff4b8b' : '#ffcf3f'}" ${INK}/>${shine(52, 26, 8, 3)}`;
  } else if (f === 'add') {
    g = `<circle cx="60" cy="40" r="32" fill="#ffffff" ${INK}/><path d="M60 24v32M44 40h32" stroke="#23233a" stroke-width="8" stroke-linecap="round"/>`;
  } else {
    g = `<path d="M22 22Q22 14 34 14H86Q98 14 98 22L112 62Q114 74 102 74Q94 74 88 64L82 56H38L32 64Q26 74 18 74Q6 74 8 62Z" ${body}/>${shine(36, 20, 12, 3)}
      ${dpad(34, 32, .75)}<circle cx="86" cy="25" r="4.5" fill="#ffd23f" ${INK}/><circle cx="94" cy="33" r="4.5" fill="#ff4b5c" ${INK}/>
      <circle cx="78" cy="33" r="4.5" fill="#4b7bff" ${INK}/><circle cx="86" cy="41" r="4.5" fill="#3ddc84" ${INK}/>
      <circle cx="46" cy="50" r="8" fill="#2b2b44"/><circle cx="74" cy="50" r="8" fill="#2b2b44"/><circle cx="46" cy="48" r="4" fill="#5a5a7a"/><circle cx="74" cy="48" r="4" fill="#5a5a7a"/>`;
  }
  return `<svg class="toy" viewBox="0 0 120 80" aria-hidden="true">${g}</svg>`;
}

// ---------------------------------------------------------------- tuiles
/** Jaquette d'un jeu, ou boîte dessinée si elle manque ou ne se charge pas. */
function cover(g, cls = '') {
  const box = el('div', 'th-cover ' + cls);
  const gen = () => el('div', 'th-gen', `<small>${esc(brandOf(g.system))}</small><b>${esc(g.name)}</b>`);
  box.style.setProperty('--g', LOOK[g.system] || '#7c9eff');
  if (hasArt(g)) {
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.src = g.art.portrait;
    img.onerror = () => img.replaceWith(gen());
    // Jaquette floutée derrière : remplit les tuiles plus larges que la jaquette
    box.style.setProperty('--img', `url("${g.art.portrait}")`);
    box.append(img);
  } else box.append(gen());
  return box;
}
function sysTile(P, s) {
  const tile = el('div', 'th-tile sys' + (s.id === 'add' ? ' add' : ''));
  tile.dataset.sys = s.id;
  tile.style.setProperty('--c', colorOf(s.id));
  const games = s.id === 'add' ? [] : P.gamesOf(s.id).sort((a, b) => hasArt(b) - hasArt(a) || lastPlayedFirst(a, b));
  const art = el('div', 'th-art');
  if (s.id === 'add') art.innerHTML = `<div class="th-plus">${icon('i-plus')}</div>`;
  else if (games[0]) art.append(cover(games[0]));
  tile.append(art);
  tile.insertAdjacentHTML('beforeend', `${toy(s.id)}<div class="th-brand">${esc(s.id === 'add' ? t('Ajouter') : s.id === 'all' ? t('Tout') : s.id === 'fav' ? t('Favoris') : brandOf(s.id))}</div>
    <div class="th-count">${s.id === 'add' ? '' : tn(s.count, '{n} jeu', '{n} jeux')}</div>`);
  return nav(tile, () => (s.id === 'add' ? P.open({ what: 'games' }) : enterSys(P, s.id)), 'c:' + s.id);
}
function gameTile(P, g, i, inHub) {
  const tile = el('div', 'th-tile game' + (favs.has(g.id) ? ' fav' : ''));
  tile.dataset.gid = g.id;
  tile.style.setProperty('--c', LOOK[g.system] || '#7c9eff');
  const art = el('div', 'th-art');
  art.append(cover(g));
  tile.append(art);
  tile.insertAdjacentHTML('beforeend', `<div class="th-name">${esc(g.name)}</div>`);
  return nav(tile, () => (inHub ? launch(g) : (P.idx = i, P.play())), (inHub ? 'r:' : 'g:') + g.id);
}
const button = (cls, ic, label, fn, key, glyphKey) => nav(el('div', 'th-btn ' + cls, `${icon(ic)}<span>${label}</span>${glyphKey ? glyphSpan(glyphKey) : ''}`), fn, key);

function enterSys(P, id) {
  P.sys = id;
  P.view = 'console';
  store.set('emusys', id);
  P.draw('shelf');
}
/** Consoles de l'accueil : Tout, les consoles qui ont des jeux, puis « Ajouter ». */
function hubSystems(P) { return [...P.systems(), { id: 'add', name: t('Ajouter des jeux') }]; }
/** Jeux d'une « console » de thème : vraie console, Tout (récents d'abord) ou Favoris. */
export function themedGames(P, id) {
  if (id === 'fav') return P.roms().filter(g => favs.has(g.id)).sort((a, b) => a.name.localeCompare(b.name));
  return P.gamesOf(id);
}
function sysInfo(P, id) {
  if (id === 'fav') return { id, name: t('Favoris'), maker: '', count: themedGames(P, 'fav').length };
  return P.systems().find(s => s.id === id) || P.data.systems.find(s => s.id === id);
}

// ---------------------------------------------------------------- dessin
export function drawThemed(P, focusKey) {
  const T = P.theme;
  document.body.dataset.emuTheme = T;
  P.el.classList.add('th-mode');
  if (P.mode === 'hub') drawHub(P, T); else drawConsole(P, T);
  if (topLayer()) return;
  let want = focusKey;
  if (!want || want === 'hub') want = 'c:' + (P.sys || '');
  else if (want === 'shelf') want = 'g:' + (P.current() ? P.current().id : '');
  const f = P.el.querySelector(`[data-key="${CSS.escape(want)}"]`) || P.el.querySelector('.th-tile');
  if (f) { setFocus(f, { sound: false, scroll: 'instant' }); f.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
}

function head(P, T, title, sub, back) {
  const h = el('div', 'th-head');
  if (back) h.append(nav(el('div', 'th-round back', `${icon('i-grid')}<span>${t('Consoles')}</span>`), () => P.toHub(), 'to-hub'));
  h.append(el('div', 'th-title', `${T === 'retro' && back ? toy(P.sys) : ''}<div><b>${esc(title)}</b><small>${esc(sub)}</small></div>`));
  const tools = el('div', 'th-tools');
  if (back && P.sys !== 'all' && P.sys !== 'fav') tools.append(nav(el('div', 'th-round', `${icon('i-palette')}<span>${t('Réglages')}</span>`), () => P.openSettings('system', P.sys), 'sys-settings'));
  tools.append(nav(el('div', 'th-round', `${icon('i-image')}<span>${t('Thème')}</span>`), () => P.pickTheme(), 'theme'));
  if (!back) tools.append(nav(el('div', 'th-round', `${icon('i-gear')}<span>${t('Gérer')}</span>`), () => P.openManage(), 'manage'));
  h.append(tools);
  return h;
}

function drawHub(P, T) {
  const roms = P.roms();
  const systems = hubSystems(P);
  const consoles = systems.filter(s => s.id !== 'all' && s.id !== 'add').length;
  const root = el('div', `th th-${T} hub`);
  root.append(head(P, T, t('Émulation'), `${tn(roms.length, '{n} jeu', '{n} jeux')} · ${tn(consoles, '{n} console', '{n} consoles')}`));
  const recent = roms.filter(g => g.lastPlayed).sort(lastPlayedFirst).slice(0, 8);
  const detail = el('div', 'th-detail');
  const tiles = el('div', (T === 'xbox' ? 'th-grid' : 'th-strip row') + ' th-systems');
  for (const s of systems) tiles.append(sysTile(P, s));
  if (T === 'retro') {
    // Comme une console de salon pour enfants : la console choisie en grand, les manettes en bas,
    // les grands boutons colorés à droite
    const side = el('div', 'th-pills');
    const pill = (cls, ic, label, fn, key) => side.append(nav(el('div', 'th-pill ' + cls, `${icon(ic)}<span>${label}</span>`), fn, key));
    pill('love', 'i-star', t('Favoris'), () => enterSys(P, 'fav'), 'p-fav');
    pill('recent', 'i-clock', t('Récents'), () => enterSys(P, 'all'), 'p-recent');
    pill('theme', 'i-image', t('Thème'), () => P.pickTheme(), 'p-theme');
    pill('rom', 'i-gear', t('Gérer'), () => P.openManage(), 'p-manage');
    const stage = el('div', 'th-stage');
    stage.append(detail, side);
    root.querySelector('.th-tools').remove();
    root.append(stage, tiles);
  } else if (T === 'steam') {
    const body = el('div', 'th-body');
    body.append(detail);
    if (recent.length) {
      body.append(el('h3', 'th-sec', t('Reprendre')));
      const row = el('div', 'th-strip row th-recent');
      recent.forEach((g, i) => row.append(gameTile(P, g, i, true)));
      body.append(row);
    }
    body.append(el('h3', 'th-sec', t('Consoles')), tiles);
    root.append(body);
  } else if (T === 'switch2') {
    root.append(detail, tiles);
    const acts = el('div', 'th-actions');
    if (recent[0]) acts.append(button('', 'i-play', t('Reprendre'), () => launch(recent[0]), 'resume'));
    acts.append(button('', 'i-star', t('Favoris'), () => enterSys(P, 'fav'), 'a-fav'));
    acts.append(button('', 'i-folder', t('Mes jeux'), () => P.open({ what: 'games' }), 'a-folder'));
    root.append(acts);
  } else if (T === 'xbox') {
    const body = el('div', 'th-body');
    if (recent[0]) {
      const big = gameTile(P, recent[0], 0, true);
      big.classList.add('big');
      big.insertAdjacentHTML('beforeend', `<div class="th-tag">${t('Reprendre')}</div>`);
      tiles.prepend(big);
    }
    body.append(tiles, detail);
    root.append(body);
  } else {
    root.append(tiles, detail);
  }
  P.el.replaceChildren(root);
}

function drawConsole(P, T) {
  const id = P.sys;
  const s = sysInfo(P, id);
  const list = themedGames(P, id);
  if (!s || !list.length) { P.view = 'hub'; drawHub(P, T); return; }
  P.list = list;
  P.pos = P.pos || {};
  P.idx = Math.max(0, list.findIndex(g => g.id === P.pos[id]));
  P.tint(id === 'all' || id === 'fav' ? null : s);
  const root = el('div', `th th-${T} console`);
  root.style.setProperty('--sys', colorOf(id));
  const name = id === 'all' ? t('Tous les jeux') : id === 'fav' ? t('Favoris') : s.name;
  root.append(head(P, T, name, [id === 'all' || id === 'fav' ? '' : s.maker, tn(list.length, '{n} jeu', '{n} jeux')].filter(Boolean).join(' · '), true));
  const detail = el('div', 'th-detail');
  const tiles = el('div', (GRID.includes(T) ? 'th-grid' : 'th-strip row') + ' th-games');
  list.forEach((g, i) => tiles.append(gameTile(P, g, i, false)));
  if (GRID.includes(T)) {
    const body = el('div', 'th-body');
    if (T === 'retro') body.append(tiles); else body.append(detail, tiles);
    root.append(body);
    if (T === 'retro') root.append(detail);
  } else if (T === 'switch2') {
    root.append(detail, tiles);
  } else {
    root.append(tiles, detail);
  }
  P.el.replaceChildren(root);
}

// ---------------------------------------------------------------- tuile choisie
export function themedFocus(P, target) {
  if (!target || !P.el.contains(target)) return;
  if (target.dataset.sys) { P.thSel = { sys: target.dataset.sys }; if (target.dataset.sys !== 'add') P.sys = target.dataset.sys; }
  else if (target.dataset.gid) {
    P.thSel = { gid: target.dataset.gid, hub: P.mode === 'hub' };
    if (P.mode === 'console') {
      const i = P.list.findIndex(g => g.id === target.dataset.gid);
      if (i >= 0 && i !== P.idx) { P.idx = i; P.pos[P.sys] = P.list[i].id; P.savePos(); }
    }
  } else return;
  paintDetail(P);
}
export function paintDetail(P) {
  const d = P.el.querySelector('.th-detail');
  const sel = P.thSel;
  if (!d || !sel) return;
  const T = P.theme;
  const keep = d.querySelector('.focused')?.dataset.key;
  if (sel.sys) {
    const s = sel.sys === 'add' ? { id: 'add', name: t('Ajouter des jeux') } : sysInfo(P, sel.sys);
    if (!s) return;
    if (s.id !== 'add') P.tint(s.id === 'all' ? null : s);
    const games = s.id === 'add' ? [] : themedGames(P, s.id);
    const hero = games.map(heroOf).find(Boolean);
    if (hero) setBackground(hero);
    const bits = s.id === 'add' ? [P.data.dirs.games] : [s.id === 'all' ? '' : s.maker, YEAR[s.id], kindOf(s.id), tn(s.count, '{n} jeu', '{n} jeux')].filter(Boolean);
    d.style.setProperty('--hero', hero ? `url("${hero}")` : 'none');
    d.style.setProperty('--c', colorOf(s.id));
    d.innerHTML = `${T === 'retro' ? `<div class="th-big">${toy(s.id)}</div>` : ''}
      <div class="th-text"><small>${esc(s.id === 'add' ? '' : s.id === 'all' ? t('Toutes les consoles') : s.maker || '')}</small>
      <h1>${esc(T === 'retro' && s.id !== 'add' ? (s.id === 'all' ? t('Tout') : s.id === 'fav' ? t('Favoris') : brandOf(s.id)) : s.name)}</h1>
      <p>${bits.map(b => esc(String(b))).join('<i>·</i>')}</p></div>`;
    if (T !== 'retro' && T !== 'switch2') {
      const acts = el('div', 'th-acts');
      acts.append(button('primary', s.id === 'add' ? 'i-folder' : 'i-play', s.id === 'add' ? t('Ouvrir le dossier') : t('Entrer'), () => (s.id === 'add' ? P.open({ what: 'games' }) : enterSys(P, s.id)), 'enter', 'a'));
      d.append(acts);
    }
  } else {
    const g = (sel.hub ? P.roms() : P.list).find(x => x.id === sel.gid);
    if (!g) return;
    const m = P.meta(g);
    const hero = heroOf(g);
    if (hero) setBackground(hero);
    d.style.setProperty('--hero', hero ? `url("${hero}")` : 'none');
    d.style.setProperty('--c', LOOK[g.system] || '#7c9eff');
    const bits = [];
    if (P.sys === 'all' || P.sys === 'fav' || sel.hub) bits.push(brandOf(g.system));
    if (m?.year) bits.push(m.year);
    if (m?.genre) bits.push(m.genre);
    if (m?.players > 1) bits.push(tn(m.players, '{n} joueur', '{n} joueurs'));
    bits.push(g.lastPlayed ? fmt.played(g.lastPlayed) + (g.playtime ? ' · ' + fmt.playtime(g.playtime) : '') : t('Jamais joué'));
    d.innerHTML = `<div class="th-text"><small>${sel.hub ? t('Reprendre') : `${P.idx + 1} / ${P.list.length}`}</small>
      <h1>${favs.has(g.id) ? '<i class="th-star">★</i>' : ''}${esc(g.name)}</h1><p>${bits.map(b => esc(String(b))).join('<i>·</i>')}</p>
      ${m?.description && (T === 'steam' || T === 'ps5') ? `<div class="th-desc">${esc(m.description)}</div>` : ''}</div>`;
    const acts = el('div', 'th-acts');
    acts.append(button('primary', 'i-play', t('Jouer'), () => launch(g), 'play', 'a'));
    if (!sel.hub) {
      acts.append(button('', 'i-info', t('Fiche'), () => P.openSheet(), 'sheet', 'y'));
      acts.append(button(favs.has(g.id) ? 'on' : '', 'i-star', t('Favori'), () => P.toggleFav(), 'fav', 'x'));
    }
    d.append(acts);
  }
  if (keep) { const f = d.querySelector(`[data-key="${keep}"]`); if (f) setFocus(f, { scroll: false, sound: false }); }
  renderHints();
}

// ---------------------------------------------------------------- manette
export function themedButton(P, k) {
  if (P.mode === 'hub') {
    if (k === 'y') { const id = P.thSel && P.thSel.sys; if (id && !['all', 'add', 'fav'].includes(id)) P.openSettings('system', id); return true; }
    if (k === 'x') { P.openManage(); return true; }
    return false;
  }
  if (k === 'b') { P.toHub(); return true; }
  if (k === 'x') { P.toggleFav(); return true; }
  if (k === 'y') { P.openSheet(); return true; }
  if (k === 'lb' || k === 'rb') {
    const list = P.systems();
    let i = list.findIndex(s => s.id === P.sys);
    if (list.length < 2) return true;
    if (i < 0) i = 0;
    const next = list[(i + (k === 'rb' ? 1 : -1) + list.length) % list.length];
    enterSys(P, next.id);
    return true;
  }
  return false;
}
export function themedHints(P) {
  if (P.mode === 'hub') return [['y', t('<span class="label-long">Réglages</span>')], ['x', t('Gérer')], ['a', t('Entrer')], ['b', t('Retour')]];
  return [[['lb', 'rb'], t('<span class="label-long">Console</span>')], ['x', t('Favori')], ['y', t('Fiche')], ['a', t('Jouer')], ['b', t('Consoles')]];
}
