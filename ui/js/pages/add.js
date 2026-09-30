// Ajout de jeux / applis hors boutiques : programmes installés, fichiers, liens web.
// Pages : add (choix), programs (liste), browse (fichiers), details (formulaire).
import { t, tn } from '../i18n.js';
import { $, el, esc, icon, api, lib, store, toast, busy, fmt } from '../core.js';
import { definePage, nav, go, back, focusIn, dropHistory, glyph } from '../nav.js';
import { art } from '../cards.js';
import { openKeyboard, dialog, segmented } from '../widgets.js';
import { deleteCustom } from './game.js';

const loading = text => `<div class="loading"><i class="spinner big"></i>${esc(text)}</div>`;
const prettify = file => {
  const base = file.split(/[\\/]/).pop().replace(/\.(exe|lnk|bat|cmd|url)$/i, '').replace(/[_.]+/g, ' ').trim();
  return base.charAt(0).toUpperCase() + base.slice(1);
};
const fileSize = b => (!b ? '' : b < 1048576 ? Math.max(1, Math.round(b / 1024)) + t(' Ko') : b < 1073741824 ? Math.round(b / 1048576) + t(' Mo') : fmt.gb(b));
const previewUrl = p => '/preview?path=' + encodeURIComponent(p);
export const newDetails = params => go('details', { ...params, nonce: Math.random() });

// ---------- Choix de fichier (page « browse ») ----------
let pending = null;
export function pickFile(mode, title) {
  return new Promise(resolve => { pending = resolve; go('browse', { mode, title }); });
}
function finishPick(path) { const r = pending; pending = null; if (r) r(path); }

const WEB = [
  ['YouTube', 'https://www.youtube.com/tv'], [t('Netflix'), 'https://www.netflix.com'], [t('Twitch'), 'https://www.twitch.tv'],
  [t('Xbox Cloud Gaming'), 'https://www.xbox.com/play'], ['GeForce NOW', 'https://play.geforcenow.com'],
  [t('Spotify'), 'https://open.spotify.com'], [t('Disney+'), 'https://www.disneyplus.com'], [t('Prime Video'), 'https://www.primevideo.com'],
];

definePage('add', {
  title: () => t('Ajouter'),
  render() {
    const root = this.el;
    root.innerHTML = t('<div class="page-head"><h1>Ajouter à la bibliothèque</h1>\n      <p>Jeux hors boutiques, émulateurs, applis du Microsoft Store, sites web : tout ce qui se lance peut rejoindre votre bibliothèque, avec sa jaquette.</p></div>');
    const choices = el('div', 'choices');
    const choice = (iconId, title, text, act, key) => choices.append(nav(el('div', 'choice', `${icon(iconId)}<h3>${title}</h3><p>${text}</p>`), act, key));
    choice('i-grid', t('Applications installées'), t('Choisissez parmi les programmes et les applis du Microsoft Store installés sur ce PC. Sélection multiple possible.'), () => go('programs'), 'programs');
    choice('i-folder', t('Parcourir les fichiers'), t('Un .exe, un raccourci ou un script, n’importe où sur vos disques : jeux DRM-free, émulateurs, outils…'), async () => {
      const p = await pickFile('exe', t('Choisir un programme'));
      if (p) newDetails({ draft: { name: prettify(p), target: p, type: 'game' } });
    }, 'browse');
    choice('i-globe', t('Lien ou appli web'), t('Une adresse web ou un lien d’application (steam://, ms-settings:…) qui s’ouvre dans le navigateur ou l’appli associée.'), async () => {
      const v = await openKeyboard({ title: t('Adresse web ou lien'), value: 'https://', placeholder: 'https://…' });
      if (!v || v.length < 4 || v === 'https://') return;
      let name = t('Lien');
      try { name = new URL(v).hostname.replace(/^www\./, '').split('.')[0]; name = name.charAt(0).toUpperCase() + name.slice(1); } catch { /* pas une URL http */ }
      newDetails({ draft: { name, target: v, type: 'app' } });
    }, 'web');
    root.append(choices);

    root.append(el('h2', 'row-title', t('Applis web populaires <small>un clic pour les ajouter</small>')));
    const row = el('div', 'row');
    for (const [name, url] of WEB) {
      const tile = el('div', 'card tile');
      tile.append(art({ name, art: {} }, []));
      tile.querySelector('.gen').insertAdjacentHTML('beforeend', `<small style="position:relative;opacity:.7">${esc(new URL(url).hostname)}</small>`);
      row.append(nav(tile, () => newDetails({ draft: { name, target: url, type: 'app' } }), 'web:' + name));
    }
    root.append(row);
  },
});

// ---------- Programmes installés ----------
definePage('programs', {
  title: () => t('Applications installées'),
  filter: 'all',
  addType: 'app',
  render() {
    if (!this.data) { this.el.innerHTML = loading(t('Recherche des applications installées… (quelques secondes la première fois)')); this.fetch(false); return; }
    this.draw();
  },
  async fetch(refresh) {
    this.el.innerHTML = loading(t('Recherche des applications installées…'));
    try { this.data = await api.get('/api/programs' + (refresh ? '?refresh=1' : '')); }
    catch (e) { this.data = []; toast(e.message, { error: true }); }
    this.sel = new Set();
    if (this.el.classList.contains('active')) this.draw();
  },
  draw(focusKey) {
    const root = this.el;
    this.sel = this.sel || new Set();
    const data = this.data;
    const lists = { all: data, desktop: data.filter(p => !p.store), store: data.filter(p => p.store) };
    const bar = el('div', 'toolbar');
    for (const [id, label] of [['all', t('Toutes')], ['desktop', t('Bureau')], ['store', t('Microsoft Store')]]) {
      const item = el('div', 'tab' + (this.filter === id ? ' active' : ''), `${label}<span class="count">${lists[id].length}</span>`);
      bar.append(nav(item, () => { this.filter = id; this.draw('f:' + id); }, 'f:' + id));
    }
    bar.append(el('span', 'spacer'), segmented([{ value: 'game', label: t('Ajouter comme jeux') }, { value: 'app', label: t('Comme applis') }], this.addType, v => { this.addType = v; }, 'as'));
    const refresh = el('div', 'chip-btn', t('{a}Actualiser', { a: icon('i-refresh') }));
    bar.append(nav(refresh, () => this.fetch(true), 'refresh'));
    this.addBtn = el('div', 'chip-btn primary');
    bar.append(nav(this.addBtn, () => this.addSelected(), 'addsel'));
    const grid = el('div', 'prog-grid');
    for (const p of lists[this.filter]) {
      const item = el('div', 'prog' + (this.sel.has(p.target) ? ' selected' : '') + (p.inLibrary ? ' in-lib' : ''),
        `<div class="check">${icon('i-check')}</div>${p.icon ? `<img src="${p.icon}" alt="" loading="lazy">` : `<div class="noicon">${esc(p.name[0])}</div>`}<span>${esc(p.name)}</span>${p.inLibrary ? t('<small>Déjà dans la bibliothèque</small>') : ''}`);
      item.dataset.sfx = 'key';
      grid.append(nav(item, () => {
        this.sel.has(p.target) ? this.sel.delete(p.target) : this.sel.add(p.target);
        item.classList.toggle('selected', this.sel.has(p.target));
        this.paintAdd();
      }, 'p:' + p.target));
    }
    root.replaceChildren(el('div', 'page-head', t('<p>Sélectionnez une ou plusieurs applications, puis {glyph} ou « Ajouter ». Les entrées grisées sont déjà dans votre bibliothèque.</p>', { glyph: glyph('x') })), bar, grid);
    this.paintAdd();
    focusIn(root, focusKey);
  },
  paintAdd() { this.addBtn.innerHTML = t('{a}Ajouter ({size})', { a: icon('i-plus'), size: this.sel.size }); },
  async addSelected() {
    const picked = this.data.filter(p => this.sel.has(p.target));
    if (!picked.length) return toast(t('Sélectionnez au moins une application'), { error: true });
    let n = 0;
    for (const p of picked) {
      busy(t('Ajout {a}/{length}…', { a: ++n, length: picked.length }));
      try { await api.post('/api/custom', { name: p.name, type: this.addType, launch: { target: p.target }, icon: p.icon }); }
      catch (e) { toast(`${p.name} : ${e.message}`, { error: true }); }
    }
    busy(null);
    await lib.load();
    this.data = null; this.sel.clear();
    toast(tn(picked.length, '{n} élément ajouté à la bibliothèque', '{n} éléments ajoutés à la bibliothèque'), { notify: true });
    dropHistory(['add', 'programs']);
    go('library', { tab: 'src:custom' }, { push: false });
  },
  button(k) { if (k === 'x') { this.addSelected(); return true; } return false; },
  hints: () => [['x', t('Ajouter la sélection')], ['a', t('Cocher')], ['b', t('Retour')]],
});

// ---------- Navigateur de fichiers ----------
definePage('browse', {
  title: p => p.title || t('Parcourir'),
  render(p) {
    if (this.mode !== p.mode) { this.mode = p.mode; this.path = store.get('browse.' + p.mode, ''); }
    this.load(this.path);
  },
  async load(path, focusKey) {
    let d;
    try { d = await api.get(`/api/browse?mode=${this.mode}&path=${encodeURIComponent(path || '')}`); }
    catch (e) {
      toast(t('Dossier inaccessible'), { error: true });
      if (path) return this.load('');
      return;
    }
    this.path = d.path;
    this.parent = d.parent;
    store.set('browse.' + this.mode, d.path);
    const root = this.el;
    const list = el('div', 'file-list');
    const row = (iconId, cls, name, extra, act, key) => list.append(nav(el('div', 'file ' + cls, `${icon(iconId)}<span>${esc(name)}</span><small>${extra || ''}</small>`), act, key));
    if (this.mode === 'dir' && d.path) row('i-check', 'file', t('Choisir ce dossier'), esc(d.path), () => { finishPick(d.path); back(); }, '__pick');
    if (d.parent !== null) row('i-up', 'up', t('Dossier parent'), '', () => this.load(d.parent, d.path), '..');
    const fileIcon = { image: 'i-image', video: 'i-media', audio: 'i-music' }[this.mode] || 'i-file';
    for (const e of d.entries) {
      if (e.kind === 'file') {
        row(fileIcon, 'file', e.name, fileSize(e.size), () => { finishPick(e.path); back(); }, e.path);
      } else {
        row(e.kind === 'drive' ? 'i-drive' : 'i-folder', e.kind, e.name, e.kind === 'place' ? t('Emplacement') : '', () => this.load(e.path), e.path);
      }
    }
    if (!d.entries.length) {
      list.append(el('div', 'empty', {
        image: t('Aucune image (.png, .jpg, .webp) dans ce dossier.'), video: t('Aucune vidéo (.mp4, .webm) dans ce dossier.'), audio: t('Aucun son (.mp3, .wav, .ogg, .m4a) dans ce dossier.'),
        dir: t('Aucun sous-dossier.'), exe: t('Aucun programme (.exe, .lnk, .bat, .url) dans ce dossier.'),
      }[this.mode] || ''));
    }
    root.replaceChildren(el('div', 'crumb', esc(d.path || t('Emplacements'))), list);
    root.scrollTop = 0;
    focusIn(root, focusKey);
  },
  back() { if (this.path) { this.load(this.parent || '', this.path); return true; } return false; },
  leave() { finishPick(null); },
  button(k) { if (k === 'lb') { this.load(''); return true; } return false; },
  hints: () => [['lb', t('Emplacements')], ['a', t('Ouvrir')], ['b', t('Dossier parent')]],
});

// ---------- Formulaire (ajout / modification) ----------
definePage('details', {
  title: p => (p.editId ? t('Modifier') : t('Nouvel élément')),
  render(p) {
    if (p.nonce !== this.nonce) {
      this.nonce = p.nonce;
      if (p.editId) {
        const g = lib.byId(p.editId);
        this.f = { id: g.id, name: g.name, type: g.type, target: g.launch ? g.launch.target : '', args: g.launch ? g.launch.args : '', icon: null, art: {}, current: g };
      } else {
        this.f = { name: p.draft.name, type: p.draft.type || 'game', target: p.draft.target, args: '', icon: p.draft.icon || null, art: {} };
      }
    }
    this.draw(p.focus);
  },
  draw(focusKey) {
    const f = this.f, cur = f.current;
    const root = this.el;
    const isUri = /^[a-z][\w+.-]*:/i.test(f.target) && !/^[a-z]:\\/i.test(f.target);
    const artState = k => (k in f.art ? (f.art[k] ? f.art[k].split('\\').pop() : t('Automatique')) : cur && cur.art[k] && !cur.art[k].includes('?r=1') ? t('Personnalisée') : t('Automatique'));

    const preview = el('div', 'form-preview');
    const card = el('div', 'card capsule');
    const portrait = 'portrait' in f.art ? (f.art.portrait ? previewUrl(f.art.portrait) : null) : cur ? cur.art.portrait : null;
    card.append(art({ name: f.name || t('Sans nom'), art: { icon: cur ? cur.art.icon : f.icon } }, [portrait]));
    preview.append(card, el('div', 'hint-text', t('Sans jaquette choisie, KaneMode cherche un visuel sur la boutique Steam pour les jeux, puis génère une jaquette à partir de l’icône du programme.')));

    const fields = el('div', 'fields');
    const field = (label, value, iconId, act, key, placeholder = '') => {
      const r = el('div', 'field', `<span>${label}</span><b class="${value ? '' : 'placeholder'}">${esc(value || placeholder)}</b>${iconId ? icon(iconId) : ''}`);
      fields.append(act ? nav(r, act, key) : r);
      return r;
    };
    field(t('Nom'), f.name, 'i-edit', async () => {
      const v = await openKeyboard({ title: t('Nom affiché'), value: f.name });
      if (v !== null && v.trim()) { f.name = v.trim(); this.draw('name'); }
    }, 'name', t('Sans nom'));
    const typeRow = el('div', 'field static', t('<span>Type</span>'));
    typeRow.append(segmented([{ value: 'game', label: t('Jeu') }, { value: 'app', label: t('Application') }], f.type, v => { f.type = v; }, 'type'));
    fields.append(typeRow);
    field(isUri ? t('Adresse') : t('Programme'), f.target, isUri ? 'i-edit' : 'i-folder', async () => {
      if (isUri) {
        const v = await openKeyboard({ title: t('Adresse ou lien'), value: f.target });
        if (v) { f.target = v.trim(); this.draw('target'); }
      } else {
        const p = await pickFile('exe', t('Choisir un programme'));
        if (p) { f.target = p; f.icon = null; this.draw('target'); }
      }
    }, 'target');
    if (/\.exe$/i.test(f.target)) {
      field(t('Arguments'), f.args, 'i-edit', async () => {
        const v = await openKeyboard({ title: t('Arguments de lancement (facultatif)'), value: f.args, placeholder: '-fullscreen' });
        if (v !== null) { f.args = v; this.draw('args'); }
      }, 'args', t('Aucun'));
    }
    for (const [k, label] of [['portrait', t('Jaquette')], ['hero', t('Image de fond')]]) {
      field(label, artState(k), 'i-image', async () => {
        const choice = await dialog({
          title: label, buttons: [
            { label: t('Choisir une image sur le disque…'), value: 'pick', icon: 'i-folder', primary: true },
            { label: t('Automatique'), value: 'auto', icon: 'i-refresh' }, { label: t('Annuler'), value: null },
          ],
        });
        if (choice === 'auto') { f.art[k] = null; this.draw(k); }
        if (choice === 'pick') {
          const p = await pickFile('image', t('Choisir : {toLowerCase}', { toLowerCase: label.toLowerCase() }));
          if (p) { f.art[k] = p; this.draw(k); }
        }
      }, k);
    }

    const actions = el('div', 'form-actions');
    const save = el('div', 'chip-btn primary', `${icon('i-check')}${f.id ? t('Enregistrer') : t('Ajouter à la bibliothèque')}`);
    save.dataset.autofocus = '';
    actions.append(nav(save, () => this.save(), 'save'));
    if (f.id) {
      const del = el('div', 'chip-btn', t('{a}Supprimer', { a: icon('i-trash') }));
      actions.append(nav(del, () => deleteCustom(cur), 'delete'));
    }
    actions.append(nav(el('div', 'chip-btn', t('Annuler')), () => back(), 'cancel'));
    fields.append(actions);

    const form = el('div', 'form');
    form.append(preview, fields);
    root.replaceChildren(el('div', 'page-head', `<h1>${f.id ? t('Modifier « {a} »', { a: esc(cur.name) }) : t('Nouvel élément')}</h1>`), form);
    focusIn(root, focusKey);
  },
  async save() {
    const f = this.f;
    if (!f.name || !f.target) return toast(t('Il faut un nom et un programme ou une adresse'), { error: true });
    busy(t('Enregistrement…'));
    try {
      const saved = await api.post('/api/custom', { id: f.id, name: f.name, type: f.type, launch: { target: f.target, args: f.args }, icon: f.icon, art: f.art });
      await lib.load();
      toast(f.id ? t('Modifications enregistrées') : t('{name} ajouté à la bibliothèque', { name: saved.name }), { notify: !f.id });
      this.nonce = null;
      if (f.id) back();
      else { dropHistory(['add', 'programs', 'browse', 'details']); go('game', { id: saved.id }, { push: false }); }
    } catch (e) { toast(e.message, { error: true }); }
    finally { busy(null); }
  },
});
