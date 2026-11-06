// Monde Émulation, style KaneMode : une grande bannière qui suit la tuile choisie, des rangées
// (Reprendre, Consoles, Favoris, Ajoutés récemment) puis, dans une console, la grille de ses jaquettes.
// La fiche et les réglages glissent par-dessus. « Gérer » : dossier de jeux, BIOS, émulateurs.
import { t, tn, locale } from '../i18n.js';
import { el, esc, icon, api, lib, toast, busy, sfx, store, favs, fmt } from '../core.js';
import { definePage, nav, focusIn, setFocus, glyph, renderHints, go, openLayer, closeLayer, topLayer } from '../nav.js';
import { dialog, confirmDialog } from '../widgets.js';
import { launch, toggleFav, setBackground } from './game.js';
import { pickFile } from './add.js';

// Couleur de chaque console ; motif de fond par constructeur
const LOOK = {
  nes: '#e4002b', snes: '#7b68ee', n64: '#1aa64b', gb: '#8bac0f', gbc: '#b23cf0', gba: '#5b4ee0', nds: '#8fa3b8', n3ds: '#e0242c',
  gc: '#7a5cd6', wii: '#00a8e8', wiiu: '#0aa3c9', switch: '#e60012', switch2: '#ff3b5c',
  psx: '#4a7fe0', ps2: '#2f5fd0', ps3: '#7c7f99', ps4: '#2b6fe8', psvita: '#2f86d9', psp: '#9aa0b4',
  megadrive: '#e8333f', mastersystem: '#d2232a', gamegear: '#2d63c8', segacd: '#c43b6b', saturn: '#6f7d8c', dreamcast: '#f47b20',
  pcengine: '#f0a500', neogeo: '#d4af37', arcade: '#ff7a1a', atari2600: '#c0703a', xbox: '#3fae2a', xbox360: '#7cc242',
};
const MOTIF = { Nintendo: 'dots', Sony: 'grid', Sega: 'stripes', Microsoft: 'grid' };
// Nom court affiché en grand, et sur la tranche des boîtes
const BRAND = {
  nes: 'NES', snes: 'SUPER NES', n64: 'N64', gb: 'GAME BOY', gbc: 'GB COLOR', gba: 'GBA', nds: 'DS', n3ds: '3DS', gc: 'GAMECUBE',
  wii: 'Wii', wiiu: 'Wii U', switch: 'SWITCH', switch2: 'SWITCH 2', psx: 'PS1', ps2: 'PS2', ps3: 'PS3', ps4: 'PS4', psvita: 'VITA',
  psp: 'PSP', megadrive: 'MEGA DRIVE', mastersystem: 'MASTER SYSTEM', gamegear: 'GAME GEAR', segacd: 'MEGA-CD', saturn: 'SATURN',
  dreamcast: 'DREAMCAST', pcengine: 'PC ENGINE', neogeo: 'NEO GEO', arcade: 'ARCADE', atari2600: 'ATARI 2600', xbox: 'XBOX', xbox360: 'XBOX 360',
};
const HANDHELD = ['gb', 'gbc', 'gba', 'nds', 'n3ds', 'psp', 'psvita', 'gamegear'];
const lookOf = s => ({ color: LOOK[s.id] || '#7c9eff', motif: MOTIF[s.maker] || 'scan' });
const brandOf = id => BRAND[id] || t('RÉTRO');

const shoulder = k => { const s = el('span', 'shoulder', glyph(k)); s.dataset.glyph = k; return s; };
const pct = j => (j.total ? Math.min(99, Math.round(j.received / j.total * 100)) : 0);
const firstLetter = g => (g.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').match(/[a-z]/i) || ['#'])[0].toUpperCase();

/** Texte d'avancement d'une installation (écran de lancement, liste des émulateurs). */
export function jobText(j) {
  if (j.phase === 'search') return t('Recherche de la dernière version de {name}…', { name: j.name });
  if (j.phase === 'download') return t('Téléchargement de {name}… {p} %', { name: j.name, p: pct(j) });
  if (j.phase === 'extract') return t('Installation de {name}…', { name: j.name });
  if (j.phase === 'error') return t('{name} : {error}', { name: j.name, error: j.error });
  return t('{name} est prêt', { name: j.name });
}

/** Installe un émulateur en suivant l'avancement ; renvoie une erreur ou null une fois prêt. */
export async function installEmulator(id, onText = () => {}) {
  await api.post('/api/emu/install', { id });
  for (;;) {
    await new Promise(r => setTimeout(r, 450));
    const { jobs } = await api.get('/api/emu/jobs');
    const j = jobs.find(x => x.id === id);
    if (j) onText(jobText(j));
    if (j && j.phase === 'error') return j.error;
    if (!j || (j.phase === 'done' && !j.busy)) {
      // La bibliothèque est refaite juste après l'installation : le jeu connaît alors son émulateur
      await new Promise(r => setTimeout(r, 700));
      await lib.load({ background: true });
      return null;
    }
  }
}

/** Décompresse un jeu rangé dans une archive ; renvoie une erreur ou null une fois prêt. */
export async function extractGame(id, onText = () => {}) {
  await api.post('/api/emu/extract', { id });
  for (;;) {
    await new Promise(r => setTimeout(r, 500));
    const { jobs } = await api.get('/api/emu/jobs');
    const j = jobs.find(x => x.id === 'extract:' + id);
    if (j && j.phase === 'error') return j.error;
    if (!j || (j.phase === 'done' && !j.busy)) return null;
    onText(t('Décompression de {name}… {p} %', { name: j.name, p: pct(j) }));
  }
}

const metaCache = new Map();

// Réglages proposés (jeu ou console) : filtre avec RetroArch, format avec RetroArch, DuckStation et
// PCSX2, qualité et écran large avec les émulateurs 3D
const FILTERS = () => [['none', t('Aucun (pixels d’origine)')], ['crt', t('Écran CRT (télé d’époque)')], ['scanlines', t('Lignes de balayage')], ['lcd', t('Écran LCD (portables)')], ['smooth', t('Lissé')], ['sharp', t('Net, sans scintillement')]];
const ASPECTS = () => [['auto', t('Automatique (format du jeu)')], ['4:3', '4:3'], ['16:9', '16:9'], ['full', t('Plein écran (étiré)')]];
const QUALITIES = () => [['auto', t('Adaptée à l’écran')], ['native', t('D’origine (plus léger)')]];
const WIDES = () => [['on', t('Oui')], ['off', t('Non')]];
const ASPECT_EMUS = ['retroarch', 'duckstation', 'pcsx2'];
const QUALITY_EMUS = ['duckstation', 'pcsx2', 'dolphin', 'ppsspp', 'azahar'];
const WIDE_EMUS = ['duckstation', 'pcsx2', 'dolphin'];
const label = (list, v) => (list.find(([k]) => k === v) || [])[1];

// Année de sortie (première sortie, Japon compris)
const YEAR = {
  nes: 1983, snes: 1990, n64: 1996, gb: 1989, gbc: 1998, gba: 2001, nds: 2004, n3ds: 2011, gc: 2001, wii: 2006, wiiu: 2012, switch: 2017, switch2: 2025,
  psx: 1994, ps2: 2000, ps3: 2006, ps4: 2013, psvita: 2011, psp: 2004, megadrive: 1988, mastersystem: 1985, gamegear: 1990, segacd: 1991, saturn: 1994,
  dreamcast: 1998, pcengine: 1987, neogeo: 1990, atari2600: 1977, xbox: 2001, xbox360: 2005,
};
const kindOf = id => (HANDHELD.includes(id) ? t('Console portable') : ['arcade', 'neogeo'].includes(id) ? t('Arcade') : t('Console de salon'));
const lastPlayedFirst = (a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0);
const hasArt = g => !!(g.art && g.art.portrait);
const heroOf = g => g && g.art && (g.art.hero || g.art.header);
// Consoles « virtuelles » : tous les jeux, favoris
const VIRTUAL = { all: () => t('Tous les jeux'), fav: () => t('Favoris') };

/** Jaquette d'un jeu, ou boîte dessinée à ses couleurs si elle manque ou ne se charge pas. */
function cover(g) {
  const box = el('div', 'kw-cover');
  box.style.setProperty('--g', LOOK[g.system] || '#7c9eff');
  const gen = () => el('div', 'kw-gen', `<small>${esc(brandOf(g.system))}</small><b>${esc(g.name)}</b>`);
  if (hasArt(g)) {
    const img = new Image();
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.onerror = () => { img.replaceWith(gen()); box.style.removeProperty('--img'); };
    img.src = g.art.portrait;
    // Jaquette carrée ou large (PlayStation, Super Nintendo) : entière, sur son propre fond flouté
    box.style.setProperty('--img', `url("${g.art.portrait}")`);
    box.append(img);
  } else box.append(gen());
  return box;
}

definePage('emulation', {
  libBound: true,
  title: () => t('Émulation'),
  initialFocus() {
    if (this.mode === 'manage') return this.roms().length ? 'back-shelf' : 'open-games';
    return this.lastKey || (this.mode === 'console' ? 'filter:all' : 'manage');
  },
  render(p = {}) {
    document.body.classList.add('emu-world');
    if (!this.data) this.el.innerHTML = t('<div class="loading"><i class="spinner big"></i>Ouverture du monde Émulation…</div>');
    api.get('/api/emu/world').then(d => { this.data = { ...d, emulators: this.withLatest(d.emulators) }; if (this.el.classList.contains('active')) this.draw(p.focus); })
      .catch(e => toast(e.message, { error: true }));
    if (this.data) this.draw(p.focus);
  },
  leave() {
    document.body.classList.remove('emu-world');
    document.body.style.removeProperty('--emu');
    clearInterval(this.poll); this.poll = null;
    clearTimeout(this.heroTimer);
  },

  roms() { return lib.visible().filter(g => g.source === 'rom'); },
  /** Consoles qui ont des jeux, dans l'ordre de la liste des consoles. */
  systems() {
    const counts = {};
    for (const g of this.roms()) counts[g.system] = (counts[g.system] || 0) + 1;
    return this.data.systems.filter(s => counts[s.id]).map(s => ({ ...s, count: counts[s.id] }));
  },
  /** Jeux d'une console (ou de « Tous les jeux », des favoris), triés par nom. */
  gamesOf(id) {
    const list = this.roms().filter(g => id === 'all' || (id === 'fav' ? favs.has(g.id) : g.system === id));
    return list.sort((a, b) => a.name.localeCompare(b.name, locale));
  },
  sysInfo(id) {
    if (VIRTUAL[id]) return { id, name: VIRTUAL[id](), maker: '', count: this.gamesOf(id).length };
    return this.systems().find(s => s.id === id) || this.data.systems.find(s => s.id === id);
  },

  draw(focusKey) {
    const has = this.roms().length;
    this.mode = this.manage || !has ? 'manage' : this.view === 'console' ? 'console' : 'hub';
    this.el.classList.toggle('kw-mode', this.mode !== 'manage');
    if (this.mode === 'manage') this.drawManage(focusKey);
    else {
      if (this.mode === 'hub') this.drawHub(); else this.drawConsole();
      this.focusTile(focusKey);
    }
    renderHints();
  },
  /** Après un dessin : le focus revient sur la tuile d'avant (ou la première). */
  focusTile(key) {
    if (topLayer()) return;
    const want = key || this.lastKey;
    const f = (want && this.el.querySelector(`[data-key="${CSS.escape(want)}"]`)) || this.el.querySelector('.kw-tile');
    if (f) { setFocus(f, { sound: false, scroll: 'instant' }); f.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
  },

  // ---------------------------------------------------------------- en-tête, bannière, tuiles
  head(title, sub, back) {
    const h = el('div', 'kw-head');
    if (back) h.append(nav(el('div', 'kw-chip back', `${icon('i-grid')}<span>${t('Consoles')}</span>`), () => this.toHub(), 'to-hub'));
    h.append(el('div', 'kw-title', `<b>${esc(title)}</b><small>${esc(sub)}</small>`));
    if (back) {
      // Consoles voisines (LB / RB), cliquables
      const list = this.consoleOrder();
      const i = list.indexOf(this.sys);
      if (list.length > 1 && i >= 0) {
        const near = el('div', 'kw-near');
        const go = (id, k) => { const b = el('div', 'kw-nb', `${k === 'lb' ? shoulder('lb').outerHTML : ''}<span>${esc(this.sysInfo(id).name)}</span>${k === 'rb' ? shoulder('rb').outerHTML : ''}`); b.addEventListener('click', () => this.openConsole(id)); return b; };
        near.append(go(list[(i - 1 + list.length) % list.length], 'lb'), go(list[(i + 1) % list.length], 'rb'));
        h.append(near);
      }
    }
    const tools = el('div', 'kw-tools');
    if (back && !VIRTUAL[this.sys]) tools.append(nav(el('div', 'kw-chip', `${icon('i-palette')}<span>${t('Réglages')}</span>`), () => this.openSettings('system', this.sys), 'sys-settings'));
    if (!back) tools.append(nav(el('div', 'kw-chip', `${icon('i-folder')}<span>${t('Ajouter des jeux')}</span>`), () => this.open({ what: 'games' }), 'add-games'));
    if (!back) tools.append(nav(el('div', 'kw-chip', `${icon('i-gear')}<span>${t('Gérer')}</span>`), () => this.openManage(), 'manage'));
    h.append(tools);
    return h;
  },
  hero() {
    const h = el('div', 'kw-hero', '<div class="kw-bg a"></div><div class="kw-bg b"></div><div class="kw-shade"></div><div class="kw-hero-in"></div>');
    this.heroEl = h;
    this.heroBg = null;
    return h;
  },
  gameTile(g, prefix) {
    const tile = el('div', 'kw-tile game' + (favs.has(g.id) ? ' fav' : ''));
    tile.dataset.gid = g.id;
    tile.style.setProperty('--c', LOOK[g.system] || '#7c9eff');
    tile.append(cover(g));
    tile.insertAdjacentHTML('beforeend', `<div class="kw-name">${esc(g.name)}</div>`);
    return nav(tile, () => { this.sel = g; this.play(); }, prefix + g.id);
  },
  sysTile(s) {
    const tile = el('div', 'kw-tile sys' + (VIRTUAL[s.id] ? ' virtual' : ''));
    tile.dataset.sys = s.id;
    tile.style.setProperty('--c', VIRTUAL[s.id] ? 'var(--accent)' : LOOK[s.id] || '#7c9eff');
    const games = this.gamesOf(s.id).sort((a, b) => hasArt(b) - hasArt(a) || lastPlayedFirst(a, b)).slice(0, 3);
    const fan = el('div', 'kw-fan n' + games.length);
    games.forEach((g, i) => { const c = cover(g); c.classList.add('f' + i); fan.append(c); });
    tile.append(el('div', 'kw-sysbg'), fan);
    tile.insertAdjacentHTML('beforeend', `<div class="kw-sysname"><small>${esc(VIRTUAL[s.id] ? t('Toutes les consoles') : s.maker || '')}</small><b>${esc(VIRTUAL[s.id] ? VIRTUAL[s.id]() : brandOf(s.id))}</b><i>${tn(s.count, '{n} jeu', '{n} jeux')}</i></div>`);
    return nav(tile, () => this.openConsole(s.id), 'c:' + s.id);
  },
  row(key, title, tiles) {
    const sec = el('section', 'kw-sec');
    sec.dataset.row = key;
    sec.append(el('h3', '', esc(title)));
    const strip = el('div', 'kw-row row');
    strip.append(...tiles);
    sec.append(strip);
    return sec;
  },

  // ---------------------------------------------------------------- accueil
  consoleOrder() { const s = this.systems().map(x => x.id); return s.length > 1 ? ['all', ...s] : s; },
  drawHub() {
    const roms = this.roms();
    const systems = this.systems();
    const root = el('div', 'kw hub');
    root.append(this.head(t('Émulation'), `${tn(roms.length, '{n} jeu', '{n} jeux')} · ${tn(systems.length, '{n} console', '{n} consoles')}`));
    root.append(this.hero());
    const body = el('div', 'kw-body');
    const recent = roms.filter(g => g.lastPlayed).sort(lastPlayedFirst).slice(0, 12);
    if (recent.length) body.append(this.row('recent', t('Reprendre'), recent.map(g => this.gameTile(g, 'r:'))));
    const cards = [...(systems.length > 1 ? [this.sysInfo('all')] : []), ...systems].map(s => this.sysTile(s));
    body.append(this.row('sys', t('Consoles'), cards));
    const fav = roms.filter(g => favs.has(g.id)).sort((a, b) => a.name.localeCompare(b.name, locale));
    if (fav.length) body.append(this.row('fav', t('Favoris'), fav.map(g => this.gameTile(g, 'f:'))));
    const fresh = roms.filter(g => g.added).sort((a, b) => b.added - a.added).slice(0, 12);
    if (roms.length > 4 && fresh.length) body.append(this.row('new', t('Ajoutés récemment'), fresh.map(g => this.gameTile(g, 'n:'))));
    root.append(body);
    this.tint(null);
    this.el.replaceChildren(root);
  },
  toHub() {
    this.view = 'hub';
    sfx('back');
    this.draw('c:' + this.sys);
  },
  openConsole(id) {
    if (this.sys !== id) this.filter = 'all';
    this.sys = id;
    store.set('emusys', id);
    this.view = 'console';
    this.lastKey = null;
    const keep = this.pos && this.pos[id];
    this.draw(keep ? 'g:' + keep : null);
  },
  openManage() { this.manage = true; this.draw(); },

  // ---------------------------------------------------------------- une console
  drawConsole() {
    const s = this.sysInfo(this.sys);
    const all = this.gamesOf(this.sys);
    if (!s || !all.length) { this.view = 'hub'; this.drawHub(); return; }
    this.pos = this.pos || store.get('emupos', {});
    this.filter = this.filter || 'all';
    const list = this.filter === 'fav' ? all.filter(g => favs.has(g.id)) : this.filter === 'recent' ? all.filter(g => g.lastPlayed).sort(lastPlayedFirst) : all;
    this.list = list;
    const root = el('div', 'kw console');
    root.style.setProperty('--sys', VIRTUAL[s.id] ? 'var(--accent)' : LOOK[s.id] || 'var(--accent)');
    root.append(this.head(VIRTUAL[s.id] ? VIRTUAL[s.id]() : s.name, [VIRTUAL[s.id] ? '' : s.maker, tn(all.length, '{n} jeu', '{n} jeux')].filter(Boolean).join(' · '), true));
    root.append(this.hero());
    const body = el('div', 'kw-body');
    const chips = el('div', 'kw-filters');
    for (const [k, l] of [['all', t('Tous')], ['fav', t('Favoris')], ['recent', t('Joués récemment')]]) {
      chips.append(nav(el('div', 'kw-filter' + (this.filter === k ? ' on' : ''), esc(l)), () => { this.filter = k; this.draw('filter:' + k); }, 'filter:' + k));
    }
    body.append(chips);
    const grid = el('div', 'kw-grid');
    if (!list.length) grid.append(el('div', 'kw-empty', this.filter === 'fav' ? t('Pas encore de favori ici : X sur un jeu l’ajoute.') : t('Aucun jeu lancé pour l’instant.')));
    list.forEach(g => grid.append(this.gameTile(g, 'g:')));
    body.append(grid, el('div', 'kw-letter'));
    root.append(body);
    this.tint(VIRTUAL[s.id] ? null : s);
    this.el.replaceChildren(root);
  },
  /** Gâchettes : premier jeu de la lettre suivante (ou précédente). */
  jumpLetter(dir) {
    const tiles = [...this.el.querySelectorAll('.kw-grid .kw-tile')];
    const cur = this.el.querySelector('.kw-grid .kw-tile.focused');
    if (!tiles.length) return;
    let i = Math.max(0, tiles.indexOf(cur));
    const letterOf = tile => firstLetter({ name: tile.querySelector('.kw-name').textContent });
    const from = letterOf(tiles[i]);
    if (dir > 0) { while (i < tiles.length && letterOf(tiles[i]) === from) i++; if (i >= tiles.length) return; }
    else {
      while (i > 0 && letterOf(tiles[i - 1]) === from) i--;
      if (tiles[i] === cur && i > 0) { const prev = letterOf(tiles[i - 1]); i--; while (i > 0 && letterOf(tiles[i - 1]) === prev) i--; }
    }
    setFocus(tiles[i]);
    const l = this.el.querySelector('.kw-letter');
    l.textContent = letterOf(tiles[i]);
    l.classList.remove('show'); void l.offsetWidth; l.classList.add('show');
  },

  // ---------------------------------------------------------------- tuile choisie : la bannière suit
  onFocus(target) {
    if (this.mode === 'manage' || !target || !this.el.contains(target)) return;
    const key = target.dataset.key;
    if (target.dataset.gid || target.dataset.sys) {
      this.lastKey = key;
      if (target.dataset.gid) {
        this.sel = this.roms().find(g => g.id === target.dataset.gid) || null;
        if (this.mode === 'console' && this.sel) { this.pos[this.sys] = this.sel.id; store.set('emupos', this.pos); }
        this.selSys = null;
      } else { this.selSys = target.dataset.sys; this.sel = null; }
      clearTimeout(this.heroTimer);
      this.heroTimer = setTimeout(() => this.paintHero(), 70);
      renderHints();
    }
  },
  current() { return this.sel || null; },
  play() { const g = this.current(); if (g) launch(g); },
  setHeroBg(url) {
    if (!this.heroEl || url === this.heroBg) return;
    this.heroBg = url;
    const [a, b] = this.heroEl.querySelectorAll('.kw-bg');
    const next = a.classList.contains('on') ? b : a, prev = next === a ? b : a;
    next.style.backgroundImage = url ? `url("${url}")` : 'none';
    next.classList.add('on'); prev.classList.remove('on');
    if (url) setBackground(url);
  },
  paintHero() {
    const box = this.heroEl && this.heroEl.querySelector('.kw-hero-in');
    if (!box || !box.isConnected) return;
    const keep = box.querySelector('.focused')?.dataset.key;
    const btn = (cls, ic, text, fn, key, glyphKey) => nav(el('div', 'kw-btn ' + cls, `${icon(ic)}<span>${text}</span>${glyphKey ? shoulder(glyphKey).outerHTML : ''}`), fn, key);
    const acts = el('div', 'kw-acts');
    if (this.sel) {
      const g = this.sel;
      const m = metaCache.get(g.id);
      if (!m) this.loadMeta(g);
      this.setHeroBg(heroOf(g));
      this.heroEl.style.setProperty('--c', LOOK[g.system] || 'var(--accent)');
      const bits = [brandOf(g.system)];
      if (m?.year) bits.push(m.year);
      if (m?.genre) bits.push(m.genre);
      if (m?.players > 1) bits.push(tn(m.players, '{n} joueur', '{n} joueurs'));
      const played = g.lastPlayed ? t('Dernière partie : {d}', { d: fmt.played(g.lastPlayed) }) + (g.playtime ? ' · ' + fmt.playtime(g.playtime) : '') : t('Jamais joué');
      const logo = g.art && g.art.logo;
      box.innerHTML = `<div class="kw-logo">${logo ? `<img src="${logo}" alt="${esc(g.name)}">` : ''}<h1${logo ? ' hidden' : ''}>${favs.has(g.id) ? '<i class="kw-star">★</i>' : ''}${esc(g.name)}</h1></div>
        <p class="kw-meta">${bits.map(b => esc(String(b))).join('<i>·</i>')}</p><p class="kw-played">${esc(played)}</p>
        ${m?.description ? `<p class="kw-desc">${esc(m.description)}</p>` : ''}`;
      const img = box.querySelector('.kw-logo img');
      // Logo illisible ou absent : le nom en texte
      if (img) img.onerror = () => { img.remove(); box.querySelector('.kw-logo h1').hidden = false; };
      acts.append(btn('primary', 'i-play', t('Jouer'), () => this.play(), 'h-play', 'a'));
      acts.append(btn('', 'i-info', t('Fiche'), () => this.openSheet(), 'h-sheet', 'y'));
      acts.append(btn(favs.has(g.id) ? 'on' : '', 'i-star', favs.has(g.id) ? t('Favori') : t('Ajouter aux favoris'), () => this.toggleFav(), 'h-fav', 'x'));
    } else if (this.selSys) {
      const s = this.sysInfo(this.selSys);
      const games = this.gamesOf(s.id);
      const last = games.filter(g => g.lastPlayed).sort(lastPlayedFirst)[0];
      this.setHeroBg(heroOf(last) || games.map(heroOf).find(Boolean) || null);
      this.heroEl.style.setProperty('--c', VIRTUAL[s.id] ? 'var(--accent)' : LOOK[s.id] || 'var(--accent)');
      const minutes = games.reduce((n, g) => n + (g.playtime || 0), 0);
      const bits = VIRTUAL[s.id] ? [tn(this.systems().length, '{n} console', '{n} consoles')] : [s.maker, YEAR[s.id], kindOf(s.id)];
      box.innerHTML = `<div class="kw-logo"><h1 class="sys">${esc(VIRTUAL[s.id] ? VIRTUAL[s.id]() : s.name)}</h1></div>
        <p class="kw-meta">${bits.filter(Boolean).map(b => esc(String(b))).join('<i>·</i>')}</p>
        <p class="kw-played">${esc([tn(games.length, '{n} jeu', '{n} jeux'), minutes ? t('{t} de jeu', { t: fmt.playtime(minutes) }) : '', last ? t('Dernier : {name}', { name: last.name }) : ''].filter(Boolean).join(' · '))}</p>`;
      acts.append(btn('primary', 'i-library', t('Voir les jeux'), () => this.openConsole(s.id), 'h-enter', 'a'));
      if (!VIRTUAL[s.id]) acts.append(btn('', 'i-palette', t('Réglages de la console'), () => this.openSettings('system', s.id), 'h-settings', 'y'));
    } else return;
    box.append(acts);
    if (keep) { const f = box.querySelector(`[data-key="${keep}"]`); if (f) setFocus(f, { scroll: false, sound: false }); }
  },
  toggleFav() {
    const g = this.current();
    if (!g) return;
    toggleFav(g);
    this.el.querySelectorAll(`.kw-tile[data-gid="${CSS.escape(g.id)}"]`).forEach(x => x.classList.toggle('fav', favs.has(g.id)));
    this.paintHero();
    if (this.sheet && this.sheet.view === 'info') this.drawSheetInfo('s-fav');
  },
  async loadMeta(g) {
    if (this.metaLoading === g.id) return;
    this.metaLoading = g.id;
    try {
      const r = await api.get('/api/emu/game?id=' + encodeURIComponent(g.id));
      metaCache.set(g.id, r.meta || {});
    } catch { metaCache.set(g.id, {}); }
    this.metaLoading = null;
    if (this.sel === g) {
      this.paintHero();
      if (this.sheet && this.sheet.view === 'info') this.drawSheetInfo();
    }
  },

  // ---------------------------------------------------------------- fiche (glisse par-dessus)
  sheetEl() {
    if (!this.sheetBox) {
      const s = el('aside', 'layer panel emu-sheet');
      s.id = 'emu-sheet';
      s.setAttribute('role', 'dialog');
      s.setAttribute('aria-modal', 'true');
      s.setAttribute('aria-hidden', 'true');
      s.inert = true;
      document.body.append(s);
      this.sheetBox = s;
    }
    return this.sheetBox;
  },
  /** Ouvre la fiche du jeu (view 'info') ou directement les réglages d'une console. */
  async openSheet(view = 'info', scope = 'game', sysId = null) {
    if (this.sheet) return;
    const g = this.current();
    if (view === 'info' && !g) return;
    const box = this.sheetEl();
    this.sheet = { view, from: view, scope, sysId: sysId || (g && g.system), g };
    if (view === 'info') this.drawSheetInfo(null, true);
    else await this.drawSheetSettings(null, true);
    box.scrollTop = 0;
    box.style.setProperty('--sys', this.sheet.sysId && LOOK[this.sheet.sysId] ? LOOK[this.sheet.sysId] : 'var(--accent)');
    const page = this;
    this.sheetLayer = openLayer({
      el: box, name: 'emu-sheet', scrim: true, focusKey: view === 'info' ? 's-play' : box.querySelector('[data-setting]')?.dataset.key,
      hints: () => (page.sheet && page.sheet.view === 'settings'
        ? [[['left', 'right'], t('Changer')], ['b', page.sheet.from === 'info' ? t('Retour') : t('Fermer')]]
        : [['x', t('Favori')], ['a', t('Choisir')], ['b', t('Fermer')]]),
      button: k => page.sheetButton(k),
      onClose: () => {
        const dirty = page.sheet && page.sheet.dirty;
        page.sheet = null;
        page.sheetLayer = null;
        if (dirty) page.reload(page.focusedKey());
      },
    });
  },
  closeSheet() { if (this.sheetLayer) closeLayer(this.sheetLayer); },
  sheetButton(k) {
    const s = this.sheet;
    if (!s) return false;
    const f = this.sheetBox.querySelector('.focused');
    if (s.view === 'settings') {
      if ((k === 'left' || k === 'right') && f && f.dataset.setting) { this.changeSetting(f.dataset.setting, k === 'right' ? 1 : -1); return true; }
      if (k === 'b' && s.from === 'info') { s.view = 'info'; this.drawSheetInfo('s-settings'); sfx('back'); return true; }
      if (k === 'y') { this.closeSheet(); return true; }
      return false;
    }
    if (k === 'x') { this.toggleFav(); return true; }
    if (k === 'y') { this.closeSheet(); return true; }
    return false;
  },
  drawSheetInfo(focusKey, opening) {
    const g = this.sheet.g;
    const p = this.sheetBox;
    const m = metaCache.get(g.id);
    const hero = g.art && (g.art.hero || g.art.header);
    const chips = [];
    if (m?.year) chips.push(esc(m.year));
    if (m?.genre) chips.push(esc(m.genre));
    if (m?.players) chips.push(esc(tn(m.players, '{n} joueur', '{n} joueurs')));
    if (g.discs) chips.push(esc(tn(g.discs, '{n} disque', '{n} disques')));
    const played = g.lastPlayed ? fmt.played(g.lastPlayed) + (g.playtime ? ' · ' + fmt.playtime(g.playtime) : '') : t('Jamais joué');
    p.innerHTML = `
      <div class="sxp-head" style="${hero ? `--hero:url('${hero}')` : ''}">
        <div class="sxp-cover">${g.art && g.art.portrait ? `<img src="${g.art.portrait}" alt="" onerror="this.remove()">` : ''}</div>
        <div class="sxp-title">
          <small>${esc(brandOf(g.system))}</small>
          <h2>${esc(g.name)}</h2>
          <div class="sxp-chips">${chips.map(c => `<span>${c}</span>`).join('')}${favs.has(g.id) ? '<span class="fav">★</span>' : ''}</div>
          <p>${esc(played)}</p>
        </div>
      </div>
      <div class="es-acts"></div>
      <div class="sxp-desc ${m ? '' : 'loading'}">${m ? (m.description ? `<p>${esc(m.description)}</p>${m.descriptionUrl ? `<small class="sxp-src">${t('Source : Wikipédia')}</small>` : ''}` : `<p class="muted">${t('Pas de description trouvée pour ce jeu.')}</p>`) : '<i class="spinner"></i>'}</div>
      <div class="sxp-shots">${['hero', 'header'].map(k => g.art && g.art[k] ? `<img src="${g.art[k]}" alt="" onerror="this.remove()">` : '').join('')}</div>
      <div class="sxp-tiles">${[[t('Développeur'), m?.developer], [t('Éditeur'), m?.publisher], [t('Région'), g.region],
    [t('Émulateur'), g.emulator ? g.emulator + (g.core ? ` · ${g.core}` : '') : '']].filter(([, v]) => v).map(([k, v]) => `<div><small>${k}</small><b>${esc(v)}</b></div>`).join('')}</div>`;
    const acts = p.querySelector('.es-acts');
    const row = (cls, ic, label, fn, key) => acts.append(nav(el('div', 'es-row ' + cls, `${icon(ic)}<span>${label}</span>`), fn, key));
    row('play', 'i-play', t('Jouer'), () => { this.closeSheet(); this.play(); }, 's-play');
    row(favs.has(g.id) ? 'on' : '', 'i-star', favs.has(g.id) ? t('Retirer des favoris') : t('Ajouter aux favoris'), () => this.toggleFav(), 's-fav');
    row('', 'i-gear', t('Réglages du jeu'), () => { this.sheet.view = 'settings'; this.sheet.scope = 'game'; this.drawSheetSettings(); }, 's-settings');
    row('', 'i-image', t('Jaquette et visuels'), () => { this.closeSheet(); go('artpicker', { id: g.id }); }, 's-art');
    row('', 'i-info', t('Fiche KaneMode'), () => { this.closeSheet(); go('game', { id: g.id }); }, 's-sheet');
    row('', 'i-folder', t('Ouvrir le dossier'), () => this.open({ system: g.system }), 's-folder');
    // La description se lit en descendant : elle prend le focus pour faire défiler la fiche
    nav(p.querySelector('.sxp-desc'), () => {}, 's-desc');
    if (!opening) {
      focusIn(p, focusKey || 's-play', { scroll: false });
      renderHints();
    }
  },

  /** Réglages du jeu ou de la console : une ligne par réglage, ◀ ▶ pour changer, enregistré tout de suite. */
  async drawSheetSettings(focusKey, opening) {
    const s = this.sheet;
    const g = s.g;
    const sysId = s.scope === 'system' ? s.sysId : g.system;
    const sys = this.data.systems.find(x => x.id === sysId);
    if (!sys) return;
    const r = await api.get(`/api/emu/settings?system=${encodeURIComponent(sysId)}&id=${encodeURIComponent(g && s.scope === 'game' ? g.id : '')}`);
    if (!this.sheet) return;
    const own = (s.scope === 'game' ? r.game : r.system) || {};
    const base = s.scope === 'game' ? (r.system || {}) : {};
    const emuName = id => (sys.emus.find(e => e.id === id) || {}).name || id;
    const defEmu = (s.scope === 'game' && !base.emulator && g.emulatorId) || (sys.emus[0] || {}).id;
    const d = r.defaults || {};
    const inherited = { emulator: base.emulator || defEmu, core: base.core || sys.cores[0], filter: base.filter || d.filter || 'none', aspect: base.aspect || d.aspect || 'auto',
      quality: base.quality || d.quality || 'auto', wide: base.wide || d.wide || 'off' };
    const value = k => (own[k] !== undefined ? own[k] : inherited[k]);
    const emuId = value('emulator');
    const options = {
      emulator: sys.emus.map(e => [e.id, e.name]),
      core: sys.cores.map(c => [c, c]),
      filter: FILTERS(),
      aspect: ASPECTS(),
      quality: QUALITIES(),
      wide: WIDES(),
    };
    s.state = { sysId, own, options, inherited };
    const kinds = [];
    if (sys.emus.length > 1) kinds.push(['emulator', t('Émulateur'), 'i-gamepad']);
    if (emuId === 'retroarch' && sys.cores.length > 1) kinds.push(['core', t('Cœur RetroArch'), 'i-cpu']);
    if (emuId === 'retroarch') kinds.push(['filter', t('Filtre d’image'), 'i-palette']);
    if (QUALITY_EMUS.includes(emuId) || (emuId === 'retroarch' && sysId === 'n64')) kinds.push(['quality', t('Qualité de l’image'), 'i-image']);
    if (WIDE_EMUS.includes(emuId)) kinds.push(['wide', t('Écran large (16:9)'), 'i-desktop']);
    if (ASPECT_EMUS.includes(emuId) && value('wide') !== 'on') kinds.push(['aspect', t('Format de l’image'), 'i-desktop']);
    const p = this.sheetBox;
    const auto = s.scope === 'game' ? t('comme la console') : t('par défaut');
    p.innerHTML = `<div class="es-head"><small>${s.scope === 'game' ? t('Réglages du jeu') : t('Réglages de la console')}</small>
      <h2>${esc(s.scope === 'game' ? g.name : sys.name)}</h2>
      <p>${s.scope === 'game' ? t('Pour ce jeu seulement. Ce qui n’est pas changé ici suit les réglages de la console.') : t('Pour tous les jeux de cette console, sauf ceux qui ont leurs propres réglages.')}</p></div>
      <div class="es-sets"></div>`;
    const list = p.querySelector('.es-sets');
    if (!kinds.length) list.append(el('div', 'notice', t('{name} se règle tout seul : rien à choisir ici.', { name: esc(emuName(emuId)) })));
    for (const [k, title, ic] of kinds) {
      const v = value(k);
      const shown = k === 'emulator' ? emuName(v) : label(options[k], v) || v;
      const row = el('div', 'es-set', `${icon(ic)}<div class="txt"><b>${title}</b><small>${own[k] !== undefined ? t('choisi ici') : auto}</small></div>
        <div class="es-val"><i class="prev">◀</i><span>${esc(shown)}</span><i class="next">▶</i></div>`);
      row.dataset.setting = k;
      row.querySelector('.prev').addEventListener('click', e => { e.stopPropagation(); this.changeSetting(k, -1); });
      row.querySelector('.next').addEventListener('click', e => { e.stopPropagation(); this.changeSetting(k, 1); });
      list.append(nav(row, () => this.changeSetting(k, 1), 'set:' + k));
    }
    if (Object.keys(own).length) {
      list.append(nav(el('div', 'es-row', `${icon('i-refresh')}<span>${s.scope === 'game' ? t('Revenir aux réglages de la console') : t('Revenir aux réglages par défaut')}</span>`), async () => {
        await this.saveSetting({ emulator: null, core: null, filter: null, aspect: null });
        await this.drawSheetSettings();
      }, 'set-reset'));
    }
    if (s.from === 'info') list.append(nav(el('div', 'es-row back', `${icon('i-chevron')}<span>${t('Retour à la fiche')}</span>`), () => { s.view = 'info'; this.drawSheetInfo('s-settings'); }, 'set-back'));
    if (!opening) {
      const want = focusKey && p.querySelector(`[data-key="${CSS.escape(focusKey)}"]`) ? focusKey : (p.querySelector('[data-setting]') || p.querySelector('[data-nav]'))?.dataset.key;
      focusIn(p, want, { scroll: false });
      renderHints();
    }
  },
  async saveSetting(values) {
    const s = this.sheet;
    await api.post('/api/emu/settings', { scope: s.scope, id: s.scope === 'game' ? s.g.id : s.state.sysId, values });
    s.dirty = true;
  },
  async changeSetting(k, dir) {
    const s = this.sheet;
    if (!s || !s.state || this.saving) return;
    this.saving = true;
    try {
      // « Automatique » montre déjà la valeur héritée : elle n'est pas proposée une seconde fois
      const opts = [null, ...s.state.options[k].map(o => o[0]).filter(v => v !== s.state.inherited[k])];
      const cur = s.state.own[k] === undefined ? null : s.state.own[k];
      const i = Math.max(0, opts.indexOf(cur));
      const v = opts[(i + dir + opts.length) % opts.length];
      const values = { [k]: v };
      if (k === 'emulator') values.core = null;
      sfx('move');
      await this.saveSetting(values);
      await this.drawSheetSettings('set:' + k);
    } catch (e) { toast(e.message, { error: true }); }
    this.saving = false;
  },
  /** Réglages d'une console, depuis l'accueil (Y) ou le bouton « Réglages » de la console. */
  openSettings(scope, sysId) { this.openSheet('settings', scope, sysId); },

  tint(s) {
    const all = !s || s.id === 'all';
    if (all) document.body.style.removeProperty('--emu');
    else document.body.style.setProperty('--emu', lookOf(s).color);
    document.body.dataset.emuMotif = all ? 'scan' : lookOf(s).motif;
  },

  // ---------------------------------------------------------------- gérer
  drawManage(focusKey) {
    const d = this.data;
    const roms = this.roms();
    this.tint(null);
    const page = el('div', 'emu');
    const head = el('div', 'emu-hero', `<div class="emu-title"><span class="emu-tag">${t('Rétro')}</span><h1>${t('Émulation')}</h1>
      <p>${roms.length ? tn(roms.length, '{n} jeu', '{n} jeux') : t('Ajoutez vos jeux, KaneMode s’occupe du reste')}</p></div>`);
    const actions = el('div', 'emu-actions');
    const chip = (ic, label, fn, key, primary) => actions.append(nav(el('div', 'chip-btn' + (primary ? ' primary' : ''), `${icon(ic)}${label}`), fn, key));
    if (roms.length) chip('i-library', t('Retour aux jeux'), () => { this.manage = false; this.draw(); }, 'back-shelf', true);
    chip('i-folder', t('Dossier des jeux'), () => this.open({ what: 'games' }), 'open-games', !roms.length);
    chip('i-rom', t('BIOS'), () => this.biosDialog(), 'bios');
    head.append(actions);
    page.append(head);
    if (!roms.length) {
      page.append(el('div', 'emu-welcome', `
        <div class="emu-step"><b>1</b><div><strong>${t('Ouvrez le dossier des jeux')}</strong><small>${esc(d.dirs.games)}</small></div></div>
        <div class="emu-step"><b>2</b><div><strong>${t('Déposez chaque jeu dans le dossier de sa console')}</strong><small>${t('« Super Nintendo », « PlayStation 2 »… un dossier par console est déjà prêt')}</small></div></div>
        <div class="emu-step"><b>3</b><div><strong>${t('Jouez')}</strong><small>${t('Au premier jeu d’une console, KaneMode installe son émulateur et le règle : écran, manette, sauvegardes')}</small></div></div>`));
    }
    page.append(this.emulatorsSection(), this.advancedSection());
    if (d.cacheBytes) {
      const c = el('div', 'emu-panel settings');
      c.append(el('h2', '', `${icon('i-drive')}${t('Jeux décompressés')}`));
      c.append(el('div', 'notice', t('Les jeux rangés dans une archive (.zip, .7z, .rar) que leur émulateur ne sait pas ouvrir sont décompressés au premier lancement, puis gardés pour les suivants. Les plus anciens partent tout seuls au-delà de 40 Go.')));
      c.append(nav(el('div', 'set-row nav', `${icon('i-trash')}<div class="txt"><b>${t('Vider le cache')}</b><small>${esc(fmt.size(d.cacheBytes))}</small></div><span></span>`), async () => {
        if (!(await confirmDialog(t('Vider le cache ?'), t('Vos archives restent dans le dossier des jeux : elles seront décompressées de nouveau au prochain lancement.'), t('Vider'), true))) return;
        const r = await api.post('/api/emu/cache/clear');
        toast(t('{size} libérés', { size: fmt.size(r.freed) }));
        await this.reload('cache');
      }, 'cache'));
      page.append(c);
    }
    this.el.replaceChildren(page);
    focusIn(this.el, focusKey || (roms.length ? 'back-shelf' : 'open-games'));
    if (!this.checked) { this.checked = true; this.checkUpdates(); }
  },
  async open(what) {
    try { await api.post('/api/emu/open', what); toast(t('Dossier ouvert dans l’Explorateur')); }
    catch (e) { toast(e.message, { error: true }); }
  },
  async biosDialog() {
    const rows = this.data.systems.filter(s => s.bios)
      .map(s => `<li><span class="${s.bios.ok ? 'dot-ok' : 'dot-ko'}"></span><b>${esc(s.name)}</b> · ${esc(s.bios.what)}</li>`).join('');
    const c = await dialog({
      title: t('BIOS et clés'),
      text: t('Certaines consoles ont besoin d’un fichier venant de votre propre console. Déposez-le dans le dossier BIOS : KaneMode le donne à l’émulateur.') + `<ul class="emu-bios">${rows}</ul>`,
      buttons: [{ label: t('Ouvrir le dossier BIOS'), value: 'open', icon: 'i-folder', primary: true }, { label: t('Fermer'), value: null }],
    });
    if (c === 'open') this.open({ what: 'bios' });
  },

  // Versions publiées vues au dernier contrôle, gardées quand la liste est relue sans contrôle
  withLatest(list) {
    const old = new Map(((this.data && this.data.emulators) || []).map(e => [e.id, e]));
    return list.map(e => {
      const latest = e.latest !== undefined ? e.latest : old.get(e.id)?.latest;
      return { ...e, latest, update: !!(e.installed && latest && latest !== e.version) };
    });
  },
  emulatorsSection() {
    const box = el('div', 'emu-panel settings');
    box.append(el('h2', '', `${icon('i-gamepad')}${t('Émulateurs installés par KaneMode')}`));
    box.append(el('div', 'notice', t('Chaque émulateur vient de son site officiel et s’installe au premier jeu de sa console. Ses réglages et vos sauvegardes restent dans {dir}.', { dir: `<code>${esc(this.data.dirs.home)}</code>` })));
    const updates = this.data.emulators.filter(e => e.update);
    if (updates.length) {
      box.append(nav(el('div', 'set-row nav', `${icon('i-download2')}<div class="txt"><b>${t('Tout mettre à jour')}</b><small>${esc(updates.map(e => e.name).join(', '))}</small></div><span></span>`),
        () => this.install(updates.map(e => e.id)), 'emu-update-all'));
    }
    for (const e of this.data.emulators) {
      const job = (this.data.jobs || []).find(j => j.id === e.id);
      const desc = job && job.busy ? jobText(job)
        : e.installed ? (e.update ? t('Version {v} · version {latest} disponible', { v: esc(e.version), latest: esc(e.latest) }) : t('Version {v}', { v: esc(e.version) }) + (e.latest ? ' · ' + t('à jour') : ''))
          : t('Non installé · environ {size} Mo', { size: e.size });
      const r = el('div', 'set-row nav', `<span class="${e.installed ? 'dot-ok' : 'dot-ko'}"></span><div class="txt"><b>${esc(e.name)}${e.experimental ? ` <i class="emu-exp">${t('expérimental')}</i>` : ''}</b><small>${desc}</small></div><span></span>`);
      r.style.gridTemplateColumns = 'auto 1fr auto';
      box.append(nav(r, async () => {
        const c = await dialog({
          title: e.name, text: e.installed ? esc(e.dir) : t('{name} s’installera tout seul au premier jeu. Vous pouvez aussi l’installer maintenant.', { name: esc(e.name) }),
          buttons: [{ label: e.installed ? t('Réinstaller ou mettre à jour') : t('Installer maintenant'), value: 'install', icon: 'i-download2', primary: true }, { label: t('Fermer'), value: null }],
        });
        if (c === 'install') this.install([e.id]);
      }, 'emu:' + e.id));
    }
    return box;
  },
  async checkUpdates() {
    try {
      const d = await api.get('/api/emu/world?check=1');
      this.data = { ...d, emulators: this.withLatest(d.emulators) };
      if (this.el.classList.contains('active') && this.mode === 'manage') this.draw(this.focusedKey());
    } catch { /* hors ligne : la liste reste sans versions */ }
  },
  focusedKey() { return this.el.querySelector('.focused')?.dataset.key || null; },
  async install(ids) {
    await api.post('/api/emu/install', { ids });
    toast(tn(ids.length, 'Installation lancée', '{n} installations lancées'));
    clearInterval(this.poll);
    this.poll = setInterval(async () => {
      const d = await api.get('/api/emu/world').catch(() => null);
      if (!d) return;
      this.data = { ...d, emulators: this.withLatest(d.emulators) };
      if (this.el.classList.contains('active') && this.mode === 'manage') this.draw(this.focusedKey());
      if (!d.jobs.some(j => j.busy)) { clearInterval(this.poll); this.poll = null; lib.load({ background: true }); }
    }, 800);
  },
  advancedSection() {
    const d = this.data;
    const s = el('div', 'emu-panel settings');
    const row = (lead, title, desc, act, key) => s.append(nav(el('div', 'set-row nav', `${lead}<div class="txt"><b>${title}</b><small>${desc}</small></div><span></span>`), act, key));
    s.append(el('h2', '', `${icon('i-folder')}${t('Autres dossiers de jeux')}`));
    s.append(el('div', 'notice', t('Vous avez déjà une collection rangée ailleurs (EmulationStation-DE, RetroBat…) ? Ajoutez son dossier : un sous-dossier par console, comme <code>D:\\ROMs\\snes</code>.')));
    for (const r of d.romRoots) {
      const n = lib.games.filter(g => g.source === 'rom' && g.romPath && g.romPath.toLowerCase().startsWith(r.toLowerCase())).length;
      row(icon('i-folder'), esc(r), tn(n, '{n} jeu trouvé', '{n} jeux trouvés'), async () => {
        if (!(await confirmDialog(t('Retirer ce dossier ?'), esc(r), t('Retirer'), true))) return;
        await api.post('/api/config', { romRoots: d.romRoots.filter(x => x !== r) });
        await this.reload('add-root');
        toast(t('Dossier retiré'));
      }, 'root:' + r);
    }
    row(icon('i-plus'), t('Ajouter un dossier de jeux…'), t('Choisir un dossier avec la manette'), async () => {
      const p = await pickFile('dir', t('Choisir un dossier de jeux'));
      if (!p) return;
      busy(t('Recherche des jeux…'));
      await api.post('/api/config', { romRoots: [...d.romRoots, p] });
      busy(null);
      await this.reload('add-root');
    }, 'add-root');
    row(icon('i-refresh'), t('Rechercher les jeux maintenant'), d.scanned ? t('Dernière recherche : {d}', { d: new Date(d.scanned).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) }) : '', async () => {
      busy(t('Recherche des jeux…'));
      try { const r = await api.post('/api/roms/scan'); toast(tn(r.count, '{n} jeu trouvé', '{n} jeux trouvés')); }
      catch (e) { toast(e.message, { error: true }); }
      busy(null);
      await this.reload('scan');
    }, 'scan');
    s.append(el('h2', '', `${icon('i-gamepad')}${t('Vos propres émulateurs')}`));
    s.append(el('div', 'notice', t('Un émulateur installé par vous et indiqué ici passe avant celui de KaneMode.')));
    row(icon('i-folder'), t('Indiquer un émulateur…'), t('Son exécutable, par exemple retroarch.exe'), async () => {
      const p = await pickFile('exe', t('Exécutable de l’émulateur'));
      if (!p) return;
      const all = await api.get('/api/emulation');
      const name = p.split('\\').pop().toLowerCase();
      const match = all.emulators.find(e => name.includes(e.id) || e.name.toLowerCase().split(/[ /]/).some(w => w.length > 3 && name.includes(w)));
      if (!match) return toast(t('Émulateur non reconnu'), { error: true });
      await api.post('/api/config', { emulatorPaths: { [match.id]: p } });
      await this.reload('own-emu');
      toast(t('{name} sera utilisé', { name: match.name }));
    }, 'own-emu');
    return s;
  },
  async reload(focus) {
    await lib.load({ background: true });
    const d = await api.get('/api/emu/world');
    this.data = { ...d, emulators: this.withLatest(d.emulators) };
    this.draw(focus);
  },

  // ---------------------------------------------------------------- manette
  button(k) {
    if (!this.data) return false;
    if (this.mode === 'manage') {
      if (k === 'b' && this.roms().length) { this.manage = false; this.draw(); return true; }
      return false;
    }
    const focused = this.el.querySelector('.focused');
    const onGame = focused && (focused.dataset.gid || this.el.querySelector('.kw-hero')?.contains(focused)) && this.sel;
    if (k === 'x') { if (onGame) this.toggleFav(); return true; }
    if (k === 'y') {
      if (onGame) this.openSheet();
      else if (this.selSys && !VIRTUAL[this.selSys]) this.openSettings('system', this.selSys);
      return true;
    }
    // Des boutons de la bannière, ↑ mène aux boutons de l'en-tête (Gérer, Réglages, Consoles)
    if (k === 'up' && focused && this.heroEl && this.heroEl.contains(focused)) {
      const head = this.el.querySelector(this.mode === 'hub' ? '[data-key="add-games"]' : '[data-key="to-hub"]');
      if (head) { setFocus(head); return true; }
    }
    if (k === 'down' && focused && focused.closest('.kw-head')) {
      const first = this.heroEl && this.heroEl.querySelector('.kw-btn');
      if (first) { setFocus(first); return true; }
    }
    if (this.mode === 'hub') return false;
    if (k === 'b') { this.toHub(); return true; }
    if (k === 'lb' || k === 'rb') {
      const list = this.consoleOrder();
      const i = list.indexOf(this.sys);
      if (list.length > 1) this.openConsole(list[(Math.max(0, i) + (k === 'rb' ? 1 : -1) + list.length) % list.length]);
      return true;
    }
    if (k === 'lt' || k === 'rt') { this.jumpLetter(k === 'rt' ? 1 : -1); return true; }
    return false;
  },
  hints() {
    if (this.mode === 'manage') return [['a', t('Sélectionner')], ['b', t('Retour')]];
    const game = !!this.sel;
    const list = [];
    if (this.mode === 'console') list.push([['lb', 'rb'], t('<span class="label-long">Console</span>')], [['lt', 'rt'], t('<span class="label-long">Lettre</span>')]);
    if (game) list.push(['x', t('Favori')], ['y', t('Fiche')], ['a', t('Jouer')]);
    else list.push(['y', t('<span class="label-long">Réglages</span>')], ['a', t('Ouvrir')]);
    list.push(['b', this.mode === 'console' ? t('Consoles') : t('Retour')]);
    return list;
  },
});
