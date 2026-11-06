// Monde Émulation : une étagère de boîtes par console (la boîte choisie sort face à soi, les
// autres montrent leur tranche), la fiche du jeu à droite, et un écran « Gérer » pour le dossier
// de jeux, les BIOS et les émulateurs installés et tenus à jour par KaneMode.
import { t, tn, locale } from '../i18n.js';
import { el, esc, icon, api, lib, toast, busy, sfx, store, favs, fmt } from '../core.js';
import { definePage, nav, focusIn, setFocus, glyph, renderHints, go } from '../nav.js';
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

definePage('emulation', {
  libBound: true,
  title: () => t('Émulation'),
  initialFocus() { return this.mode === 'shelf' ? 'shelf' : 'open-games'; },
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
    clearTimeout(this.panelTimer);
  },

  roms() { return lib.visible().filter(g => g.source === 'rom'); },
  /** Consoles qui ont des jeux, dans l'ordre de la liste des consoles ; « Tout » en premier. */
  systems() {
    const counts = {};
    for (const g of this.roms()) counts[g.system] = (counts[g.system] || 0) + 1;
    const list = this.data.systems.filter(s => counts[s.id]).map(s => ({ ...s, count: counts[s.id] }));
    return list.length > 1 ? [{ id: 'all', name: t('Tout'), maker: '', count: this.roms().length }, ...list] : list;
  },
  gamesOf(sys) {
    const list = this.roms().filter(g => sys === 'all' || g.system === sys);
    if (sys === 'all') return list.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || a.name.localeCompare(b.name, locale));
    return list.sort((a, b) => a.name.localeCompare(b.name, locale));
  },

  draw(focusKey) {
    const shelf = !this.manage && this.roms().length;
    this.mode = shelf ? 'shelf' : 'manage';
    this.el.classList.toggle('sx-mode', !!shelf);
    if (shelf) this.drawShelf(focusKey); else this.drawManage(focusKey);
    renderHints();
  },

  // ---------------------------------------------------------------- étagère
  drawShelf(focusKey) {
    const systems = this.systems();
    if (!this.sys) this.sys = store.get('emusys', systems[0].id);
    if (!systems.some(s => s.id === this.sys)) this.sys = systems[0].id;
    const sys = systems.find(s => s.id === this.sys);
    this.list = this.gamesOf(this.sys);
    this.pos = this.pos || store.get('emupos', {});
    const wanted = this.pos[this.sys];
    this.idx = Math.max(0, this.list.findIndex(g => g.id === wanted));
    this.tint(sys);

    const root = el('div', 'sx');
    root.style.setProperty('--sys', sys.id === 'all' ? 'var(--accent)' : lookOf(sys).color);
    const kind = sys.id === 'all' ? t('Toutes les consoles') : HANDHELD.includes(sys.id) ? t('Console portable') : ['arcade', 'neogeo'].includes(sys.id) ? t('Arcade') : t('Console de salon');
    const brand = brandOf(sys.id === 'all' ? null : sys.id);
    const top = el('div', 'sx-top', `<div class="sx-brand${brand.length > 8 ? ' long' : ''}"><b>${esc(brand)}</b><small>${kind}</small><small>${tn(sys.count, '{n} jeu', '{n} jeux')}</small></div>`);
    const pills = el('div', 'sx-systems');
    pills.append(shoulder('lb'));
    const strip = el('div', 'sx-pills');
    for (const s of systems) {
      const p = el('div', 'sx-pill' + (s.id === sys.id ? ' active' : ''), esc(s.id === 'all' ? s.name : brandOf(s.id)));
      p.style.setProperty('--c', s.id === 'all' ? 'var(--accent)' : lookOf(s).color);
      strip.append(nav(p, () => this.setSys(s.id, 'sys:' + s.id), 'sys:' + s.id));
    }
    pills.append(strip, shoulder('rb'));
    const tools = el('div', 'sx-tools');
    if (sys.id !== 'all') tools.append(nav(el('div', 'chip-btn', `${icon('i-palette')}${t('Console')}`), () => this.settings('system'), 'sys-settings'));
    tools.append(nav(el('div', 'chip-btn', `${icon('i-gear')}${t('Gérer')}`), () => { this.manage = true; this.draw(); }, 'manage'));
    top.append(pills, tools);

    const stage = el('div', 'sx-stage', '<div class="sx-glow"></div><div class="sx-track"></div><div class="sx-floor"></div><div class="sx-letter"></div>');
    stage.setAttribute('aria-label', t('Étagère'));
    nav(stage, () => this.play(), 'shelf');
    this.stage = stage;
    this.track = stage.querySelector('.sx-track');
    this.nodes = new Map();
    this.bindStage(stage);

    const panel = el('aside', 'sx-panel');
    this.panel = panel;
    root.append(top, stage, panel);
    this.el.replaceChildren(root);
    // Pas de requestAnimationFrame : il ne tourne pas tant que la page est masquée
    this.layout(true);
    this.drawPanel();
    if (!this.resizeBound) { this.resizeBound = true; addEventListener('resize', () => { if (this.mode === 'shelf' && this.el.classList.contains('active')) this.layout(true); }); }
    focusIn(this.el, focusKey || 'shelf');
  },

  /** Place les boîtes : la choisie de face, deux de chaque côté inclinées, les autres sur la tranche. */
  layout(instant) {
    const st = this.stage;
    if (!st || !st.isConnected) return;
    const W = st.clientWidth, H = st.clientHeight;
    const boxH = Math.max(140, Math.min(H * 0.66, W * 0.42));
    const floor = H * 0.8;
    const cx = W / 2;
    const keep = new Set();
    // Taille d'une boîte : même hauteur pour toutes, sauf les boîtes en largeur (Super Nintendo,
    // N64) qui ne dépassent pas un tiers de l'étagère
    const size = g => {
      const n = this.node(g);
      const ar = n.ar || RATIO[g.system] || 0.72;
      const h = Math.min(boxH, (W * 0.34) / ar);
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
      const z = mode === 'center' ? 60 : mode === 'angled' ? -30 : -60;
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
        if (this.mode === 'shelf') this.layout();
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
    let wheelAt = 0;
    stage.addEventListener('wheel', e => {
      e.preventDefault();
      if (Date.now() - wheelAt < 110) return;
      wheelAt = Date.now();
      this.go(this.idx + ((e.deltaY || e.deltaX) > 0 ? 1 : -1));
    }, { passive: false });
    let sx = null;
    stage.addEventListener('pointerdown', e => { if (e.pointerType !== 'mouse') sx = e.clientX; });
    stage.addEventListener('pointermove', e => {
      if (sx == null) return;
      const dx = e.clientX - sx;
      if (Math.abs(dx) > 60) { this.go(this.idx + (dx < 0 ? 1 : -1)); sx = e.clientX; }
    });
    stage.addEventListener('pointerup', () => { sx = null; });
    stage.addEventListener('pointercancel', () => { sx = null; });
  },

  go(i) {
    i = Math.max(0, Math.min(this.list.length - 1, i));
    if (i === this.idx) return;
    this.idx = i;
    this.pos[this.sys] = this.list[i].id;
    store.set('emupos', this.pos);
    sfx('move');
    this.layout();
    clearTimeout(this.panelTimer);
    this.panelTimer = setTimeout(() => this.drawPanel(), 90);
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
    this.draw(focusKey);
  },
  current() { return this.list && this.list[this.idx]; },
  play() { const g = this.current(); if (g) launch(g); },

  // ---------------------------------------------------------------- fiche du jeu
  drawPanel() {
    const g = this.current();
    const p = this.panel;
    if (!g || !p) return;
    const focusedKey = p.querySelector('.focused')?.dataset.key;
    const sysName = brandOf(g.system);
    const m = metaCache.get(g.id);
    const hero = g.art && (g.art.hero || g.art.header);
    if (hero) setBackground(hero);
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
          <small>${esc(sysName)} · ${t('{a} sur {b}', { a: this.idx + 1, b: this.list.length })}</small>
          <h2>${esc(g.name)}</h2>
          <div class="sxp-chips">${chips.map(c => `<span>${c}</span>`).join('')}${favs.has(g.id) ? '<span class="fav">★</span>' : ''}</div>
          <p>${esc(played)}</p>
        </div>
      </div>
      <div class="sxp-shots">${['hero', 'header'].map(k => g.art && g.art[k] ? `<img src="${g.art[k]}" alt="" onerror="this.remove()">` : '').join('')}</div>
      <div class="sxp-desc ${m ? '' : 'loading'}">${m ? (m.description ? `<p>${esc(m.description)}</p>` : `<p class="muted">${t('Pas de description trouvée pour ce jeu.')}</p>`) : '<i class="spinner"></i>'}</div>
      <div class="sxp-tiles">
        <div><small>${t('Développeur')}</small><b>${esc(m?.developer || '—')}</b></div>
        <div><small>${t('Éditeur')}</small><b>${esc(m?.publisher || '—')}</b></div>
        <div><small>${t('Région')}</small><b>${esc(g.region || '—')}</b></div>
        <div><small>${t('Émulateur')}</small><b>${esc(g.emulator ? g.emulator + (g.core ? ` · ${g.core}` : '') : '—')}</b></div>
      </div>
      <div class="sxp-actions"></div>`;
    const desc = p.querySelector('.sxp-desc');
    if (m?.description && m.description.length > 260) {
      const more = nav(el('div', 'sxp-more', t('Lire la suite')), () => { desc.classList.toggle('open'); more.textContent = desc.classList.contains('open') ? t('Réduire') : t('Lire la suite'); }, 'more');
      desc.append(more);
    }
    if (m?.descriptionUrl) desc.append(el('small', 'sxp-src', t('Source : Wikipédia')));
    const acts = p.querySelector('.sxp-actions');
    acts.append(nav(el('div', 'sxp-play', `${icon('i-play')}${t('Jouer')}`), () => this.play(), 'play'));
    const grid = el('div', 'sxp-grid');
    const btn = (ic, label, fn, key, on) => grid.append(nav(el('div', 'sxp-btn' + (on ? ' on' : ''), `${icon(ic)}${label}`), fn, key));
    btn('i-star', favs.has(g.id) ? t('Favori') : t('Ajouter aux favoris'), () => { toggleFav(g); this.drawPanel(); }, 'fav', favs.has(g.id));
    btn('i-image', t('Visuels'), () => go('artpicker', { id: g.id }), 'art');
    btn('i-info', t('Fiche complète'), () => go('game', { id: g.id }), 'sheet');
    btn('i-gear', t('Réglages du jeu'), () => this.settings('game'), 'settings');
    btn('i-folder', t('Dossier'), () => this.open({ system: g.system }), 'folder');
    acts.append(grid);
    if (focusedKey) { const f = p.querySelector(`[data-key="${focusedKey}"]`); if (f) setFocus(f, { scroll: false, sound: false }); }
    if (!m) this.loadMeta(g);
  },
  async loadMeta(g) {
    try {
      const r = await api.get('/api/emu/game?id=' + encodeURIComponent(g.id));
      metaCache.set(g.id, r.meta || {});
    } catch { metaCache.set(g.id, {}); }
    if (this.current() === g && this.mode === 'shelf') this.drawPanel();
  },

  /** Réglages du jeu choisi ou de toute la console : émulateur, cœur, filtre, format. */
  async settings(scope) {
    const g = this.current();
    const sysId = scope === 'system' ? this.sys : g && g.system;
    const sys = this.data.systems.find(s => s.id === sysId);
    if (!sys) return;
    for (;;) {
      const r = await api.get(`/api/emu/settings?system=${encodeURIComponent(sysId)}&id=${encodeURIComponent(g ? g.id : '')}`);
      const own = scope === 'game' ? r.game : r.system;
      const base = scope === 'game' ? r.system : {};
      const eff = { ...base, ...own };
      const emuId = eff.emulator || (scope === 'game' && g.emulatorId) || (sys.emus[0] || {}).id;
      const emuName = id => (sys.emus.find(e => e.id === id) || {}).name || id;
      const auto = scope === 'game' ? t('comme la console') : t('automatique');
      const tag = k => (own[k] !== undefined ? '' : ` (${auto})`);
      const buttons = [];
      if (sys.emus.length > 1) buttons.push({ label: t('Émulateur : {v}', { v: emuName(emuId) }) + tag('emulator'), value: 'emulator', icon: 'i-gamepad' });
      if (emuId === 'retroarch' && sys.cores.length > 1) buttons.push({ label: t('Cœur : {v}', { v: eff.core || sys.cores[0] }) + tag('core'), value: 'core', icon: 'i-cpu' });
      if (emuId === 'retroarch') buttons.push({ label: t('Filtre : {v}', { v: label(FILTERS(), eff.filter || 'none') }) + tag('filter'), value: 'filter', icon: 'i-palette' });
      if (ASPECT_EMUS.includes(emuId)) buttons.push({ label: t('Format : {v}', { v: label(ASPECTS(), eff.aspect || 'auto') }) + tag('aspect'), value: 'aspect', icon: 'i-desktop' });
      if (Object.keys(own).length) buttons.push({ label: scope === 'game' ? t('Revenir aux réglages de la console') : t('Revenir aux réglages par défaut'), value: 'reset', icon: 'i-refresh' });
      buttons.push({ label: t('Fermer'), value: null });
      const what = await dialog({
        title: scope === 'game' ? t('Réglages de {name}', { name: g.name }) : t('Réglages {name}', { name: sys.name }),
        text: scope === 'game' ? t('Pour ce jeu seulement. Ce qui n’est pas choisi ici suit les réglages de la console.') : t('Pour tous les jeux de cette console, sauf ceux qui ont leurs propres réglages.'),
        buttons,
      });
      if (!what) break;
      let values;
      if (what === 'reset') values = { emulator: null, core: null, filter: null, aspect: null };
      else {
        const options = what === 'emulator' ? sys.emus.map(e => [e.id, e.name]) : what === 'core' ? sys.cores.map(c => [c, c]) : what === 'filter' ? FILTERS() : ASPECTS();
        const pick = await dialog({
          title: { emulator: t('Émulateur'), core: t('Cœur RetroArch'), filter: t('Filtre d’image'), aspect: t('Format de l’image') }[what],
          buttons: [{ label: t('Automatique') + (scope === 'game' ? ` (${t('comme la console')})` : ''), value: '__auto' },
            ...options.map(([v, l]) => ({ label: l, value: v, primary: eff[what] === v }))],
        });
        if (!pick) continue;
        values = { [what]: pick === '__auto' ? null : pick };
        if (what === 'emulator') values.core = null;
      }
      await api.post('/api/emu/settings', { scope, id: scope === 'game' ? g.id : sysId, values });
      await lib.load({ background: true });
      const d = await api.get('/api/emu/world');
      this.data = { ...d, emulators: this.withLatest(d.emulators) };
      toast(t('Réglage enregistré'));
    }
    this.draw(scope === 'game' ? 'settings' : 'sys-settings');
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
    if (roms.length) chip('i-library', t('Retour à l’étagère'), () => { this.manage = false; this.draw(); }, 'back-shelf', true);
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
    const onShelf = focused && focused.dataset.key === 'shelf';
    const inPanel = focused && this.panel && this.panel.contains(focused);
    if (k === 'lb' || k === 'rb') {
      const list = this.systems();
      if (list.length < 2) return true;
      const i = list.findIndex(s => s.id === this.sys);
      this.setSys(list[(i + (k === 'rb' ? 1 : -1) + list.length) % list.length].id, onShelf ? 'shelf' : null);
      return true;
    }
    if (k === 'lt' || k === 'rt') { this.jumpLetter(k === 'rt' ? 1 : -1); return true; }
    if (k === 'x') { const g = this.current(); if (g) { toggleFav(g); this.drawPanel(); } return true; }
    if (onShelf) {
      if (k === 'left' || k === 'right') { this.go(this.idx + (k === 'right' ? 1 : -1)); return true; }
      if (k === 'down') { focusIn(this.panel, 'play'); return true; }
    }
    if (inPanel && k === 'b') { focusIn(this.el, 'shelf'); return true; }
    return false;
  },
  hints() {
    if (this.mode === 'manage') return [['a', t('Sélectionner')], ['b', t('Retour')]];
    return [[['lb', 'rb'], t('<span class="label-long">Console</span>')], [['left', 'right'], t('Jeu')], [['lt', 'rt'], t('<span class="label-long">Lettre</span>')], ['x', t('Favori')], ['a', t('Jouer')], ['b', t('Retour')]];
  },
});
