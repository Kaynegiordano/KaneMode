// Monde Émulation : étagère des consoles (couleur et motif propres à chacune), jeux de la console
// choisie, dossier de jeux prêt à remplir, émulateurs installés et tenus à jour par KaneMode.
import { t, tn, locale } from '../i18n.js';
import { el, esc, icon, api, lib, toast, busy, sfx, store } from '../core.js';
import { definePage, nav, focusIn, glyph, renderHints } from '../nav.js';
import { dialog, confirmDialog } from '../widgets.js';
import { gameCard } from '../cards.js';
import { openGame, setBackground, heroUrl } from './game.js';
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
const lookOf = s => ({ color: LOOK[s.id] || '#7c9eff', motif: MOTIF[s.maker] || 'scan' });

const shoulder = k => { const s = el('span', 'shoulder', glyph(k)); s.dataset.glyph = k; return s; };
const pct = j => (j.total ? Math.min(99, Math.round(j.received / j.total * 100)) : 0);

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

definePage('emulation', {
  libBound: true,
  title: () => t('Émulation'),
  initialFocus() { return 'sys:' + (this.sys || 'all'); },
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
  },

  /** Consoles de l'étagère : celles qui ont des jeux, toutes si on le demande ou s'il n'y en a aucune. */
  shelf() {
    const d = this.data;
    const withGames = d.systems.filter(s => s.count);
    const list = this.allSystems || !withGames.length ? d.systems : withGames;
    return [{ id: 'all', name: t('Tout'), maker: t('Récents'), count: withGames.reduce((n, s) => n + s.count, 0) }, ...list];
  },

  draw(focusKey) {
    const d = this.data;
    const root = this.el;
    const roms = lib.visible().filter(g => g.source === 'rom');
    const shelf = this.shelf();
    if (!this.sys) this.sys = store.get('emusys', 'all');
    if (!shelf.some(s => s.id === this.sys)) this.sys = 'all';
    const cur = shelf.find(s => s.id === this.sys);
    this.tint(cur);

    const page = el('div', 'emu');
    // ---------- En-tête
    const consoles = new Set(roms.map(g => g.system)).size;
    const head = el('div', 'emu-hero', `<div class="emu-title"><span class="emu-tag">${t('Rétro')}</span><h1>${t('Émulation')}</h1>
      <p>${roms.length ? tn(roms.length, '{n} jeu', '{n} jeux') + ' · ' + tn(consoles, '{n} console', '{n} consoles') : t('Ajoutez vos jeux, KaneMode s’occupe du reste')}</p></div>`);
    const actions = el('div', 'emu-actions');
    const chip = (ic, label, fn, key, primary) => actions.append(nav(el('div', 'chip-btn' + (primary ? ' primary' : ''), `${icon(ic)}${label}`), fn, key));
    chip('i-folder', t('Dossier des jeux'), () => this.open({ what: 'games' }), 'open-games', !roms.length);
    chip('i-rom', t('BIOS'), () => this.biosDialog(), 'bios');
    chip('i-gamepad', t('Émulateurs'), () => this.toggle('emus'), 'emus');
    chip('i-gear', t('Avancé'), () => this.toggle('advanced'), 'advanced');
    head.append(actions);
    page.append(head);

    // ---------- Premiers pas
    if (!roms.length) {
      page.append(el('div', 'emu-welcome', `
        <div class="emu-step"><b>1</b><div><strong>${t('Ouvrez le dossier des jeux')}</strong><small>${esc(d.dirs.games)}</small></div></div>
        <div class="emu-step"><b>2</b><div><strong>${t('Déposez chaque jeu dans le dossier de sa console')}</strong><small>${t('« Super Nintendo », « PlayStation 2 »… un dossier par console est déjà prêt')}</small></div></div>
        <div class="emu-step"><b>3</b><div><strong>${t('Jouez')}</strong><small>${t('Au premier jeu d’une console, KaneMode installe son émulateur et le règle : écran, manette, sauvegardes')}</small></div></div>`));
    }

    // ---------- Étagère des consoles
    const bar = el('div', 'toolbar emu-shelf-bar');
    bar.append(shoulder('lb'));
    const strip = el('div', 'row emu-shelf');
    for (const s of shelf) {
      const look = s.id === 'all' ? { color: 'var(--accent)', motif: 'scan' } : lookOf(s);
      const tile = el('div', `emu-sys motif-${look.motif}` + (s.id === cur.id ? ' active' : '') + (s.count ? '' : ' empty'),
        `<small>${esc(s.maker)}</small><b>${esc(s.name)}</b><span class="emu-count">${s.count ? '×' + s.count : t('vide')}</span>${s.experimental ? `<i class="emu-exp">${t('expérimental')}</i>` : ''}`);
      tile.style.setProperty('--sys', look.color);
      tile.dataset.sys = s.id;
      strip.append(nav(tile, () => this.setSys(s.id, true), 'sys:' + s.id));
    }
    if (d.systems.some(s => s.count)) {
      const more = el('div', 'emu-sys emu-more', `<small>${t('Consoles')}</small><b>${this.allSystems ? t('Masquer les vides') : t('Toutes les consoles')}</b><span class="emu-count">${d.systems.length}</span>`);
      strip.append(nav(more, () => { this.allSystems = !this.allSystems; this.draw('sys-more'); }, 'sys-more'));
    }
    bar.append(strip, shoulder('rb'));
    page.append(bar);

    // ---------- Console choisie
    let items = roms;
    if (cur.id !== 'all') {
      items = roms.filter(g => g.system === cur.id);
      const s = d.systems.find(x => x.id === cur.id);
      const state = s.bios && !s.bios.ok ? `<span class="emu-warn">${icon('i-info')}${t('Il manque : {what}', { what: esc(s.bios.what) })}</span>`
        : s.ready ? `<span class="emu-ok">${icon('i-check')}${t('Prêt')}</span>`
          : s.emulator ? `<span>${t('{name} s’installera au premier jeu', { name: esc(s.emulatorName) })}</span>` : '';
      const info = el('div', 'emu-sys-head', `<div><h2>${esc(s.name)}${s.experimental ? ` <i class="emu-exp">${t('expérimental')}</i>` : ''}</h2><p>${state}<span class="emu-exts">${s.exts.length ? '.' + esc(s.exts.join(' .')) : t('un dossier par jeu')}</span></p></div>`);
      info.append(nav(el('div', 'chip-btn', `${icon('i-folder')}${t('Ouvrir son dossier')}`), () => this.open({ system: s.id }), 'open-sys'));
      page.append(info);
      items.sort((a, b) => a.name.localeCompare(b.name, locale));
    } else {
      items.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || a.name.localeCompare(b.name, locale));
    }
    const grid = el('div', 'grid emu-grid');
    for (const g of items) {
      const card = gameCard(g, 'capsule', openGame);
      card.append(el('span', 'card-caption', '<b>' + esc(g.name) + '</b>'));
      card.style.setProperty('--sys', LOOK[g.system] || 'var(--accent)');
      grid.append(card);
    }
    if (cur.id !== 'all' || roms.length) {
      const add = el('div', 'card capsule more-card emu-add', `${icon('i-plus')}<div>${t('Ajouter des jeux')}</div>`);
      grid.append(nav(add, () => this.open(cur.id === 'all' ? { what: 'games' } : { system: cur.id }), 'add-games'));
    }
    page.append(grid);

    // ---------- Émulateurs et réglages avancés
    if (this.view === 'emus') page.append(this.emulatorsSection());
    if (this.view === 'advanced') page.append(this.advancedSection());

    root.replaceChildren(page);
    focusIn(root, focusKey);
    renderHints();
  },

  tint(s) {
    const all = !s || s.id === 'all';
    if (all) document.body.style.removeProperty('--emu');
    else document.body.style.setProperty('--emu', lookOf(s).color);
    document.body.dataset.emuMotif = all ? 'scan' : lookOf(s).motif;
  },
  setSys(id, keepOnShelf) {
    if (id === this.sys) return;
    this.sys = id;
    store.set('emusys', id);
    sfx('move');
    this.draw(keepOnShelf ? 'sys:' + id : null);
    if (!keepOnShelf) focusIn(this.el.querySelector('.emu-grid') || this.el);
  },
  toggle(view) {
    this.view = this.view === view ? null : view;
    this.draw(view);
    if (this.view) this.el.querySelector('.emu-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (view === 'emus' && this.view) this.checkUpdates();
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
      if (this.el.classList.contains('active') && this.view === 'emus') this.draw(this.focusedKey());
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
      if (this.el.classList.contains('active')) this.draw(this.focusedKey());
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

  onFocus(target) {
    if (target.dataset.sys) { const s = this.shelf().find(x => x.id === target.dataset.sys); if (s) this.tint(s); return; }
    const g = target.dataset.id && lib.byId(target.dataset.id);
    if (g) setBackground(heroUrl(g));
  },
  button(k) {
    if ((k !== 'lb' && k !== 'rb') || !this.data) return false;
    const list = this.shelf();
    const i = list.findIndex(s => s.id === this.sys);
    const next = list[(i + (k === 'rb' ? 1 : -1) + list.length) % list.length];
    this.setSys(next.id, !!this.el.querySelector('.emu-sys.focused'));
    return true;
  },
  hints: () => [[['lb', 'rb'], t('<span class="label-long">Consoles</span>')], ['a', t('Ouvrir')], ['b', t('Retour')]],
});
