// Monde Émulation : un accueil en carrousel de consoles, puis, dans chaque console, une étagère de
// boîtes (la choisie de face) avec juste le nom du jeu et Jouer ; la fiche et les réglages glissent
// par-dessus. Un écran « Gérer » pour le dossier de jeux, les BIOS et les émulateurs de KaneMode.
import { t, tn, locale } from '../i18n.js';
import { el, esc, icon, api, lib, toast, busy, sfx, store, favs, fmt } from '../core.js';
import { definePage, nav, focusIn, setFocus, glyph, renderHints, go, openLayer, closeLayer, topLayer } from '../nav.js';
import { dialog, confirmDialog } from '../widgets.js';
import { launch, toggleFav, setBackground } from './game.js';
import { THEMES, drawThemed, themedFocus, paintDetail, themedButton, themedHints } from './emu-themes.js';
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
// Format de la boîte (largeur / hauteur) avant que la jaquette ne soit chargée, et épaisseur
const RATIO = { snes: 1.38, n64: 1.38, gb: 0.98, gbc: 0.98, gba: 0.98, nds: 0.9, n3ds: 0.86, psp: 0.58, psvita: 0.62, switch: 0.62, switch2: 0.62, psx: 1.0, segacd: 1.0, saturn: 0.62, dreamcast: 1.0, pcengine: 1.0, atari2600: 0.74 };
const DEPTH = { psx: 0.075, segacd: 0.075, dreamcast: 0.075, pcengine: 0.075, gb: 0.16, gbc: 0.16, gba: 0.16, nes: 0.14, snes: 0.14, n64: 0.14, megadrive: 0.13, mastersystem: 0.13, gamegear: 0.13, atari2600: 0.14 };
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

// Réglages proposés (jeu ou console) ; filtre seulement avec RetroArch, format aussi avec DuckStation et PCSX2
const FILTERS = () => [['none', t('Aucun (pixels d’origine)')], ['crt', t('Écran CRT (télé d’époque)')], ['scanlines', t('Lignes de balayage')], ['lcd', t('Écran LCD (portables)')], ['smooth', t('Lissé')], ['sharp', t('Net, taille entière')]];
const ASPECTS = () => [['auto', t('Automatique (format du jeu)')], ['4:3', '4:3'], ['16:9', '16:9'], ['full', t('Plein écran (étiré)')]];
const ASPECT_EMUS = ['retroarch', 'duckstation', 'pcsx2'];
const label = (list, v) => (list.find(([k]) => k === v) || [])[1];

// Année de sortie (première sortie, Japon compris)
const YEAR = {
  nes: 1983, snes: 1990, n64: 1996, gb: 1989, gbc: 1998, gba: 2001, nds: 2004, n3ds: 2011, gc: 2001, wii: 2006, wiiu: 2012, switch: 2017, switch2: 2025,
  psx: 1994, ps2: 2000, ps3: 2006, ps4: 2013, psvita: 2011, psp: 2004, megadrive: 1988, mastersystem: 1985, gamegear: 1990, segacd: 1991, saturn: 1994,
  dreamcast: 1998, pcengine: 1987, neogeo: 1990, atari2600: 1977, xbox: 2001, xbox360: 2005,
};
const kindOf = id => (id === 'all' ? t('Toutes les consoles') : HANDHELD.includes(id) ? t('Console portable') : ['arcade', 'neogeo'].includes(id) ? t('Arcade') : t('Console de salon'));
const lastPlayedFirst = (a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0);
export { LOOK, YEAR, lookOf, brandOf, kindOf, lastPlayedFirst };

definePage('emulation', {
  libBound: true,
  title: () => t('Émulation'),
  initialFocus() {
    if (this.mode === 'manage') return this.roms().length ? 'back-shelf' : 'open-games';
    if (this.themed()) return this.mode === 'console' ? 'g:' + (this.current() ? this.current().id : '') : 'c:' + (this.sys || '');
    return this.mode === 'console' ? 'shelf' : 'hub';
  },
  get theme() { return this._theme || (this._theme = store.get('emutheme', 'modern')); },
  themed() { return this.theme !== 'modern' && THEMES().some(([id]) => id === this.theme); },
  onFocus(target) { if (this.themed() && this.mode !== 'manage') themedFocus(this, target); },
  savePos() { store.set('emupos', this.pos); },
  /** Métadonnées d'un jeu déjà chargées (sinon chargées en fond, l'encart se redessine ensuite). */
  meta(g) { const m = metaCache.get(g.id); if (!m) this.loadMeta(g); return m; },
  async pickTheme() {
    const cur = this.theme;
    const v = await dialog({
      title: t('Thème du monde Émulation'),
      text: t('Change l’apparence des consoles et des jeux. La manette fonctionne de la même façon partout.'),
      buttons: [...THEMES().map(([id, name]) => ({ label: name + (id === cur ? '  ✓' : ''), value: id, primary: id === cur })), { label: t('Fermer'), value: null }],
    });
    if (!v || v === cur) return;
    this._theme = v;
    store.set('emutheme', v);
    this.draw(this.mode === 'console' ? 'shelf' : 'hub');
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
    delete document.body.dataset.emuTheme;
    document.body.style.removeProperty('--emu');
    clearInterval(this.poll); this.poll = null;
    clearTimeout(this.infoTimer);
  },

  roms() { return lib.visible().filter(g => g.source === 'rom'); },
  /** Consoles qui ont des jeux, dans l'ordre de la liste des consoles ; « Tout » en premier. */
  systems() {
    const counts = {};
    for (const g of this.roms()) counts[g.system] = (counts[g.system] || 0) + 1;
    const list = this.data.systems.filter(s => counts[s.id]).map(s => ({ ...s, count: counts[s.id] }));
    return list.length > 1 ? [{ id: 'all', name: t('Tous les jeux'), maker: '', count: this.roms().length }, ...list] : list;
  },
  gamesOf(sys) {
    const list = this.roms().filter(g => sys === 'all' || g.system === sys);
    if (sys === 'all') return list.sort((a, b) => lastPlayedFirst(a, b) || a.name.localeCompare(b.name, locale));
    return list.sort((a, b) => a.name.localeCompare(b.name, locale));
  },

  draw(focusKey) {
    const has = this.roms().length;
    this.mode = this.manage || !has ? 'manage' : this.view === 'console' ? 'console' : 'hub';
    this.el.classList.toggle('sx-mode', this.mode !== 'manage');
    this.el.classList.remove('th-mode');
    if (this.mode === 'manage' || !this.themed()) delete document.body.dataset.emuTheme;
    if (this.mode !== 'manage' && this.themed()) drawThemed(this, focusKey);
    else if (this.mode === 'hub') this.drawHub(focusKey);
    else if (this.mode === 'console') this.drawConsole(focusKey);
    else this.drawManage(focusKey);
    if (!this.resizeBound) {
      this.resizeBound = true;
      addEventListener('resize', () => {
        if (!this.el.classList.contains('active') || this.themed()) return;
        if (this.mode === 'console') this.layout(true);
        else if (this.mode === 'hub') this.hubLayout();
      });
    }
    renderHints();
  },
  focusPage(key) { if (!topLayer()) focusIn(this.el, key); },

  // ---------------------------------------------------------------- accueil : les consoles
  drawHub(focusKey) {
    const systems = this.systems();
    const cards = [...systems, { id: 'add', name: t('Ajouter des jeux') }];
    this.hubList = cards;
    if (this.hubIdx == null) this.hubIdx = Math.max(0, cards.findIndex(s => s.id === (this.sys || store.get('emusys', ''))));
    this.hubIdx = Math.min(this.hubIdx, cards.length - 1);
    const roms = this.roms();
    const last = roms.filter(g => g.lastPlayed).sort(lastPlayedFirst)[0];
    const root = el('div', 'hx' + (this.hubSeen ? '' : ' intro'));
    this.hubSeen = true;
    const top = el('div', 'hx-top', `<div class="hx-brand"><b>${t('ÉMULATION')}</b>
      <small>${tn(roms.length, '{n} jeu', '{n} jeux')} · ${tn(systems.filter(s => s.id !== 'all').length, '{n} console', '{n} consoles')}</small></div>`);
    const tools = el('div', 'hx-tools');
    if (last) {
      tools.append(nav(el('div', 'hx-resume', `${last.art && last.art.portrait ? `<img src="${last.art.portrait}" alt="" onerror="this.remove()">` : icon('i-play')}
        <span><small>${t('Reprendre')}</small><b>${esc(last.name)}</b></span>`), () => launch(last), 'resume'));
    }
    tools.append(nav(el('div', 'chip-btn', `${icon('i-image')}${t('Thème')}`), () => this.pickTheme(), 'theme'));
    tools.append(nav(el('div', 'chip-btn', `${icon('i-gear')}${t('Gérer')}`), () => this.openManage(), 'manage'));
    top.append(tools);

    const stage = el('div', 'hx-stage', '<div class="hx-floor"><i></i></div><div class="hx-track"></div>');
    stage.setAttribute('aria-label', t('Consoles'));
    nav(stage, () => this.enter(), 'hub');
    const track = stage.querySelector('.hx-track');
    this.hubCards = cards.map((s, i) => {
      const c = this.consoleCard(s);
      c.dataset.i = i;
      track.append(c);
      return c;
    });
    this.bindHub(stage);
    this.hubInfo = el('div', 'hx-info');
    root.append(top, stage, this.hubInfo);
    this.el.replaceChildren(root);
    this.hubLayout();
    this.focusPage(focusKey || 'hub');
  },

  /** Carte d'une console : sa couleur, son nom en grand et les jaquettes de ses derniers jeux. */
  consoleCard(s) {
    if (s.id === 'add') {
      const c = el('div', 'hx-card add', `<div class="hx-add">${icon('i-plus')}<b>${t('Ajouter des jeux')}</b><small>${t('Un dossier par console est déjà prêt : déposez-y vos jeux, même en .zip')}</small></div><div class="hx-dim"></div>`);
      return c;
    }
    const all = s.id === 'all';
    const c = el('div', 'hx-card' + (all ? ' all' : ''));
    c.style.setProperty('--c', all ? 'var(--accent)' : lookOf(s).color);
    c.dataset.motif = all ? 'scan' : lookOf(s).motif;
    // Jaquettes des derniers jeux joués (une boîte dessinée pour un jeu sans jaquette)
    const hasArt = g => !!(g.art && g.art.portrait);
    const games = this.gamesOf(s.id).sort((a, b) => hasArt(b) - hasArt(a) || lastPlayedFirst(a, b)).slice(0, 3);
    const cover = (g, i) => (hasArt(g) ? `<img class="c${i}" src="${g.art.portrait}" alt="">`
      : `<div class="c${i} hx-gen" style="--g:${LOOK[g.system] || '#7c9eff'}"><small>${esc(brandOf(g.system))}</small><b>${esc(g.name)}</b></div>`);
    const brand = all ? t('TOUT') : brandOf(s.id);
    c.innerHTML = `<div class="hx-motif"></div>
      <div class="hx-maker">${esc(all ? t('Toutes les consoles') : s.maker || '')}</div>
      <div class="hx-covers n${games.length}">${games.map(cover).join('')}</div>
      <div class="hx-name${brand.length > 9 ? ' long' : ''}">${esc(brand)}</div>
      <div class="hx-count">${tn(s.count, '{n} jeu', '{n} jeux')}</div>
      <div class="hx-dim"></div>`;
    // Jaquette introuvable : boîte dessinée à la place
    c.querySelectorAll('.hx-covers img').forEach((img, i) => img.addEventListener('error', () => {
      const g = games[i];
      img.replaceWith(el('div', `c${i} hx-gen`, `<small>${esc(brandOf(g.system))}</small><b>${esc(g.name)}</b>`));
      c.querySelector(`.c${i}.hx-gen`).style.setProperty('--g', LOOK[g.system] || '#7c9eff');
    }));
    return c;
  },

  /** Carrousel : la console choisie au centre, les autres de part et d'autre, plus petites. */
  hubLayout() {
    const cards = this.hubCards;
    if (!cards || !cards[0].isConnected) return;
    const cw = cards[0].offsetWidth || 300;
    cards.forEach((c, i) => {
      const d = i - this.hubIdx, a = Math.abs(d);
      const x = d === 0 ? 0 : Math.sign(d) * (cw * 0.74 + (a - 1) * cw * 0.5);
      const s = d === 0 ? 1 : Math.max(0.56, 0.8 - (a - 1) * 0.08);
      c.style.transform = `translate(-50%, -50%) translateX(${x}px) scale(${s})`;
      // Cartes voisines assombries mais opaques : on ne voit pas les suivantes au travers
      c.style.opacity = a > 3 ? '0' : '1';
      c.style.setProperty('--dim', d === 0 ? '0' : String(Math.min(0.82, 0.42 + (a - 1) * 0.16)));
      c.style.zIndex = String(20 - a);
      c.classList.toggle('current', d === 0);
    });
    const s = this.hubList[this.hubIdx];
    this.tint(s.id === 'add' ? null : s);
    const info = this.hubInfo;
    if (s.id === 'add') {
      info.innerHTML = `<b>${t('Ajouter des jeux')}</b><span>${esc(this.data.dirs.games)}</span>`;
    } else {
      const bits = [s.id === 'all' ? '' : s.maker, YEAR[s.id], kindOf(s.id)].filter(Boolean).map(esc);
      info.innerHTML = `<b>${esc(s.name)}</b><span>${bits.join('<i>·</i>')}</span>`;
    }
    const roms = this.gamesOf(s.id === 'add' ? 'none' : s.id);
    const hero = roms.map(g => g.art && (g.art.hero || g.art.header)).find(Boolean);
    if (hero) setBackground(hero);
  },
  bindHub(stage) {
    stage.addEventListener('click', e => {
      const c = e.target.closest('.hx-card');
      if (!c) return;
      e.stopPropagation();
      const i = Number(c.dataset.i);
      if (i === this.hubIdx) this.enter(); else this.hubGo(i);
    });
    this.bindSwipe(stage, dir => this.hubGo(this.hubIdx + dir));
  },
  /** Molette et glissé du doigt sur une scène : une carte ou une boîte à la fois. */
  bindSwipe(stage, step) {
    let wheelAt = 0;
    stage.addEventListener('wheel', e => {
      e.preventDefault();
      if (Date.now() - wheelAt < 110) return;
      wheelAt = Date.now();
      step((e.deltaY || e.deltaX) > 0 ? 1 : -1);
    }, { passive: false });
    let sx = null;
    stage.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') sx = e.clientX; });
    stage.addEventListener('pointermove', e => {
      if (sx == null) return;
      const dx = e.clientX - sx;
      if (Math.abs(dx) > 60) { step(dx < 0 ? 1 : -1); sx = e.clientX; }
    });
    stage.addEventListener('pointerup', () => { sx = null; });
    stage.addEventListener('pointercancel', () => { sx = null; });
  },
  hubGo(i) {
    i = Math.max(0, Math.min(this.hubList.length - 1, i));
    if (i === this.hubIdx) return;
    this.hubIdx = i;
    sfx('move');
    this.hubLayout();
  },
  /** Entrer dans la console choisie (ou ouvrir le dossier des jeux depuis « Ajouter »). */
  enter() {
    const s = this.hubList[this.hubIdx];
    if (!s) return;
    if (s.id === 'add') { this.open({ what: 'games' }); return; }
    this.sys = s.id;
    store.set('emusys', s.id);
    const card = this.hubCards[this.hubIdx];
    this.el.querySelector('.hx')?.classList.add('leaving');
    card.classList.add('entering');
    clearTimeout(this.enterTimer);
    this.enterTimer = setTimeout(() => { this.view = 'console'; this.draw('shelf'); }, 170);
  },
  toHub() {
    this.view = 'hub';
    this.hubIdx = Math.max(0, (this.hubList || this.systems()).findIndex(s => s.id === this.sys));
    sfx('back');
    this.draw('hub');
  },
  openManage() { this.manage = true; this.draw(); },

  // ---------------------------------------------------------------- une console : l'étagère
  drawConsole(focusKey) {
    const systems = this.systems();
    if (!systems.some(s => s.id === this.sys)) { this.view = 'hub'; this.drawHub(); return; }
    const sys = systems.find(s => s.id === this.sys);
    this.list = this.gamesOf(this.sys);
    this.pos = this.pos || store.get('emupos', {});
    this.idx = Math.max(0, this.list.findIndex(g => g.id === this.pos[this.sys]));
    this.tint(sys);

    const root = el('div', 'sx cx');
    root.style.setProperty('--sys', sys.id === 'all' ? 'var(--accent)' : lookOf(sys).color);
    const top = el('div', 'cx-top');
    top.append(nav(el('div', 'chip-btn cx-back', `${icon('i-grid')}${t('Consoles')}`), () => this.toHub(), 'to-hub'));
    const sw = el('div', 'cx-switch');
    const n = systems.length, i = systems.indexOf(sys);
    const near = (s, k) => {
      const b = el('div', 'cx-near ' + k, `${k === 'prev' ? shoulder('lb').outerHTML : ''}<span>${esc(s.id === 'all' ? t('Tout') : brandOf(s.id))}</span>${k === 'next' ? shoulder('rb').outerHTML : ''}`);
      b.addEventListener('click', () => this.setSys(s.id));
      return b;
    };
    if (n > 1) sw.append(near(systems[(i - 1 + n) % n], 'prev'));
    const brand = sys.id === 'all' ? t('TOUS LES JEUX') : brandOf(sys.id);
    sw.append(el('div', 'cx-brand' + (brand.length > 9 ? ' long' : ''), `<b>${esc(brand)}</b><small>${[sys.id === 'all' ? '' : sys.maker, tn(sys.count, '{n} jeu', '{n} jeux')].filter(Boolean).map(esc).join(' · ')}</small>`));
    if (n > 1) sw.append(near(systems[(i + 1) % n], 'next'));
    top.append(sw);
    const tools = el('div', 'cx-tools');
    if (sys.id !== 'all') tools.append(nav(el('div', 'chip-btn', `${icon('i-palette')}${t('Réglages')}`), () => this.openSettings('system', sys.id), 'sys-settings'));
    top.append(tools);

    const stage = el('div', 'sx-stage', '<div class="sx-glow"></div><div class="sx-track"></div><div class="sx-floor"></div><div class="sx-letter"></div>');
    stage.setAttribute('aria-label', t('Étagère'));
    nav(stage, () => this.play(), 'shelf');
    this.stage = stage;
    this.track = stage.querySelector('.sx-track');
    this.nodes = new Map();
    this.bindStage(stage);

    this.info = el('div', 'cx-info');
    root.append(top, stage, this.info);
    this.el.replaceChildren(root);
    // Pas de requestAnimationFrame : il ne tourne pas tant que la page est masquée
    this.drawInfo(); // avant les boîtes : la barre du dessous fixe la hauteur de l’étagère
    this.layout(true);
    this.focusPage(focusKey || 'shelf');
  },

  /** Place les boîtes : la choisie de face, deux de chaque côté inclinées, les autres sur la tranche. */
  layout(instant) {
    const st = this.stage;
    if (!st || !st.isConnected) return;
    const W = st.clientWidth, H = st.clientHeight;
    const boxH = Math.max(140, Math.min(H * 0.7, W * 0.36));
    const floor = H * 0.84;
    const cx = W / 2;
    const keep = new Set();
    // Taille d'une boîte : même hauteur pour toutes, sauf les boîtes en largeur (Super Nintendo,
    // N64) qui ne dépassent pas un tiers de l'étagère
    const size = g => {
      const n = this.node(g);
      const ar = n.ar || RATIO[g.system] || 0.72;
      const h = Math.min(boxH, (W * 0.3) / ar);
      return { n, h, bw: h * ar, depth: Math.max(18, boxH * (DEPTH[g.system] || 0.1)) };
    };
    const place = (i, mode, x, scale, side) => {
      const g = this.list[i];
      const { n, h, bw, depth } = size(g);
      keep.add(g.id);
      n.el.className = `sx-box mode-${mode}` + (side ? ' side-' + side : '') + (n.hasArt ? ' has-art' : '') + (instant ? ' instant' : '');
      n.el.style.width = (mode === 'spine' ? depth : bw) + 'px';
      n.el.style.height = h + 'px';
      n.el.style.setProperty('--depth', depth + 'px');
      const rot = mode === 'angled' ? (side === 'left' ? -56 : 56) : 0;
      const z = mode === 'center' ? 0 : mode === 'angled' ? -90 : -120;
      n.el.style.transform = `translate3d(${x}px, ${floor - h}px, ${z}px) rotateY(${rot}deg) scale(${scale})`;
      n.el.style.zIndex = String(mode === 'center' ? 100 : 50 - Math.abs(i - this.idx));
    };
    if (!this.list.length) return;
    const c = size(this.list[this.idx]);
    place(this.idx, 'center', cx - c.bw / 2, 1);
    for (const dir of [-1, 1]) {
      let edge = cx + dir * (c.bw / 2 + boxH * 0.06);
      for (let d = 1; ; d++) {
        const i = this.idx + dir * d;
        if (i < 0 || i >= this.list.length) break;
        if (dir < 0 ? edge < -80 : edge > W + 80) break;
        const s = size(this.list[i]);
        if (d <= 2) {
          // Inclinée vers le centre, pivot sur le bord le plus proche
          place(i, 'angled', dir < 0 ? edge - s.bw : edge, 0.92, dir < 0 ? 'left' : 'right');
          edge += dir * (s.bw * 0.92 * 0.5 + 6);
        } else {
          const w = s.depth * 0.94;
          place(i, 'spine', dir < 0 ? edge - s.depth : edge, 0.94, dir < 0 ? 'left' : 'right');
          edge += dir * (w + 3);
        }
      }
    }
    for (const [id, n] of this.nodes) if (!keep.has(id)) { n.el.remove(); this.nodes.delete(id); }
    if (instant) setTimeout(() => this.track.querySelectorAll('.instant').forEach(e => e.classList.remove('instant')), 60);
  },

  /** Boîte d'un jeu : jaquette (ou boîte dessinée si elle manque) et tranche. */
  node(g) {
    let n = this.nodes.get(g.id);
    if (n) return n;
    const color = LOOK[g.system] || '#7c9eff';
    const box = el('div', 'sx-box');
    box.dataset.id = g.id;
    box.style.setProperty('--c', color);
    box.innerHTML = `<div class="sx-front"><div class="sx-gen"><small>${esc(brandOf(g.system))}</small><b>${esc(g.name)}</b></div></div>
      <div class="sx-spine"><small>${esc(brandOf(g.system))}</small><b>${esc(g.name)}</b></div>`;
    n = { el: box, ar: null };
    const url = g.art && g.art.portrait;
    if (url) {
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        n.ar = Math.min(1.6, Math.max(0.5, img.naturalWidth / img.naturalHeight));
        box.querySelector('.sx-front').replaceChildren(img);
        box.querySelector('.sx-spine').style.setProperty('--img', `url("${url}")`);
        n.hasArt = true;
        box.classList.add('has-art');
        if (this.mode === 'console') this.layout();
      };
      img.src = url;
    }
    this.track.append(box);
    this.nodes.set(g.id, n);
    return n;
  },

  bindStage(stage) {
    stage.addEventListener('click', e => {
      const b = e.target.closest('.sx-box');
      if (!b) return;
      e.stopPropagation();
      const i = this.list.findIndex(g => g.id === b.dataset.id);
      if (i === this.idx) this.play(); else this.go(i);
    });
    this.bindSwipe(stage, dir => this.go(this.idx + dir));
  },

  go(i) {
    i = Math.max(0, Math.min(this.list.length - 1, i));
    if (i === this.idx) return;
    this.idx = i;
    this.pos[this.sys] = this.list[i].id;
    store.set('emupos', this.pos);
    sfx('move');
    this.layout();
    clearTimeout(this.infoTimer);
    this.infoTimer = setTimeout(() => this.drawInfo(), 90);
  },
  /** Gâchettes : première boîte de la lettre suivante (ou précédente). */
  jumpLetter(dir) {
    if (this.sys === 'all' || !this.list.length) return;
    const cur = firstLetter(this.list[this.idx]);
    let i = this.idx;
    if (dir > 0) { while (i < this.list.length && firstLetter(this.list[i]) === cur) i++; if (i >= this.list.length) return; }
    else {
      while (i > 0 && firstLetter(this.list[i - 1]) === cur) i--;
      if (i === this.idx && i > 0) { const prev = firstLetter(this.list[i - 1]); i--; while (i > 0 && firstLetter(this.list[i - 1]) === prev) i--; }
    }
    this.go(i);
    const l = this.stage.querySelector('.sx-letter');
    l.textContent = firstLetter(this.list[this.idx]);
    l.classList.remove('show'); void l.offsetWidth; l.classList.add('show');
  },
  setSys(id, focusKey) {
    if (id === this.sys) return;
    this.sys = id;
    store.set('emusys', id);
    sfx('move');
    this.view = 'console';
    this.draw(focusKey || 'shelf');
  },
  current() { return this.list && this.list[this.idx]; },
  play() { const g = this.current(); if (g) launch(g); },

  /** Sous l'étagère : le nom du jeu, quelques repères et trois boutons, rien de plus. */
  drawInfo() {
    const g = this.current();
    const box = this.info;
    if (!g || !box || !box.isConnected) return;
    const focusedKey = box.querySelector('.focused')?.dataset.key;
    const m = metaCache.get(g.id);
    const hero = g.art && (g.art.hero || g.art.header);
    if (hero) setBackground(hero);
    const bits = [];
    if (this.sys === 'all') bits.push(esc(brandOf(g.system)));
    if (m?.year) bits.push(esc(m.year));
    if (m?.genre) bits.push(esc(m.genre));
    if (m?.players > 1) bits.push(esc(tn(m.players, '{n} joueur', '{n} joueurs')));
    if (g.discs) bits.push(esc(tn(g.discs, '{n} disque', '{n} disques')));
    bits.push(esc(g.lastPlayed ? fmt.played(g.lastPlayed) : t('Jamais joué')));
    box.innerHTML = `<div class="cx-text"><small>${this.idx + 1} / ${this.list.length}</small>
      <h2>${favs.has(g.id) ? '<i class="cx-fav">★</i>' : ''}${esc(g.name)}</h2><div class="cx-meta">${bits.join('<i>·</i>')}</div></div>`;
    const acts = el('div', 'cx-acts');
    const btn = (cls, glyphKey, ic, label, fn, key) => {
      const b = el('div', 'cx-btn ' + cls, `${icon(ic)}<span>${label}</span>`);
      b.append(shoulder(glyphKey));
      acts.append(nav(b, fn, key));
    };
    btn('play', 'a', 'i-play', t('Jouer'), () => this.play(), 'play');
    btn('', 'y', 'i-info', t('Fiche'), () => this.openSheet(), 'sheet');
    btn(favs.has(g.id) ? 'on' : '', 'x', 'i-star', t('Favori'), () => this.toggleFav(), 'fav');
    box.append(acts);
    renderHints();
    if (focusedKey) { const f = box.querySelector(`[data-key="${focusedKey}"]`); if (f) setFocus(f, { scroll: false, sound: false }); }
    if (!m) this.loadMeta(g);
  },
  toggleFav() {
    const g = this.current();
    if (!g) return;
    toggleFav(g);
    this.drawInfo();
    if (this.themed()) {
      this.el.querySelectorAll(`.th-tile[data-gid="${CSS.escape(g.id)}"]`).forEach(x => x.classList.toggle('fav', favs.has(g.id)));
      paintDetail(this);
    }
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
    if (this.themed() && this.thSel && this.thSel.gid === g.id) paintDetail(this);
    if (this.current() === g && this.mode === 'console') {
      this.drawInfo();
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
    const inherited = { emulator: base.emulator || defEmu, core: base.core || sys.cores[0], filter: base.filter || 'none', aspect: base.aspect || 'auto' };
    const value = k => (own[k] !== undefined ? own[k] : inherited[k]);
    const emuId = value('emulator');
    const options = {
      emulator: sys.emus.map(e => [e.id, e.name]),
      core: sys.cores.map(c => [c, c]),
      filter: FILTERS(),
      aspect: ASPECTS(),
    };
    s.state = { sysId, own, options, inherited };
    const kinds = [];
    if (sys.emus.length > 1) kinds.push(['emulator', t('Émulateur'), 'i-gamepad']);
    if (emuId === 'retroarch' && sys.cores.length > 1) kinds.push(['core', t('Cœur RetroArch'), 'i-cpu']);
    if (emuId === 'retroarch') kinds.push(['filter', t('Filtre d’image'), 'i-palette']);
    if (ASPECT_EMUS.includes(emuId)) kinds.push(['aspect', t('Format de l’image'), 'i-desktop']);
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
    if (roms.length) chip('i-library', t('Retour à l’étagère'), () => { this.manage = false; this.draw(); }, 'back-shelf', true);
    chip('i-folder', t('Dossier des jeux'), () => this.open({ what: 'games' }), 'open-games', !roms.length);
    chip('i-rom', t('BIOS'), () => this.biosDialog(), 'bios');
    if (roms.length) chip('i-image', t('Thème'), () => this.pickTheme(), 'theme');
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
    if (this.themed()) return themedButton(this, k);
    const focused = this.el.querySelector('.focused');
    const key = focused && focused.dataset.key;
    if (this.mode === 'hub') {
      if (key === 'hub' && (k === 'left' || k === 'right')) { this.hubGo(this.hubIdx + (k === 'right' ? 1 : -1)); return true; }
      if (k === 'lb' || k === 'rb') { this.hubGo(this.hubIdx + (k === 'rb' ? 1 : -1)); if (key !== 'hub') focusIn(this.el, 'hub'); return true; }
      if (k === 'y') {
        const s = this.hubList[this.hubIdx];
        if (s && s.id !== 'all' && s.id !== 'add') this.openSettings('system', s.id);
        return true;
      }
      if (k === 'x') { this.openManage(); return true; }
      return false;
    }
    if (k === 'lb' || k === 'rb') {
      const list = this.systems();
      if (list.length < 2) return true;
      const i = list.findIndex(s => s.id === this.sys);
      this.setSys(list[(i + (k === 'rb' ? 1 : -1) + list.length) % list.length].id, 'shelf');
      return true;
    }
    if (k === 'lt' || k === 'rt') { this.jumpLetter(k === 'rt' ? 1 : -1); return true; }
    if (k === 'x') { this.toggleFav(); return true; }
    if (k === 'y') { this.openSheet(); return true; }
    if (k === 'b') { this.toHub(); return true; }
    if (key === 'shelf' && (k === 'left' || k === 'right')) { this.go(this.idx + (k === 'right' ? 1 : -1)); return true; }
    return false;
  },
  hints() {
    if (this.mode === 'manage') return [['a', t('Sélectionner')], ['b', t('Retour')]];
    if (this.themed()) return themedHints(this);
    if (this.mode === 'hub') return [[['left', 'right'], t('Console')], ['y', t('<span class="label-long">Réglages</span>')], ['x', t('Gérer')], ['a', t('Entrer')], ['b', t('Retour')]];
    return [[['lb', 'rb'], t('<span class="label-long">Console</span>')], [['lt', 'rt'], t('<span class="label-long">Lettre</span>')], ['a', t('Jouer')], ['b', t('Consoles')]];
  },
});
