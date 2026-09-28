// Ajout de jeux / applis hors boutiques : programmes installés, fichiers, liens web.
// Pages : add (choix), programs (liste), browse (fichiers), details (formulaire).
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
const fileSize = b => (!b ? '' : b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' Ko' : b < 1073741824 ? Math.round(b / 1048576) + ' Mo' : fmt.gb(b));
const previewUrl = p => '/preview?path=' + encodeURIComponent(p);
export const newDetails = params => go('details', { ...params, nonce: Math.random() });

// ---------- Choix de fichier (page « browse ») ----------
let pending = null;
export function pickFile(mode, title) {
  return new Promise(resolve => { pending = resolve; go('browse', { mode, title }); });
}
function finishPick(path) { const r = pending; pending = null; if (r) r(path); }

const WEB = [
  ['YouTube', 'https://www.youtube.com/tv'], ['Netflix', 'https://www.netflix.com'], ['Twitch', 'https://www.twitch.tv'],
  ['Xbox Cloud Gaming', 'https://www.xbox.com/play'], ['GeForce NOW', 'https://play.geforcenow.com'],
  ['Spotify', 'https://open.spotify.com'], ['Disney+', 'https://www.disneyplus.com'], ['Prime Video', 'https://www.primevideo.com'],
];

definePage('add', {
  title: () => 'Ajouter',
  render() {
    const root = this.el;
    root.innerHTML = `<div class="page-head"><h1>Ajouter à la bibliothèque</h1>
      <p>Jeux hors boutiques, émulateurs, applis du Microsoft Store, sites web : tout ce qui se lance peut rejoindre votre bibliothèque, avec sa jaquette.</p></div>`;
    const choices = el('div', 'choices');
    const choice = (iconId, title, text, act, key) => choices.append(nav(el('div', 'choice', `${icon(iconId)}<h3>${title}</h3><p>${text}</p>`), act, key));
    choice('i-grid', 'Applications installées', 'Choisissez parmi les programmes et les applis du Microsoft Store installés sur ce PC. Sélection multiple possible.', () => go('programs'), 'programs');
    choice('i-folder', 'Parcourir les fichiers', 'Un .exe, un raccourci ou un script, n’importe où sur vos disques : jeux DRM-free, émulateurs, outils…', async () => {
      const p = await pickFile('exe', 'Choisir un programme');
      if (p) newDetails({ draft: { name: prettify(p), target: p, type: 'game' } });
    }, 'browse');
    choice('i-globe', 'Lien ou appli web', 'Une adresse web ou un lien d’application (steam://, ms-settings:…) qui s’ouvre dans le navigateur ou l’appli associée.', async () => {
      const v = await openKeyboard({ title: 'Adresse web ou lien', value: 'https://', placeholder: 'https://…' });
      if (!v || v.length < 4 || v === 'https://') return;
      let name = 'Lien';
      try { name = new URL(v).hostname.replace(/^www\./, '').split('.')[0]; name = name.charAt(0).toUpperCase() + name.slice(1); } catch { /* pas une URL http */ }
      newDetails({ draft: { name, target: v, type: 'app' } });
    }, 'web');
    root.append(choices);

    root.append(el('h2', 'row-title', 'Applis web populaires <small>un clic pour les ajouter</small>'));
    const row = el('div', 'row');
    for (const [name, url] of WEB) {
      const t = el('div', 'card tile');
      t.append(art({ name, art: {} }, []));
      t.querySelector('.gen').insertAdjacentHTML('beforeend', `<small style="position:relative;opacity:.7">${esc(new URL(url).hostname)}</small>`);
      row.append(nav(t, () => newDetails({ draft: { name, target: url, type: 'app' } }), 'web:' + name));
    }
    root.append(row);
  },
});

// ---------- Programmes installés ----------
definePage('programs', {
  title: () => 'Applications installées',
  filter: 'all',
  addType: 'app',
  render() {
    if (!this.data) { this.el.innerHTML = loading('Recherche des applications installées… (quelques secondes la première fois)'); this.fetch(false); return; }
    this.draw();
  },
  async fetch(refresh) {
    this.el.innerHTML = loading('Recherche des applications installées…');
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
    for (const [id, label] of [['all', 'Toutes'], ['desktop', 'Bureau'], ['store', 'Microsoft Store']]) {
      const t = el('div', 'tab' + (this.filter === id ? ' active' : ''), `${label}<span class="count">${lists[id].length}</span>`);
      bar.append(nav(t, () => { this.filter = id; this.draw('f:' + id); }, 'f:' + id));
    }
    bar.append(el('span', 'spacer'), segmented([{ value: 'game', label: 'Ajouter comme jeux' }, { value: 'app', label: 'Comme applis' }], this.addType, v => { this.addType = v; }, 'as'));
    const refresh = el('div', 'chip-btn', `${icon('i-refresh')}Actualiser`);
    bar.append(nav(refresh, () => this.fetch(true), 'refresh'));
    this.addBtn = el('div', 'chip-btn primary');
    bar.append(nav(this.addBtn, () => this.addSelected(), 'addsel'));
    const grid = el('div', 'prog-grid');
    for (const p of lists[this.filter]) {
      const t = el('div', 'prog' + (this.sel.has(p.target) ? ' selected' : '') + (p.inLibrary ? ' in-lib' : ''),
        `<div class="check">${icon('i-check')}</div>${p.icon ? `<img src="${p.icon}" alt="" loading="lazy">` : `<div class="noicon">${esc(p.name[0])}</div>`}<span>${esc(p.name)}</span>${p.inLibrary ? '<small>Déjà dans la bibliothèque</small>' : ''}`);
      t.dataset.sfx = 'key';
      grid.append(nav(t, () => {
        this.sel.has(p.target) ? this.sel.delete(p.target) : this.sel.add(p.target);
        t.classList.toggle('selected', this.sel.has(p.target));
        this.paintAdd();
      }, 'p:' + p.target));
    }
    root.replaceChildren(el('div', 'page-head', `<p>Sélectionnez une ou plusieurs applications, puis ${glyph('x')} ou « Ajouter ». Les entrées grisées sont déjà dans votre bibliothèque.</p>`), bar, grid);
    this.paintAdd();
    focusIn(root, focusKey);
  },
  paintAdd() { this.addBtn.innerHTML = `${icon('i-plus')}Ajouter (${this.sel.size})`; },
  async addSelected() {
    const picked = this.data.filter(p => this.sel.has(p.target));
    if (!picked.length) return toast('Sélectionnez au moins une application', { error: true });
    let n = 0;
    for (const p of picked) {
      busy(`Ajout ${++n}/${picked.length}…`);
      try { await api.post('/api/custom', { name: p.name, type: this.addType, launch: { target: p.target }, icon: p.icon }); }
      catch (e) { toast(`${p.name} : ${e.message}`, { error: true }); }
    }
    busy(null);
    await lib.load();
    this.data = null; this.sel.clear();
    toast(`${picked.length} élément${picked.length > 1 ? 's' : ''} ajouté${picked.length > 1 ? 's' : ''} à la bibliothèque`, { notify: true });
    dropHistory(['add', 'programs']);
    go('library', { tab: 'src:custom' }, { push: false });
  },
  button(k) { if (k === 'x') { this.addSelected(); return true; } return false; },
  hints: () => [['x', 'Ajouter la sélection'], ['a', 'Cocher'], ['b', 'Retour']],
});

// ---------- Navigateur de fichiers ----------
definePage('browse', {
  title: p => p.title || 'Parcourir',
  render(p) {
    if (this.mode !== p.mode) { this.mode = p.mode; this.path = store.get('browse.' + p.mode, ''); }
    this.load(this.path);
  },
  async load(path, focusKey) {
    let d;
    try { d = await api.get(`/api/browse?mode=${this.mode}&path=${encodeURIComponent(path || '')}`); }
    catch (e) {
      toast('Dossier inaccessible', { error: true });
      if (path) return this.load('');
      return;
    }
    this.path = d.path;
    this.parent = d.parent;
    store.set('browse.' + this.mode, d.path);
    const root = this.el;
    const list = el('div', 'file-list');
    const row = (iconId, cls, name, extra, act, key) => list.append(nav(el('div', 'file ' + cls, `${icon(iconId)}<span>${esc(name)}</span><small>${extra || ''}</small>`), act, key));
    if (this.mode === 'dir' && d.path) row('i-check', 'file', 'Choisir ce dossier', esc(d.path), () => { finishPick(d.path); back(); }, '__pick');
    if (d.parent !== null) row('i-up', 'up', 'Dossier parent', '', () => this.load(d.parent, d.path), '..');
    const fileIcon = { image: 'i-image', video: 'i-media', audio: 'i-music' }[this.mode] || 'i-file';
    for (const e of d.entries) {
      if (e.kind === 'file') {
        row(fileIcon, 'file', e.name, fileSize(e.size), () => { finishPick(e.path); back(); }, e.path);
      } else {
        row(e.kind === 'drive' ? 'i-drive' : 'i-folder', e.kind, e.name, e.kind === 'place' ? 'Emplacement' : '', () => this.load(e.path), e.path);
      }
    }
    if (!d.entries.length) {
      list.append(el('div', 'empty', {
        image: 'Aucune image (.png, .jpg, .webp) dans ce dossier.', video: 'Aucune vidéo (.mp4, .webm) dans ce dossier.', audio: 'Aucun son (.mp3, .wav, .ogg, .m4a) dans ce dossier.',
        dir: 'Aucun sous-dossier.', exe: 'Aucun programme (.exe, .lnk, .bat, .url) dans ce dossier.',
      }[this.mode] || ''));
    }
    root.replaceChildren(el('div', 'crumb', esc(d.path || 'Emplacements')), list);
    root.scrollTop = 0;
    focusIn(root, focusKey);
  },
  back() { if (this.path) { this.load(this.parent || '', this.path); return true; } return false; },
  leave() { finishPick(null); },
  button(k) { if (k === 'lb') { this.load(''); return true; } return false; },
  hints: () => [['lb', 'Emplacements'], ['a', 'Ouvrir'], ['b', 'Dossier parent']],
});

// ---------- Formulaire (ajout / modification) ----------
definePage('details', {
  title: p => (p.editId ? 'Modifier' : 'Nouvel élément'),
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
    const artState = k => (k in f.art ? (f.art[k] ? f.art[k].split('\\').pop() : 'Automatique') : cur && cur.art[k] && !cur.art[k].includes('?r=1') ? 'Personnalisée' : 'Automatique');

    const preview = el('div', 'form-preview');
    const card = el('div', 'card capsule');
    const portrait = 'portrait' in f.art ? (f.art.portrait ? previewUrl(f.art.portrait) : null) : cur ? cur.art.portrait : null;
    card.append(art({ name: f.name || 'Sans nom', art: { icon: cur ? cur.art.icon : f.icon } }, [portrait]));
    preview.append(card, el('div', 'hint-text', 'Sans jaquette choisie, KaneMode cherche un visuel sur la boutique Steam pour les jeux, puis génère une jaquette à partir de l’icône du programme.'));

    const fields = el('div', 'fields');
    const field = (label, value, iconId, act, key, placeholder = '') => {
      const r = el('div', 'field', `<span>${label}</span><b class="${value ? '' : 'placeholder'}">${esc(value || placeholder)}</b>${iconId ? icon(iconId) : ''}`);
      fields.append(act ? nav(r, act, key) : r);
      return r;
    };
    field('Nom', f.name, 'i-edit', async () => {
      const v = await openKeyboard({ title: 'Nom affiché', value: f.name });
      if (v !== null && v.trim()) { f.name = v.trim(); this.draw('name'); }
    }, 'name', 'Sans nom');
    const typeRow = el('div', 'field static', '<span>Type</span>');
    typeRow.append(segmented([{ value: 'game', label: 'Jeu' }, { value: 'app', label: 'Application' }], f.type, v => { f.type = v; }, 'type'));
    fields.append(typeRow);
    field(isUri ? 'Adresse' : 'Programme', f.target, isUri ? 'i-edit' : 'i-folder', async () => {
      if (isUri) {
        const v = await openKeyboard({ title: 'Adresse ou lien', value: f.target });
        if (v) { f.target = v.trim(); this.draw('target'); }
      } else {
        const p = await pickFile('exe', 'Choisir un programme');
        if (p) { f.target = p; f.icon = null; this.draw('target'); }
      }
    }, 'target');
    if (/\.exe$/i.test(f.target)) {
      field('Arguments', f.args, 'i-edit', async () => {
        const v = await openKeyboard({ title: 'Arguments de lancement (facultatif)', value: f.args, placeholder: '-fullscreen' });
        if (v !== null) { f.args = v; this.draw('args'); }
      }, 'args', 'Aucun');
    }
    for (const [k, label] of [['portrait', 'Jaquette'], ['hero', 'Image de fond']]) {
      field(label, artState(k), 'i-image', async () => {
        const choice = await dialog({
          title: label, buttons: [
            { label: 'Choisir une image sur le disque…', value: 'pick', icon: 'i-folder', primary: true },
            { label: 'Automatique', value: 'auto', icon: 'i-refresh' }, { label: 'Annuler', value: null },
          ],
        });
        if (choice === 'auto') { f.art[k] = null; this.draw(k); }
        if (choice === 'pick') {
          const p = await pickFile('image', `Choisir : ${label.toLowerCase()}`);
          if (p) { f.art[k] = p; this.draw(k); }
        }
      }, k);
    }

    const actions = el('div', 'form-actions');
    const save = el('div', 'chip-btn primary', `${icon('i-check')}${f.id ? 'Enregistrer' : 'Ajouter à la bibliothèque'}`);
    save.dataset.autofocus = '';
    actions.append(nav(save, () => this.save(), 'save'));
    if (f.id) {
      const del = el('div', 'chip-btn', `${icon('i-trash')}Supprimer`);
      actions.append(nav(del, () => deleteCustom(cur), 'delete'));
    }
    actions.append(nav(el('div', 'chip-btn', 'Annuler'), () => back(), 'cancel'));
    fields.append(actions);

    const form = el('div', 'form');
    form.append(preview, fields);
    root.replaceChildren(el('div', 'page-head', `<h1>${f.id ? `Modifier « ${esc(cur.name)} »` : 'Nouvel élément'}</h1>`), form);
    focusIn(root, focusKey);
  },
  async save() {
    const f = this.f;
    if (!f.name || !f.target) return toast('Il faut un nom et un programme ou une adresse', { error: true });
    busy('Enregistrement…');
    try {
      const saved = await api.post('/api/custom', { id: f.id, name: f.name, type: f.type, launch: { target: f.target, args: f.args }, icon: f.icon, art: f.art });
      await lib.load();
      toast(f.id ? 'Modifications enregistrées' : `${saved.name} ajouté à la bibliothèque`, { notify: !f.id });
      this.nonce = null;
      if (f.id) back();
      else { dropHistory(['add', 'programs', 'browse', 'details']); go('game', { id: saved.id }, { push: false }); }
    } catch (e) { toast(e.message, { error: true }); }
    finally { busy(null); }
  },
});
