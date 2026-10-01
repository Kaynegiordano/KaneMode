// Visuels d'un jeu : aperçu (jaquette, fond, logo…), récupération automatique, choix sur SteamGridDB
// (sans compte ni clé) ou image du disque.
import { t, tx } from '../i18n.js';
import { el, esc, icon, api, lib, toast, busy, sfx } from '../core.js';
import { definePage, nav, focusIn, glyph, renderHints } from '../nav.js';
import { dialog, confirmDialog, openKeyboard } from '../widgets.js';
import { pickFile } from './add.js';

const KINDS = [
  { id: 'portrait', label: t('Jaquette'), f: true }, { id: 'hero', label: t('Fond') }, { id: 'logo', label: t('Logo') },
  { id: 'header', label: t('Bannière'), f: true }, { id: 'icon', label: t('Icône'), f: true },
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
const preload = urls => {
  for (const u of urls) if (u && !preloaded.has(u)) {
    if (preloaded.size >= 160) preloaded.delete(preloaded.values().next().value);
    preloaded.add(u);
    const image = new Image(); image.fetchPriority = 'low'; image.src = u;
  }
};
const applied = k => t('{label} appliqué{a}', { label: label(k), a: KINDS.find(x => x.id === k).f ? 'e' : '' });
const shoulder = k => { const s = el('span', 'shoulder', glyph(k)); s.dataset.glyph = k; return s; };

definePage('artpicker', {
  title: () => t('Visuels'),
  render({ id, kind }) {
    if (this.forId !== id) { this.forId = id; this.game = undefined; this.items = {}; this.kind = 'portrait'; this.mode = 'overview'; }
    if (kind) { this.kind = kind; this.mode = 'browse'; }
    this.g = lib.byId(id);
    api.get('/api/config').then(cfg => { const style = cfg.sgdb.style || ''; if (this.forId !== id || style === this.style) return; this.style = style; this.items = {}; if (this.mode === 'browse') this.draw(); }).catch(() => {});
    this.draw();
  },
  leave() { thumbs.disconnect(); },
  back() {
    if (this.mode !== 'browse') return false;
    sfx('back');
    this.mode = 'overview';
    thumbs.disconnect();
    this.draw('browse:' + this.kind);
    return true;
  },
  async reload() {
    await lib.load();
    this.g = lib.byId(this.forId);
  },

  draw(focusKey) {
    const g = this.g;
    if (!g) { this.el.innerHTML = t('<div class="empty">Élément introuvable.</div>'); return; }
    const r = this.mode === 'browse' ? this.drawBrowse(focusKey) : this.drawOverview(focusKey);
    renderHints();
    return r;
  },

  // ------------------------------------------------ aperçu
  drawOverview(focusKey) {
    const g = this.g, custom = g.customArt || [];
    const root = this.el;
    const head = el('div', 'page-head', t('<h1>{a}</h1><p>Visuels · SteamGridDB, sans compte ni clé</p>', { a: esc(g.name) }));
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
      nav(el('div', 'chip-btn big', t('{a}Récupérer à nouveau', { a: icon('i-refresh') })), () => this.refetch(), 'refetch'),
      nav(el('div', 'chip-btn big' + (custom.length ? '' : ' dim'), t('{a}Annuler les modifications', { a: icon('i-restart') })), () => this.resetAll(), 'reset-all'),
      nav(el('div', 'chip-btn big primary', t('{a}Parcourir SteamGridDB', { a: icon('i-search') })), () => this.browse('portrait'), 'browse'),
      nav(el('div', 'chip-btn big', t('{a}Changer de jeu…', { a: icon('i-edit') })), () => this.changeGame(), 'match'),
    );
    const up = el('div', 'art-actions');
    for (const k of KINDS) up.append(nav(el('div', 'chip-btn', `${icon('i-folder')}${esc(k.label)}…`), () => this.pickLocal(k.id), 'local:' + k.id));
    root.replaceChildren(head, shelf, acts, el('div', 'row-title', t('Importer votre image <small>PNG, JPG ou WebP depuis le disque</small>')), up);
    this.matchLine(head.querySelector('p'));
    focusIn(root, focusKey || 'browse');
  },
  async matchLine(p) {
    const id = this.forId;
    try {
      if (this.game === undefined) {
        const result = await api.get('/api/sgdb/game?id=' + encodeURIComponent(id));
        if (id !== this.forId) return;
        this.game = result.game;
      }
      if (this.game) this.prefetch();
      if (this.mode !== 'overview' || !p.isConnected) return;
      p.innerHTML = this.game ? t('Visuels · SteamGridDB : <b>{a}</b>', { a: esc(this.game.name) }) : t('Visuels · aucun jeu correspondant sur SteamGridDB (Changer de jeu…)');
    } catch (e) { if (p.isConnected) p.textContent = `${t('Visuels')} · ${tx(e.message)}`; }
  },
  /** Liste des visuels d'un type (une seule requête par type, partagée). */
  list(kind, first = false) {
    const key = kind + ':' + (this.style || '') + (first ? ':first' : '');
    if (!this.items[key]) {
      const items = this.items;
      items[key] = api.get(`/api/sgdb/assets?game=${this.game.id}&kind=${kind}${first ? '&first=1' : ''}${kind === 'portrait' && this.style ? '&style=' + encodeURIComponent(this.style) : ''}`);
      items[key].catch(() => { delete items[key]; });
    }
    return this.items[key];
  },
  /** Pendant qu'on regarde l'aperçu : toutes les listes, et les premières vignettes des jaquettes. */
  prefetch() {
    for (const k of KINDS) this.list(k.id, true).then(list => { if (k.id === 'portrait') preload(list.slice(0, 10).map(a => a.thumb)); }).catch(() => {});
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
      const tab = el('div', 'tab' + (k.id === this.kind ? ' active' : ''), esc(k.label) + (custom.includes(k.id) ? ' ✓' : ''));
      bar.append(nav(tab, () => this.setKind(k.id), 'kind:' + k.id));
    }
    bar.append(shoulder('rb'), el('span', 'spacer'));
    bar.append(nav(el('div', 'chip-btn', t('{a}Image du disque…', { a: icon('i-folder') })), () => this.pickLocal(this.kind), 'local'));
    if (custom.includes(this.kind)) bar.append(nav(el('div', 'chip-btn', t('{a}Automatique', { a: icon('i-refresh') })), () => this.reset(this.kind), 'reset'));
    bar.append(nav(el('div', 'chip-btn', t('{a}Changer de jeu…', { a: icon('i-search') })), () => this.changeGame(), 'match'));
    this.status = el('div', 'page-head', t('<h1>{a}</h1><p>Recherche sur SteamGridDB…</p>', { a: esc(g.name) }));
    this.body = el('div', '', t('<div class="loading"><i class="spinner big"></i>Chargement des visuels…</div>'));
    root.replaceChildren(this.status, bar, this.body);
    focusIn(root, focusKey || 'kind:' + this.kind);
    await this.load(focusKey);
  },
  async load(focusKey) {
    const p = this.status.querySelector('p');
    const kind = this.kind, entryId = this.forId, body = this.body;
    thumbs.disconnect();
    try {
      if (this.game === undefined) {
        const result = await api.get('/api/sgdb/game?id=' + encodeURIComponent(entryId));
        if (entryId !== this.forId || body !== this.body || kind !== this.kind || this.mode !== 'browse') return;
        this.game = result.game;
      }
      if (!this.game) {
        p.textContent = t('Aucun jeu correspondant sur SteamGridDB.');
        this.body.innerHTML = t('<div class="notice">Utilisez <b>Changer de jeu…</b> pour le chercher sous un autre nom.</div>');
        return;
      }
      p.innerHTML = `SteamGridDB : <b>${esc(this.game.name)}</b> · ${esc(label(kind))}`;
      const list = await this.list(kind, true);
      if (entryId !== this.forId || body !== this.body || kind !== this.kind || this.mode !== 'browse') return; // onglet changé entre-temps
      const grid = el('div', 'art-grid ' + kind);
      const shown = new Set();
      const append = items => { for (const a of items.slice(0, 96)) {
        if (shown.has(a.id)) continue;
        shown.add(a.id);
        const item = el('div', 'art-item', `<img alt="" decoding="async"><small>${esc([a.author, a.style, a.width && `${a.width}×${a.height}`].filter(Boolean).join(' · '))}</small>`);
        const img = item.firstElementChild;
        img.dataset.src = a.thumb;
        thumbs.observe(img);
        grid.append(nav(item, () => this.choose(a), 'asset:' + a.id));
      } };
      append(list);
      this.body.replaceChildren(list.length ? grid : el('div', 'empty', t('Aucun visuel « {a} » pour ce jeu sur SteamGridDB.', { a: esc(label(kind).toLowerCase()) })));
      // Les pages suivantes complètent la grille sur place, sans déplacer le focus.
      this.list(kind).then(all => {
        if (entryId !== this.forId || body !== this.body || kind !== this.kind || this.mode !== 'browse') return;
        append(all);
        if (all.length && !grid.isConnected) body.replaceChildren(grid);
      }).catch(() => {});
      // Onglets voisins : leurs premières vignettes arrivent pendant qu'on regarde celui-ci
      const i = KINDS.findIndex(x => x.id === kind);
      for (const n of [KINDS[(i + 1) % KINDS.length], KINDS[(i + KINDS.length - 1) % KINDS.length]]) {
        this.list(n.id, true).then(l => preload(l.slice(0, 8).map(a => a.thumb))).catch(() => {});
      }
      if (focusKey && focusKey.startsWith('asset:')) focusIn(this.el, focusKey);
    } catch (e) {
      if (entryId !== this.forId || body !== this.body || kind !== this.kind || this.mode !== 'browse') return;
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
    busy(t('Téléchargement du visuel…'));
    try {
      await api.post('/api/art/choose', { id: this.g.id, kind, url: a.url });
      await this.reload();
      toast(applied(kind));
    } catch (e) { toast(e.message, { error: true }); }
    finally { busy(null); }
  },

  // ------------------------------------------------ actions
  async pickLocal(kind) {
    const p = await pickFile('image', t('Choisir : {toLowerCase}', { toLowerCase: label(kind).toLowerCase() }));
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
    toast(t('Visuel automatique rétabli'));
  },
  async resetAll() {
    if (!(this.g.customArt || []).length) return toast(t('Aucun visuel personnalisé pour ce jeu'));
    if (!(await confirmDialog(t('Annuler les modifications ?'), t('Tous les visuels choisis pour ce jeu reviennent aux visuels automatiques.'), t('Annuler les modifications'), true))) return;
    await api.post('/api/art/reset', { id: this.g.id, kind: 'all' });
    await this.reload();
    this.draw('reset-all');
    toast(t('Visuels automatiques rétablis'));
  },
  async refetch() {
    busy(t('Récupération des visuels…'));
    try {
      await api.post('/api/art/refetch', { id: this.g.id, keepMatch: true });
      this.items = {};
      await this.reload();
      // Précharge pour que l'aperçu s'affiche d'un coup
      await Promise.all(KINDS.map(k => this.g.art && this.g.art[k.id] ? fetch(this.g.art[k.id]).catch(() => null) : null));
      this.draw('refetch');
      toast(t('Visuels récupérés'));
    } catch (e) { toast(e.message, { error: true }); }
    finally { busy(null); }
  },
  async changeGame() {
    const term = await openKeyboard({ title: t('Chercher le jeu sur SteamGridDB'), value: this.g.name });
    if (!term) return;
    busy(t('Recherche…'));
    let results = [];
    try { results = await api.get('/api/sgdb/search?term=' + encodeURIComponent(term)); }
    catch (e) { busy(null); return toast(e.message, { error: true }); }
    busy(null);
    if (!results.length) return toast(t('Aucun résultat sur SteamGridDB'), { error: true });
    const pick = await dialog({
      title: t('Quel jeu ?'),
      buttons: [...results.slice(0, 8).map(r => ({ label: `${r.name}${r.year ? ` (${r.year})` : ''}${r.verified ? ' ✓' : ''}`, value: r })), { label: t('Annuler'), value: null }],
    });
    if (!pick) return;
    await api.post('/api/sgdb/match', { id: this.g.id, game: pick });
    this.game = pick;
    this.items = {};
    await this.reload();
    this.draw('match');
    toast(t('Associé à « {name} »', { name: pick.name }));
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
      ? [[['lb', 'rb'], t('Type')], ['x', t('Image du disque')], ['a', t('Appliquer')], ['b', t('Aperçu')]]
      : [['y', t('Récupérer à nouveau')], ['x', t('Importer une jaquette')], ['a', t('Choisir')], ['b', t('Retour')]];
  },
});
