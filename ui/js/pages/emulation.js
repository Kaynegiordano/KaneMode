// Monde Émulation, style KaneMode, pensé aussi pour les petits écrans (ROG Ally) : des rangées de
// grandes jaquettes (Reprendre, Consoles, Favoris, Ajoutés récemment, Options) sans bandeau qui
// mange l'écran ; dans une console, la grille de ses jeux. A ouvre la page du jeu : Jouer, Réglages,
// Visuels (jaquette, logo, fond), Infos. « Gérer » : dossier de jeux, BIOS, émulateurs.
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
const firstLetter = g => (g.name.normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z]/i) || ['#'])[0].toUpperCase();

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
// Switch, Switch 2 : qui règle l'émulateur avant le lancement
const PRESETS = () => [['auto', t('Automatique (KaneMode)')], ['ia', t('Preset IA')], ['manual', t('Manuel (rien d’imposé)')]];
const PRESET_EMUS = ['eden', 'lichii', 'lichiimod', 'edenns2'];
const WIDES = () => [['on', t('Oui')], ['off', t('Non')]];
const ASPECT_EMUS = ['retroarch', 'duckstation', 'pcsx2'];
const QUALITY_EMUS = ['duckstation', 'pcsx2', 'dolphin', 'ppsspp', 'azahar', 'eden', 'lichii', 'lichiimod', 'edenns2'];
const WIDE_EMUS = ['duckstation', 'pcsx2', 'dolphin'];
const label = (list, v) => (list.find(([k]) => k === v) || [])[1];

const lastPlayedFirst = (a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0);
const hasArt = g => !!(g.art && g.art.portrait);
const heroOf = g => g && g.art && (g.art.hero || g.art.header);
// Consoles « virtuelles » : tous les jeux, favoris
const VIRTUAL = { all: () => t('Tous les jeux'), fav: () => t('Favoris') };
// Onglets de la page d'un jeu (LB / RB)
// Jeux Switch et Switch 2 : un onglet « Mods » (correctifs 60 FPS, résolution… rangés dans user\load)
const hasMods = g => !!g && (g.system === 'switch' || g.system === 'switch2');
const TABS = g => [['play', t('Jouer'), 'i-play'], ['settings', t('Réglages'), 'i-gear'], ...(hasMods(g) ? [['mods', t('Mods'), 'i-collection']] : []), ['art', t('Visuels'), 'i-image'], ['info', t('Infos'), 'i-info']];
// Visuels qu'on peut changer depuis la page du jeu (écran Visuels de KaneMode)
const ART_KINDS = () => [['portrait', t('Jaquette')], ['logo', t('Logo')], ['hero', t('Fond')], ['header', t('Bannière')]];

/** Jaquette d'un jeu, ou boîte dessinée à ses couleurs si elle manque ou ne se charge pas. */
function cover(g, { lazy = true } = {}) {
  const box = el('div', 'kw-cover');
  box.style.setProperty('--g', LOOK[g.system] || '#7c9eff');
  const gen = () => el('div', 'kw-gen', `<small>${esc(brandOf(g.system))}</small><b>${esc(g.name)}</b>`);
  if (hasArt(g)) {
    const img = new Image();
    img.alt = '';
    if (lazy) img.loading = 'lazy';
    img.decoding = 'async';
    img.onerror = () => { img.replaceWith(gen()); box.style.removeProperty('--img'); };
    img.src = g.art.portrait;
    // Jaquette carrée ou large (PlayStation, Super Nintendo) : entière, sur son propre fond flouté
    box.style.setProperty('--img', `url("${g.art.portrait}")`);
    box.append(img);
  } else box.append(gen());
  return box;
}
const playedText = g => { if (!g.lastPlayed) return t('Jamais joué'); const d = fmt.played(g.lastPlayed); return t('Joué {d}', { d: locale.startsWith('fr') ? d.toLowerCase() : d }); };

definePage('emulation', {
  libBound: true,
  title: () => t('Émulation'),
  initialFocus() {
    if (this.mode === 'manage') return this.roms().length ? 'back-shelf' : 'open-games';
    if (this.mode === 'game') return 'g-play';
    return this.lastKey || (this.mode === 'console' ? 'filter:all' : 'tool:add');
  },
  render(p = {}) {
    document.body.classList.add('emu-world');
    if (!this.data) this.el.innerHTML = t('<div class="loading"><i class="spinner big"></i>Ouverture du monde Émulation…</div>');
    api.get('/api/emu/world').then(d => { this.data = { ...d, emulators: this.withLatest(d.emulators) }; if (this.el.classList.contains('active')) this.draw(p.focus || this.focusedKey()); })
      .catch(e => toast(e.message, { error: true }));
    if (this.data) this.draw(p.focus);
    if (!this.updateAsked) { this.updateAsked = true; this.autoUpdate(); }
  },
  /** Arrivée dans Émulation : les émulateurs installés se mettent à jour en arrière-plan. */
  async autoUpdate() {
    let r;
    try { r = await api.post('/api/emu/autoupdate'); } catch { return; }
    const list = (r && r.updating) || [];
    if (!list.length) return;
    const names = list.map(e => e.name).join(', ');
    toast(t('Mise à jour en arrière-plan : {names}', { names }));
    const ids = list.map(e => e.id);
    const poll = setInterval(async () => {
      const jobs = await api.get('/api/emu/jobs').then(x => x.jobs).catch(() => null);
      if (!jobs || ids.some(id => jobs.some(j => j.id === id && j.busy))) return;
      clearInterval(poll);
      const failed = list.filter(e => jobs.some(j => j.id === e.id && j.phase === 'error'));
      if (failed.length) toast(t('Mise à jour impossible : {names}', { names: failed.map(e => e.name).join(', ') }), { error: true });
      else toast(t('{names} à jour', { names }));
      lib.load({ background: true });
      if (this.el.classList.contains('active') && this.mode === 'manage') this.reload(this.focusedKey());
    }, 2000);
  },
  leave() {
    this.updateAsked = false;
    document.body.classList.remove('emu-world');
    document.body.style.removeProperty('--emu');
    clearInterval(this.poll); this.poll = null;
  },

  roms() { return lib.visible().filter(g => g.source === 'rom'); },
  gameById(id) { return id ? this.roms().find(g => g.id === id) || null : null; },
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
    this.mode = this.manage || !has ? 'manage' : this.view === 'game' && this.gameById(this.gid) ? 'game' : this.view === 'console' ? 'console' : 'hub';
    if (this.view === 'game' && this.mode !== 'game') this.view = this.from || 'hub';
    this.el.classList.toggle('kw-mode', this.mode !== 'manage');
    if (this.mode === 'manage') this.drawManage(focusKey);
    else if (this.mode === 'game') this.drawGame(focusKey);
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

  // ---------------------------------------------------------------- tuiles et rangées
  gameTile(g, prefix, sub) {
    const tile = el('div', 'kw-tile game' + (favs.has(g.id) ? ' fav' : ''));
    tile.dataset.gid = g.id;
    tile.style.setProperty('--c', LOOK[g.system] || '#7c9eff');
    tile.append(cover(g));
    tile.insertAdjacentHTML('beforeend', `<div class="kw-name">${esc(g.name)}</div>${sub ? `<div class="kw-sub">${esc(sub)}</div>` : ''}`);
    return nav(tile, () => this.openGame(g), prefix + g.id);
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
  toolTile(ic, title, sub, fn, key) {
    const tile = el('div', 'kw-tile tool', `<i>${icon(ic)}</i><b>${esc(title)}</b><small>${esc(sub)}</small>`);
    return nav(tile, fn, key);
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
    const body = el('div', 'kw-body');
    // Ordre voulu : les consoles d'abord, puis la bibliothèque, « Reprendre » en dernier
    const cards = [...(systems.length > 1 ? [this.sysInfo('all')] : []), ...systems].map(s => this.sysTile(s));
    body.append(this.row('sys', t('Consoles'), cards));
    const LIB_MAX = 60;
    const all = [...roms].sort((a, b) => a.name.localeCompare(b.name, locale));
    const libTiles = all.slice(0, LIB_MAX).map(g => this.gameTile(g, 'l:', brandOf(g.system)));
    if (all.length > LIB_MAX) libTiles.push(this.toolTile('i-grid', t('Tout voir'), tn(all.length, '{n} jeu', '{n} jeux'), () => this.openConsole('all'), 'tool:all'));
    body.append(this.row('lib', t('Bibliothèque'), libTiles));
    const fav = roms.filter(g => favs.has(g.id)).sort((a, b) => a.name.localeCompare(b.name, locale));
    if (fav.length) body.append(this.row('fav', t('Favoris'), fav.map(g => this.gameTile(g, 'f:', brandOf(g.system)))));
    const fresh = roms.filter(g => g.added).sort((a, b) => b.added - a.added).slice(0, 12);
    if (roms.length > 4 && fresh.length) body.append(this.row('new', t('Ajoutés récemment'), fresh.map(g => this.gameTile(g, 'n:', brandOf(g.system)))));
    const recent = roms.filter(g => g.lastPlayed).sort(lastPlayedFirst).slice(0, 12);
    if (recent.length) body.append(this.row('recent', t('Reprendre'), recent.map(g => this.gameTile(g, 'r:', playedText(g)))));
    // Ce qui était dans l'en-tête : en dernière rangée, hors du chemin
    body.append(this.row('tools', t('Options'), [
      this.toolTile('i-folder', t('Ajouter des jeux'), t('Ouvrir le dossier des jeux'), () => this.open({ what: 'games' }), 'tool:add'),
      this.toolTile('i-gear', t('Gérer'), t('Émulateurs, BIOS, dossiers'), () => this.openManage(), 'tool:manage'),
    ]));
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
    const root = el('div', 'kw console');
    root.style.setProperty('--sys', VIRTUAL[s.id] ? 'var(--accent)' : LOOK[s.id] || 'var(--accent)');
    // Une seule ligne en haut : console (LB / RB pour changer), filtres, réglages
    const bar = el('div', 'kw-bar');
    const many = this.consoleOrder().length > 1;
    const title = el('div', 'kw-ctitle', `${many ? shoulder('lb').outerHTML : ''}<b>${esc(VIRTUAL[s.id] ? VIRTUAL[s.id]() : s.name)}</b><small>${tn(all.length, '{n} jeu', '{n} jeux')}</small>${many ? shoulder('rb').outerHTML : ''}`);
    title.querySelectorAll('.shoulder').forEach(x => x.addEventListener('click', () => this.button(x.dataset.glyph)));
    bar.append(title);
    const chips = el('div', 'kw-filters');
    for (const [k, l] of [['all', t('Tous')], ['fav', t('Favoris')], ['recent', t('Récents')]]) {
      chips.append(nav(el('div', 'kw-filter' + (this.filter === k ? ' on' : ''), esc(l)), () => { this.filter = k; this.draw('filter:' + k); }, 'filter:' + k));
    }
    if (!VIRTUAL[s.id]) chips.append(nav(el('div', 'kw-filter icon', `${icon('i-gear')}<span>${t('Réglages')}</span>`), () => this.openSettings('system', s.id), 'sys-settings'));
    // Switch, Switch 2 : chaque émulateur de la console s'ouvre seul (Lichii, Lichii modifié, Eden),
    // par le premier jeu qui l'utilise (mêmes réglages et manette, suivi par KaneMode)
    if (hasMods({ system: s.id })) {
      const byEmu = new Map();
      for (const g of all) if (g.emulatorId && g.emulator && !byEmu.has(g.emulatorId)) byEmu.set(g.emulatorId, g);
      for (const [emuId, g] of byEmu) chips.append(nav(el('div', 'kw-filter icon', `${icon('i-open')}<span>${esc(t('Ouvrir {e}', { e: g.emulator }))}</span>`), () => launch(g, { emuOnly: true }), 'emu-open:' + emuId));
    }
    bar.append(chips);
    root.append(bar);
    const body = el('div', 'kw-body');
    const grid = el('div', 'kw-grid');
    if (!list.length) grid.append(el('div', 'kw-empty', this.filter === 'fav' ? t('Pas encore de favori ici : X sur un jeu l’ajoute.') : t('Aucun jeu lancé pour l’instant.')));
    list.forEach(g => grid.append(this.gameTile(g, 'g:', VIRTUAL[s.id] ? brandOf(g.system) : null)));
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

  // ---------------------------------------------------------------- tuile choisie : le fond suit
  onFocus(target) {
    if (this.mode === 'game') { renderHints(); return; }
    if (this.mode === 'manage' || !target || !this.el.contains(target)) return;
    const key = target.dataset.key;
    if (target.dataset.gid || target.dataset.sys || target.classList.contains('tool')) {
      this.lastKey = key;
      if (target.dataset.gid) {
        this.sel = this.gameById(target.dataset.gid);
        if (this.mode === 'console' && this.sel) { this.pos[this.sys] = this.sel.id; store.set('emupos', this.pos); }
        this.selSys = null;
        if (heroOf(this.sel)) setBackground(heroOf(this.sel));
      } else if (target.dataset.sys) {
        this.selSys = target.dataset.sys; this.sel = null;
        const games = this.gamesOf(this.selSys);
        const pic = heroOf(games.filter(g => g.lastPlayed).sort(lastPlayedFirst)[0]) || games.map(heroOf).find(Boolean);
        if (pic) setBackground(pic);
      } else { this.sel = null; this.selSys = null; }
      renderHints();
    }
  },
  current() { return this.mode === 'game' ? this.gameById(this.gid) : this.sel || null; },
  play(opts) { const g = this.current(); if (g) launch(g, opts); },
  // ---------------------------------------------------------------- mods (Switch, Switch 2)
  async addMod(g, kind) {
    const p = await pickFile(kind === 'dir' ? 'dir' : 'zip', kind === 'dir' ? t('Choisir le dossier du mod') : t('Choisir l’archive du mod'));
    if (!p) return;
    busy(t('Ajout du mod…'));
    try {
      const r = await api.post('/api/emu/mods/add', { id: g.id, path: p });
      toast(tn(r.added.length, 'Mod ajouté : {list}', 'Mods ajoutés : {list}', { list: r.added.join(', ') }));
    } catch (e) { toast(e.message, { error: true }); }
    finally { busy(null); }
    if (this.tab === 'mods') this.drawTab('mod-' + kind);
  },
  async openMods(g) {
    try { await api.post('/api/emu/mods/open', { id: g.id }); toast(t('Dossier des mods ouvert sur le bureau')); }
    catch (e) { toast(e.message, { error: true }); }
  },
  async modMenu(g, mod) {
    const v = await dialog({
      title: mod.name, text: t('Appliqué tout seul au lancement du jeu.'),
      buttons: [{ label: t('Retirer ce mod'), value: 'remove', icon: 'i-trash' }, { label: t('Ouvrir le dossier des mods'), value: 'open', icon: 'i-open' }, { label: t('Fermer'), value: null }],
    });
    if (v === 'open') return this.openMods(g);
    if (v !== 'remove') return;
    if (!(await confirmDialog(t('Retirer ce mod ?'), t('Le dossier « {n} » est supprimé du dossier des mods. Votre archive d’origine n’est pas touchée.', { n: esc(mod.name) }), t('Retirer'), true))) return;
    try { await api.post('/api/emu/mods/remove', { id: g.id, name: mod.name }); toast(t('Mod retiré')); }
    catch (e) { toast(e.message, { error: true }); }
    if (this.tab === 'mods') this.drawTab('mod-zip');
  },
  toggleFav() {
    const g = this.current();
    if (!g) return;
    toggleFav(g);
    this.el.querySelectorAll(`.kw-tile[data-gid="${CSS.escape(g.id)}"]`).forEach(x => x.classList.toggle('fav', favs.has(g.id)));
    if (this.mode === 'game') { this.drawGameHead(); if (this.tab === 'play') this.drawTab('g-fav'); }
  },
  async loadMeta(g) {
    if (this.metaLoading === g.id) return;
    this.metaLoading = g.id;
    try {
      const r = await api.get('/api/emu/game?id=' + encodeURIComponent(g.id));
      metaCache.set(g.id, r.meta || {});
    } catch { metaCache.set(g.id, {}); }
    this.metaLoading = null;
    if (this.mode === 'game' && this.gid === g.id && this.el.classList.contains('active')) {
      this.drawGameHead();
      if (this.tab === 'play' || this.tab === 'info') this.drawTab(this.focusedKey());
    }
  },

  // ---------------------------------------------------------------- page d'un jeu
  /** A sur une jaquette : la page du jeu, « Jouer » déjà choisi (A de nouveau pour lancer). */
  openGame(g) {
    if (this.mode !== 'game') this.from = this.mode;
    this.gid = g.id;
    this.view = 'game';
    this.tab = 'play';
    this.gameDirty = false;
    this.draw('g-play');
  },
  closeGame() {
    sfx('back');
    this.view = this.from || 'hub';
    if (this.gameDirty) { this.gameDirty = false; lib.load({ background: true }); }
    this.draw(this.lastKey);
  },
  drawGame(focusKey) {
    const g = this.gameById(this.gid);
    if (!metaCache.has(g.id)) this.loadMeta(g);
    const root = el('div', 'kw game');
    root.style.setProperty('--c', LOOK[g.system] || 'var(--accent)');
    const hero = heroOf(g);
    const bg = el('div', 'kg-bg');
    if (hero) bg.style.backgroundImage = `url("${hero}")`;
    else bg.style.setProperty('--img', hasArt(g) ? `url("${g.art.portrait}")` : 'none');
    bg.classList.toggle('from-cover', !hero);
    root.append(bg, el('div', 'kg-shade'));
    const wrap = el('div', 'kg');
    const side = el('div', 'kg-side');
    side.append(cover(g, { lazy: false }));
    const main = el('div', 'kg-main');
    main.append(el('div', 'kg-head'));
    const tabs = el('div', 'kg-tabs');
    tabs.append(shoulder('lb'));
    if (!TABS(g).some(x => x[0] === this.tab)) this.tab = 'play';
    for (const [k, l, ic] of TABS(g)) tabs.append(nav(el('div', 'kg-tab' + (this.tab === k ? ' on' : ''), `${icon(ic)}<span>${esc(l)}</span>`), () => this.setTab(k), 'tab:' + k));
    tabs.append(shoulder('rb'));
    tabs.querySelectorAll('.shoulder').forEach(x => x.addEventListener('click', () => this.button(x.dataset.glyph)));
    main.append(tabs, el('div', 'kg-panel'));
    wrap.append(side, main);
    root.append(wrap);
    this.el.replaceChildren(root);
    this.tint(this.data.systems.find(s => s.id === g.system) || null);
    if (hero) setBackground(hero);
    this.drawGameHead();
    this.drawTab(focusKey);
  },
  /** Logo (ou nom), console, année, genre, dernière partie. */
  drawGameHead() {
    const g = this.gameById(this.gid);
    const head = this.el.querySelector('.kg-head');
    if (!g || !head) return;
    const m = metaCache.get(g.id);
    const bits = [brandOf(g.system)];
    if (m?.year) bits.push(m.year);
    if (m?.genre) bits.push(m.genre);
    if (m?.players > 1) bits.push(tn(m.players, '{n} joueur', '{n} joueurs'));
    if (g.discs) bits.push(tn(g.discs, '{n} disque', '{n} disques'));
    const played = g.lastPlayed ? t('Dernière partie : {d}', { d: fmt.played(g.lastPlayed) }) + (g.playtime ? ' · ' + fmt.playtime(g.playtime) : '') : t('Jamais joué');
    const logo = g.art && g.art.logo;
    head.innerHTML = `<div class="kg-logo">${logo ? `<img src="${logo}" alt="${esc(g.name)}">` : ''}<h1${logo ? ' hidden' : ''}>${esc(g.name)}</h1></div>
      <p class="kg-meta">${favs.has(g.id) ? '<i class="kw-star">★</i>' : ''}${bits.map(b => esc(String(b))).join('<i>·</i>')}</p><p class="kg-played">${esc(played)}</p>`;
    const img = head.querySelector('.kg-logo img');
    // Logo illisible ou absent : le nom en texte
    if (img) img.onerror = () => { img.remove(); head.querySelector('.kg-logo h1').hidden = false; };
  },
  setTab(k, focusKey) {
    if (this.tab === k && !focusKey) { this.focusPanel(); return; }
    this.tab = k;
    sfx('move');
    this.el.querySelectorAll('.kg-tab').forEach(x => x.classList.toggle('on', x.dataset.key === 'tab:' + k));
    this.drawTab(focusKey);
  },
  focusPanel(key) {
    const panel = this.el.querySelector('.kg-panel');
    if (panel) { panel.scrollTop = 0; focusIn(panel, key, { scroll: 'instant' }); }
    renderHints();
  },
  /** Contenu de l'onglet choisi. */
  async drawTab(focusKey) {
    const g = this.gameById(this.gid);
    const panel = this.el.querySelector('.kg-panel');
    if (!g || !panel) return;
    panel.dataset.tab = this.tab;
    const m = metaCache.get(g.id);
    const big = (cls, ic, text, sub, fn, key) => nav(el('div', 'kg-act ' + cls, `${icon(ic)}<div><b>${text}</b>${sub ? `<small>${sub}</small>` : ''}</div>`), fn, key);
    if (this.tab === 'play') {
      const acts = el('div', 'kg-acts');
      acts.append(big('primary', 'i-play', t('Jouer'), g.lastPlayed && g.emulatorId === 'retroarch' ? t('Reprend là où vous vous étiez arrêté') : '', () => this.play(), 'g-play'));
      // Reprise automatique de RetroArch : on peut aussi repartir de zéro
      if (g.emulatorId === 'retroarch' && g.lastPlayed) acts.append(big('', 'i-restart', t('Recommencer du début'), t('Sans reprendre la dernière partie'), () => this.play({ fresh: true }), 'g-fresh'));
      // Switch, Switch 2 : l'émulateur seul, pour le régler ou lancer le jeu à la main (File → Load folder)
      if (hasMods(g) && g.emulator) acts.append(big('', 'i-open', t('Ouvrir {e} seul', { e: esc(g.emulator) }), t('Sans lancer le jeu : réglages, ou lancement à la main'), () => this.play({ emuOnly: true }), 'g-emu'));
      acts.append(big(favs.has(g.id) ? 'on' : '', 'i-star', favs.has(g.id) ? t('Retirer des favoris') : t('Ajouter aux favoris'), '', () => this.toggleFav(), 'g-fav'));
      panel.replaceChildren(acts);
      const desc = el('div', 'kg-desc' + (m ? '' : ' loading'), m ? (m.description ? `<p>${esc(m.description)}</p>${m.descriptionUrl ? `<small>${t('Source : Wikipédia')}</small>` : ''}` : `<p class="muted">${t('Pas de description trouvée pour ce jeu.')}</p>`) : '<i class="spinner"></i>');
      // La description se lit en descendant : elle prend le focus pour faire défiler
      panel.append(nav(desc, () => {}, 'g-desc'));
    } else if (this.tab === 'settings') {
      this.gset = { scope: 'game', sysId: g.system, g, box: panel, game: true };
      await this.drawSettings(this.gset, focusKey, true);
      if (this.tab !== 'settings') return;
    } else if (this.tab === 'mods') {
      panel.replaceChildren(el('div', 'loading', '<i class="spinner"></i>'));
      let r;
      try { r = await api.get('/api/emu/mods?id=' + encodeURIComponent(g.id)); }
      catch (e) { r = { error: e.message }; }
      if (this.tab !== 'mods' || this.el.querySelector('.kg-panel') !== panel) return;
      const acts = el('div', 'kg-acts');
      acts.append(
        big('primary', 'i-plus', t('Ajouter un mod (.zip)…'), t('Archive .zip, .7z ou .rar : son dossier exefs, romfs ou cheats est copié'), () => this.addMod(g, 'zip'), 'mod-zip'),
        big('', 'i-folder', t('Ajouter un dossier de mod…'), t('Un dossier qui contient exefs, romfs ou cheats'), () => this.addMod(g, 'dir'), 'mod-dir'),
        big('', 'i-open', t('Ouvrir le dossier des mods'), r.dir ? esc(r.dir) : '', () => this.openMods(g), 'mod-open'),
      );
      const items = [];
      if (r.error) items.push(el('div', 'notice', esc(r.error)));
      else if (!r.mods.length) items.push(el('div', 'kg-desc', `<p class="muted">${t('Aucun mod pour ce jeu. Ils s’appliquent tout seuls au lancement, avec {e}.', { e: esc(r.emulator) })}</p>`));
      else for (const mod of r.mods) {
        items.push(big('', 'i-check', esc(mod.name), esc(mod.parts.join(' · ') || t('dossier vide')), () => this.modMenu(g, mod), 'mod:' + mod.name));
      }
      panel.replaceChildren(acts, el('div', 'row-title', t('Mods installés <small>{t}</small>', { t: r.titleId ? esc(r.titleId) : '' })), ...items);
    } else if (this.tab === 'art') {
      const grid = el('div', 'kg-arts');
      const custom = g.customArt || [];
      for (const [k, l] of ART_KINDS()) {
        const src = g.art && g.art[k];
        const tile = el('div', `kg-art ${k}`, `<div class="kg-art-img">${src ? `<img src="${esc(src)}" alt="" onerror="this.remove()">` : ''}<i>${icon('i-image')}</i></div><b>${esc(l)}</b><small>${custom.includes(k) ? t('Personnalisé') : src ? t('Automatique') : t('Aucun')}</small>`);
        grid.append(nav(tile, () => go('artpicker', { id: g.id, kind: k, direct: true }), 'art:' + k));
      }
      panel.replaceChildren(grid, big('', 'i-search', t('Tous les visuels'), t('SteamGridDB, image du disque, récupérer à nouveau'), () => go('artpicker', { id: g.id }), 'art-all'));
    } else if (this.tab === 'info') {
      const facts = [[t('Console'), this.sysInfo(g.system)?.name || g.systemName], [t('Développeur'), m?.developer], [t('Éditeur'), m?.publisher], [t('Sortie'), m?.year], [t('Genre'), m?.genre],
        [t('Région'), g.region], [t('Émulateur'), g.emulator ? g.emulator + (g.core ? ` · ${g.core}` : '') : t('Installé au premier lancement')], [t('Taille'), g.sizeOnDisk ? fmt.size(g.sizeOnDisk) : ''],
        [t('Temps de jeu'), g.playtime ? fmt.playtime(g.playtime) : '']].filter(([, v]) => v);
      const tiles = el('div', 'kg-facts', facts.map(([k, v]) => `<div><small>${esc(k)}</small><b>${esc(String(v))}</b></div>`).join(''));
      const file = el('div', 'kg-file', `<small>${t('Fichier')}</small><span>${esc(g.romPath || '')}</span>`);
      const acts = el('div', 'kg-acts');
      acts.append(big('', 'i-folder', t('Ouvrir le dossier'), '', () => this.open({ system: g.system }), 'g-folder'),
        big('', 'i-info', t('Fiche KaneMode'), t('Collections, retirer de la bibliothèque'), () => go('game', { id: g.id }), 'g-sheet'));
      tiles.style.marginTop = '12px';
      panel.replaceChildren(acts, tiles, file);
    }
    if (this.el.querySelector('.kg-panel') !== panel) return;
    const want = focusKey && panel.querySelector(`[data-key="${CSS.escape(focusKey)}"]`) ? focusKey : null;
    const tabFocused = this.el.querySelector('.kg-tab.focused');
    // Changement d'onglet depuis la barre d'onglets : le focus y reste
    if (tabFocused && !focusKey) { renderHints(); return; }
    this.focusPanel(want || undefined);
  },

  // ---------------------------------------------------------------- réglages (page du jeu, ou volet d'une console)
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
  /** Réglages d'une console : un volet qui glisse par-dessus (accueil Y, bouton « Réglages »). */
  async openSettings(scope, sysId) {
    if (this.sheet) return;
    const box = this.sheetEl();
    this.sheet = { scope, sysId, g: null, box };
    await this.drawSettings(this.sheet, null, true);
    box.scrollTop = 0;
    box.style.setProperty('--sys', LOOK[sysId] || 'var(--accent)');
    const page = this;
    this.sheetLayer = openLayer({
      el: box, name: 'emu-sheet', scrim: true, focusKey: box.querySelector('[data-setting]')?.dataset.key,
      hints: () => [[['left', 'right'], t('Changer')], ['b', t('Fermer')]],
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
    const f = s.box.querySelector('.focused');
    if ((k === 'left' || k === 'right') && f && f.dataset.setting) { this.changeSetting(s, f.dataset.setting, k === 'right' ? 1 : -1); return true; }
    if (k === 'y') { this.closeSheet(); return true; }
    return false;
  },

  /** Réglages du jeu ou de la console : une ligne par réglage, ◀ ▶ pour changer, enregistré tout de suite. */
  async drawSettings(ctx, focusKey, opening) {
    const g = ctx.g;
    const sysId = ctx.sysId;
    const sys = this.data.systems.find(x => x.id === sysId);
    if (!sys) return;
    const r = await api.get(`/api/emu/settings?system=${encodeURIComponent(sysId)}&id=${encodeURIComponent(g && ctx.scope === 'game' ? g.id : '')}`);
    if (ctx.game ? this.gset !== ctx || this.tab !== 'settings' || !ctx.box.isConnected : this.sheet !== ctx) return;
    const own = (ctx.scope === 'game' ? r.game : r.system) || {};
    const base = ctx.scope === 'game' ? (r.system || {}) : {};
    const emuName = id => (sys.emus.find(e => e.id === id) || {}).name || id;
    const defEmu = (ctx.scope === 'game' && !base.emulator && g.emulatorId) || (sys.emus[0] || {}).id;
    const d = r.defaults || {};
    const inherited = { emulator: base.emulator || defEmu, core: base.core || sys.cores[0], filter: base.filter || d.filter || 'none', aspect: base.aspect || d.aspect || 'auto',
      quality: base.quality || d.quality || 'auto', wide: base.wide || d.wide || 'off', preset: base.preset || d.preset || 'auto' };
    const value = k => (own[k] !== undefined ? own[k] : inherited[k]);
    const emuId = value('emulator');
    const options = {
      emulator: sys.emus.map(e => [e.id, e.name]),
      core: sys.cores.map(c => [c, c]),
      filter: FILTERS(),
      aspect: ASPECTS(),
      quality: QUALITIES(),
      wide: WIDES(),
      preset: PRESETS(),
    };
    ctx.state = { sysId, own, options, inherited };
    const kinds = [];
    if (sys.emus.length > 1) kinds.push(['emulator', t('Émulateur'), 'i-gamepad']);
    if (emuId === 'retroarch' && sys.cores.length > 1) kinds.push(['core', t('Cœur RetroArch'), 'i-cpu']);
    if (emuId === 'retroarch') kinds.push(['filter', t('Filtre d’image'), 'i-palette']);
    if (PRESET_EMUS.includes(emuId)) kinds.push(['preset', t('Préréglage'), 'i-cpu']);
    // Qualité : seulement quand KaneMode règle lui-même l'image (le Preset IA la choisit, Manuel n'y touche pas)
    if ((QUALITY_EMUS.includes(emuId) && (!PRESET_EMUS.includes(emuId) || value('preset') === 'auto')) || (emuId === 'retroarch' && sysId === 'n64')) kinds.push(['quality', t('Qualité de l’image'), 'i-image']);
    if (WIDE_EMUS.includes(emuId)) kinds.push(['wide', t('Écran large (16:9)'), 'i-desktop']);
    if (ASPECT_EMUS.includes(emuId) && value('wide') !== 'on') kinds.push(['aspect', t('Format de l’image'), 'i-desktop']);
    const p = ctx.box;
    const auto = ctx.scope === 'game' ? t('comme la console') : t('par défaut');
    p.innerHTML = ctx.game ? `<p class="kg-note">${t('Pour ce jeu seulement. Ce qui n’est pas changé ici suit les réglages de la console.')}</p><div class="es-sets"></div>`
      : `<div class="es-head"><small>${t('Réglages de la console')}</small><h2>${esc(sys.name)}</h2>
      <p>${t('Pour tous les jeux de cette console, sauf ceux qui ont leurs propres réglages.')}</p></div><div class="es-sets"></div>`;
    const list = p.querySelector('.es-sets');
    if (!kinds.length) list.append(el('div', 'notice', t('{name} se règle tout seul : rien à choisir ici.', { name: esc(emuName(emuId)) })));
    for (const [k, title, ic] of kinds) {
      const v = value(k);
      const shown = k === 'emulator' ? emuName(v) : label(options[k], v) || v;
      const row = el('div', 'es-set', `${icon(ic)}<div class="txt"><b>${title}</b><small>${own[k] !== undefined ? t('choisi ici') : auto}</small></div>
        <div class="es-val"><i class="prev">◀</i><span>${esc(shown)}</span><i class="next">▶</i></div>`);
      row.dataset.setting = k;
      row.querySelector('.prev').addEventListener('click', e => { e.stopPropagation(); this.changeSetting(ctx, k, -1); });
      row.querySelector('.next').addEventListener('click', e => { e.stopPropagation(); this.changeSetting(ctx, k, 1); });
      list.append(nav(row, () => this.changeSetting(ctx, k, 1), 'set:' + k));
      // Ce que fait le préréglage choisi, sous sa ligne
      if (k === 'preset') {
        const why = v === 'ia' && r.ia ? r.ia.summary.map(x => `<span>${esc(x)}</span>`).join('')
          : v === 'ia' ? esc(t('Réglages choisis pour cette machine (PC à carte dédiée ou ROG Ally X) et, pour les jeux connus, pour le jeu.'))
            : v === 'manual' ? esc(t('KaneMode ne touche plus à l’image ni aux performances : ce que vous réglez dans l’émulateur (Ouvrir … seul) reste.'))
              : esc(t('Réglages de KaneMode selon la machine, réappliqués à chaque lancement.'));
        list.append(el('p', 'kg-note es-why', why));
      }
    }
    if (Object.keys(own).length) {
      list.append(nav(el('div', 'es-row', `${icon('i-refresh')}<span>${ctx.scope === 'game' ? t('Revenir aux réglages de la console') : t('Revenir aux réglages par défaut')}</span>`), async () => {
        await this.saveSetting(ctx, { emulator: null, core: null, filter: null, aspect: null, quality: null, wide: null, preset: null });
        await this.drawSettings(ctx);
      }, 'set-reset'));
    }
    if (ctx.game) list.append(nav(el('div', 'es-row', `${icon('i-gear')}<span>${t('Réglages de toute la console')}</span>`), () => this.openSettings('system', sysId), 'set-system'));
    if (!opening) {
      const want = focusKey && p.querySelector(`[data-key="${CSS.escape(focusKey)}"]`) ? focusKey : (p.querySelector('[data-setting]') || p.querySelector('[data-nav]'))?.dataset.key;
      focusIn(p, want, { scroll: false });
      renderHints();
    }
  },
  async saveSetting(ctx, values) {
    await api.post('/api/emu/settings', { scope: ctx.scope, id: ctx.scope === 'game' ? ctx.g.id : ctx.state.sysId, values });
    ctx.dirty = true;
    if (ctx.game) this.gameDirty = true;
  },
  async changeSetting(ctx, k, dir) {
    if (!ctx || !ctx.state || this.saving) return;
    this.saving = true;
    try {
      // « Automatique » montre déjà la valeur héritée : elle n'est pas proposée une seconde fois
      const opts = [null, ...ctx.state.options[k].map(o => o[0]).filter(v => v !== ctx.state.inherited[k])];
      const cur = ctx.state.own[k] === undefined ? null : ctx.state.own[k];
      const i = Math.max(0, opts.indexOf(cur));
      const v = opts[(i + dir + opts.length) % opts.length];
      const values = { [k]: v };
      if (k === 'emulator') values.core = null;
      sfx('move');
      await this.saveSetting(ctx, values);
      await this.drawSettings(ctx, 'set:' + k);
    } catch (e) { toast(e.message, { error: true }); }
    this.saving = false;
  },

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
          : e.local ? t('Non installée · depuis une archive .zip (Lichii-Frizti…)') : t('Non installé · environ {size} Mo', { size: e.size });
      const r = el('div', 'set-row nav', `<span class="${e.installed ? 'dot-ok' : 'dot-ko'}"></span><div class="txt"><b>${esc(e.name)}${e.experimental ? ` <i class="emu-exp">${t('expérimental')}</i>` : ''}</b><small>${desc}</small></div><span></span>`);
      r.style.gridTemplateColumns = 'auto 1fr auto';
      box.append(nav(r, async () => {
        // Version modifiée : installée (ou remplacée) depuis l'archive de l'utilisateur
        if (e.local) {
          const c = await dialog({
            title: e.name,
            text: t('Une version modifiée de Lichii (Lichii-Frizti…) : choisissez son archive .zip. Elle partage les clés, sauvegardes et mods de Lichii, et se choisit jeu par jeu dans Réglages → Émulateur.') + (e.installed ? `<br><code>${esc(e.dir)}</code>` : ''),
            buttons: [{ label: e.installed ? t('Remplacer par une autre archive…') : t('Choisir l’archive…'), value: 'zip', icon: 'i-folder', primary: true }, { label: t('Fermer'), value: null }],
          });
          if (c !== 'zip') return;
          const p = await pickFile('zip', t('Archive de la version modifiée'));
          if (!p) return;
          busy(t('Installation…'));
          try { const m = await api.post('/api/emu/install-local', { id: e.id, path: p }); toast(t('{n} installée', { n: m.name })); }
          catch (err) { toast(err.message, { error: true }); }
          finally { busy(null); }
          return this.checkUpdates();
        }
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
    if (this.mode === 'game') {
      if (k === 'b') { this.closeGame(); return true; }
      if (k === 'lb' || k === 'rb') {
        const ids = TABS(this.gameById(this.gid)).map(x => x[0]);
        const i = ids.indexOf(this.tab);
        this.setTab(ids[(i + (k === 'rb' ? 1 : -1) + ids.length) % ids.length], '-');
        return true;
      }
      if (k === 'x') { this.toggleFav(); return true; }
      if (k === 'y') { this.play(); return true; }
      if ((k === 'left' || k === 'right') && focused && focused.dataset.setting && this.gset) { this.changeSetting(this.gset, focused.dataset.setting, k === 'right' ? 1 : -1); return true; }
      // Des onglets, ↓ entre dans l'onglet ; du haut de l'onglet, ↑ remonte aux onglets
      if (k === 'down' && focused && focused.classList.contains('kg-tab')) { this.focusPanel(); return true; }
      const panel = this.el.querySelector('.kg-panel');
      if (k === 'up' && focused && panel && panel.contains(focused)) {
        const top = focused.getBoundingClientRect().top;
        const above = [...panel.querySelectorAll('[data-nav]')].some(x => x !== focused && x.getBoundingClientRect().bottom <= top + 2);
        if (!above) { setFocus(this.el.querySelector('.kg-tab.on')); return true; }
      }
      return false;
    }
    const onGame = focused && focused.dataset.gid && this.sel;
    if (k === 'x') { if (onGame) this.toggleFav(); return true; }
    if (k === 'y') {
      // Y : jouer tout de suite, sans passer par la page du jeu
      if (onGame) this.play();
      else if (this.selSys && !VIRTUAL[this.selSys]) this.openSettings('system', this.selSys);
      return true;
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
    if (this.mode === 'game') {
      const f = this.el.querySelector('.focused');
      const list = [[['lb', 'rb'], t('<span class="label-long">Onglet</span>')]];
      if (f && f.dataset.setting) list.push([['left', 'right'], t('Changer')]);
      list.push(['x', t('Favori')], ['y', t('Jouer')], ['a', t('Choisir')], ['b', t('Retour')]);
      return list;
    }
    const game = !!this.sel;
    const list = [];
    if (this.mode === 'console') list.push([['lb', 'rb'], t('<span class="label-long">Console</span>')], [['lt', 'rt'], t('<span class="label-long">Lettre</span>')]);
    if (game) list.push(['x', t('Favori')], ['y', t('Jouer')], ['a', t('Ouvrir')]);
    else if (this.selSys && !VIRTUAL[this.selSys]) list.push(['y', t('<span class="label-long">Réglages</span>')], ['a', t('Ouvrir')]);
    else list.push(['a', t('Ouvrir')]);
    list.push(['b', this.mode === 'console' ? t('Consoles') : t('Retour')]);
    return list;
  },
});
