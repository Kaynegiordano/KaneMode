// Visuels d'un jeu : aperçu (jaquette, fond, logo…), récupération automatique, choix sur SteamGridDB
// (sans compte ni clé) ou image du disque.
import { el, esc, icon, api, lib, toast, busy, sfx } from '../core.js';
import { definePage, nav, focusIn, glyph, renderHints } from '../nav.js';
import { dialog, confirmDialog, openKeyboard } from '../widgets.js';
import { pickFile } from './add.js';

const KINDS = [
  { id: 'portrait', label: 'Jaquette', f: true }, { id: 'hero', label: 'Fond' }, { id: 'logo', label: 'Logo' },
  { id: 'header', label: 'Bannière', f: true }, { id: 'icon', label: 'Icône', f: true },
];
const label = k => KINDS.find(x => x.id === k).label;

// Vignettes SteamGridDB : leur serveur est lent (environ une seconde chacune). Elles ne sont
// demandées qu'à l'approche de l'écran, et les premières sont préchargées à l'ouverture.
const thumbs = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const img = e.target;
    thumbs.unobserve(img);
    img.onload = () => img.classList.add('ready');
    img.src = img.dataset.src;
  }
}, { rootMargin: '300px' });
const preloaded = new Set();
const preload = urls => { for (const u of urls) if (!preloaded.has(u)) { preloaded.add(u); new Image().src = u; } };
const applied = k => `${label(k)} appliqué${KINDS.find(x => x.id === k).f ? 'e' : ''}`;
const shoulder = k => { const s = el('span', 'shoulder', glyph(k)); s.dataset.glyph = k; return s; };

definePage('artpicker', {
  title: () => 'Visuels',
  render({ id, kind }) {
    if (this.forId !== id) { this.forId = id; this.game = undefined; this.items = {}; this.kind = 'portrait'; this.mode = 'overview'; }
    if (kind) { this.kind = kind; this.mode = 'browse'; }
    this.g = lib.byId(id);
    this.draw();
  },
  back() {
    if (this.mode !== 'browse') return false;
    sfx('back');
    this.mode = 'overview';
    this.draw('browse:' + this.kind);
    return true;
  },
  async reload() {
    await lib.load();
    this.g = lib.byId(this.forId);
  },

  draw(focusKey) {
    const g = this.g;
    if (!g) { this.el.innerHTML = '<div class="empty">Élément introuvable.</div>'; return; }
    const r = this.mode === 'browse' ? this.drawBrowse(focusKey) : this.drawOverview(focusKey);
    renderHints();
    return r;
  },

  // ------------------------------------------------ aperçu
  drawOverview(focusKey) {
    const g = this.g, custom = g.customArt || [];
    const root = this.el;
    const head = el('div', 'page-head', `<h1>${esc(g.name)}</h1><p>Visuels · SteamGridDB, sans compte ni clé</p>`);
    const shelf = el('div', 'art-shelf');
    for (const k of KINDS) {
      const src = g.art && g.art[k.id];
      const tile = el('div', `art-tile ${k.id}${custom.includes(k.id) ? ' custom' : ''}`,
        `<span class="art-tile-label">${esc(k.label)}${custom.includes(k.id) ? ' · perso' : ''}</span>
         <div class="art-tile-img">${src ? `<img src="${esc(src)}" alt="" onerror="this.remove()">` : ''}<i>${icon('i-image')}</i></div>`);
      shelf.append(nav(tile, () => this.browse(k.id), 'browse:' + k.id));
    }
    const acts = el('div', 'art-actions');
    acts.append(
      nav(el('div', 'chip-btn big', `${icon('i-refresh')}Récupérer à nouveau`), () => this.refetch(), 'refetch'),
      nav(el('div', 'chip-btn big' + (custom.length ? '' : ' dim'), `${icon('i-restart')}Annuler les modifications`), () => this.resetAll(), 'reset-all'),
      nav(el('div', 'chip-btn big primary', `${icon('i-search')}Parcourir SteamGridDB`), () => this.browse('portrait'), 'browse'),
      nav(el('div', 'chip-btn big', `${icon('i-edit')}Changer de jeu…`), () => this.changeGame(), 'match'),
    );
    const up = el('div', 'art-actions');
    for (const k of KINDS) up.append(nav(el('div', 'chip-btn', `${icon('i-folder')}${esc(k.label)}…`), () => this.pickLocal(k.id), 'local:' + k.id));
    root.replaceChildren(head, shelf, acts, el('div', 'row-title', 'Importer votre image <small>PNG, JPG ou WebP depuis le disque</small>'), up);
    this.matchLine(head.querySelector('p'));
    focusIn(root, focusKey || 'browse');
  },
  async matchLine(p) {
    try {
      if (this.game === undefined) this.game = (await api.get('/api/sgdb/game?id=' + encodeURIComponent(this.g.id))).game;
      if (this.game) this.prefetch();
      if (this.mode !== 'overview' || !p.isConnected) return;
      p.innerHTML = this.game ? `Visuels · SteamGridDB : <b>${esc(this.game.name)}</b>` : 'Visuels · aucun jeu correspondant sur SteamGridDB (Changer de jeu…)';
    } catch (e) { if (p.isConnected) p.textContent = 'Visuels · ' + e.message; }
  },
  /** Liste des visuels d'un type (une seule requête par type, partagée). */
  list(kind) {
    if (!this.items[kind]) {
      this.items[kind] = api.get(`/api/sgdb/assets?game=${this.game.id}&kind=${kind}`);
      this.items[kind].catch(() => { delete this.items[kind]; }); // réessayée à la prochaine demande
    }
    return this.items[kind];
  },
  /** Pendant qu'on regarde l'aperçu : toutes les listes, et les premières vignettes des jaquettes. */
  prefetch() {
    for (const k of KINDS) this.list(k.id).then(list => { if (k.id === 'portrait') preload(list.slice(0, 10).map(a => a.thumb)); }).catch(() => {});
  },
  browse(kind) {
    this.kind = kind;
    this.mode = 'browse';
    this.draw();
  },

  // ------------------------------------------------ parcourir SteamGridDB
  async drawBrowse(focusKey) {
    const g = this.g, custom = g.customArt || [];
    const root = this.el;
    const bar = el('div', 'toolbar');
    bar.append(shoulder('lb'));
    for (const k of KINDS) {
      const t = el('div', 'tab' + (k.id === this.kind ? ' active' : ''), esc(k.label) + (custom.includes(k.id) ? ' ✓' : ''));
      bar.append(nav(t, () => this.setKind(k.id), 'kind:' + k.id));
    }
    bar.append(shoulder('rb'), el('span', 'spacer'));
    bar.append(nav(el('div', 'chip-btn', `${icon('i-folder')}Image du disque…`), () => this.pickLocal(this.kind), 'local'));
    if (custom.includes(this.kind)) bar.append(nav(el('div', 'chip-btn', `${icon('i-refresh')}Automatique`), () => this.reset(this.kind), 'reset'));
    bar.append(nav(el('div', 'chip-btn', `${icon('i-search')}Changer de jeu…`), () => this.changeGame(), 'match'));
    this.status = el('div', 'page-head', `<h1>${esc(g.name)}</h1><p>Recherche sur SteamGridDB…</p>`);
    this.body = el('div', '', '<div class="loading"><i class="spinner big"></i>Chargement des visuels…</div>');
    root.replaceChildren(this.status, bar, this.body);
    focusIn(root, focusKey || 'kind:' + this.kind);
    await this.load(focusKey);
  },
  async load(focusKey) {
    const p = this.status.querySelector('p');
    const kind = this.kind;
    try {
      if (this.game === undefined) this.game = (await api.get('/api/sgdb/game?id=' + encodeURIComponent(this.g.id))).game;
      if (!this.game) {
        p.textContent = 'Aucun jeu correspondant sur SteamGridDB.';
        this.body.innerHTML = '<div class="notice">Utilisez <b>Changer de jeu…</b> pour le chercher sous un autre nom.</div>';
        return;
      }
      p.innerHTML = `SteamGridDB : <b>${esc(this.game.name)}</b> · ${esc(label(kind))}`;
      const list = await this.list(kind);
      if (kind !== this.kind || this.mode !== 'browse') return; // onglet changé entre-temps
      const grid = el('div', 'art-grid ' + kind);
      for (const a of list.slice(0, 96)) {
        const item = el('div', 'art-item', `<img alt="" decoding="async"><small>${esc([a.author, a.style, a.width && `${a.width}×${a.height}`].filter(Boolean).join(' · '))}</small>`);
        const img = item.firstElementChild;
        img.dataset.src = a.thumb;
        thumbs.observe(img);
        grid.append(nav(item, () => this.choose(a), 'asset:' + a.id));
      }
      this.body.replaceChildren(list.length ? grid : el('div', 'empty', `Aucun visuel « ${esc(label(kind).toLowerCase())} » pour ce jeu sur SteamGridDB.`));
      // Onglets voisins : leurs premières vignettes arrivent pendant qu'on regarde celui-ci
      const i = KINDS.findIndex(x => x.id === kind);
      for (const n of [KINDS[(i + 1) % KINDS.length], KINDS[(i + KINDS.length - 1) % KINDS.length]]) {
        this.list(n.id).then(l => preload(l.slice(0, 8).map(a => a.thumb))).catch(() => {});
      }
      if (focusKey && focusKey.startsWith('asset:')) focusIn(this.el, focusKey);
    } catch (e) {
      p.textContent = e.message;
      this.body.innerHTML = '';
    }
  },
  setKind(kind) {
    if (kind === this.kind) return;
    this.kind = kind;
    this.draw('kind:' + kind);
  },
  async choose(a) {
    const kind = this.kind;
    busy('Téléchargement du visuel…');
    try {
      await api.post('/api/art/choose', { id: this.g.id, kind, url: a.url });
      await this.reload();
      toast(applied(kind));
    } catch (e) { toast(e.message, { error: true }); }
    finally { busy(null); }
  },

  // ------------------------------------------------ actions
  async pickLocal(kind) {
    const p = await pickFile('image', `Choisir : ${label(kind).toLowerCase()}`);
    if (!p) return;
    try {
      await api.post('/api/art/local', { id: this.g.id, kind, path: p });
      await this.reload();
      this.draw(this.mode === 'browse' ? 'local' : 'local:' + kind);
      toast(applied(kind));
    } catch (e) { toast(e.message, { error: true }); }
  },
  async reset(kind) {
    await api.post('/api/art/reset', { id: this.g.id, kind });
    await this.reload();
    this.draw('kind:' + kind);
    toast('Visuel automatique rétabli');
  },
  async resetAll() {
    if (!(this.g.customArt || []).length) return toast('Aucun visuel personnalisé pour ce jeu');
    if (!await confirmDialog('Annuler les modifications ?', 'Tous les visuels choisis pour ce jeu reviennent aux visuels automatiques.', 'Annuler les modifications', true)) return;
    await api.post('/api/art/reset', { id: this.g.id, kind: 'all' });
    await this.reload();
    this.draw('reset-all');
    toast('Visuels automatiques rétablis');
  },
  async refetch() {
    busy('Récupération des visuels…');
    try {
      await api.post('/api/art/refetch', { id: this.g.id, keepMatch: true });
      this.items = {};
      await this.reload();
      // Précharge pour que l'aperçu s'affiche d'un coup
      await Promise.all(KINDS.map(k => this.g.art && this.g.art[k.id] ? fetch(this.g.art[k.id]).catch(() => null) : null));
      this.draw('refetch');
      toast('Visuels récupérés');
    } catch (e) { toast(e.message, { error: true }); }
    finally { busy(null); }
  },
  async changeGame() {
    const term = await openKeyboard({ title: 'Chercher le jeu sur SteamGridDB', value: this.g.name });
    if (!term) return;
    busy('Recherche…');
    let results = [];
    try { results = await api.get('/api/sgdb/search?term=' + encodeURIComponent(term)); }
    catch (e) { busy(null); return toast(e.message, { error: true }); }
    busy(null);
    if (!results.length) return toast('Aucun résultat sur SteamGridDB', { error: true });
    const pick = await dialog({
      title: 'Quel jeu ?',
      buttons: [...results.slice(0, 8).map(r => ({ label: `${r.name}${r.year ? ` (${r.year})` : ''}${r.verified ? ' ✓' : ''}`, value: r })), { label: 'Annuler', value: null }],
    });
    if (!pick) return;
    await api.post('/api/sgdb/match', { id: this.g.id, game: pick });
    this.game = pick;
    this.items = {};
    await this.reload();
    this.draw('match');
    toast(`Associé à « ${pick.name} »`);
  },
  button(k) {
    if (this.mode === 'browse' && (k === 'lb' || k === 'rb')) {
      const i = KINDS.findIndex(x => x.id === this.kind);
      sfx('move');
      this.setKind(KINDS[(i + (k === 'rb' ? 1 : -1) + KINDS.length) % KINDS.length].id);
      return true;
    }
    if (k === 'x') { this.pickLocal(this.kind); return true; }
    if (k === 'y' && this.mode === 'overview') { this.refetch(); return true; }
    return false;
  },
  hints() {
    return this.mode === 'browse'
      ? [[['lb', 'rb'], 'Type'], ['x', 'Image du disque'], ['a', 'Appliquer'], ['b', 'Aperçu']]
      : [['y', 'Récupérer à nouveau'], ['x', 'Importer une jaquette'], ['a', 'Choisir'], ['b', 'Retour']];
  },
});
