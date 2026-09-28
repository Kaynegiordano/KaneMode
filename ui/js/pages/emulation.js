// Émulation : dossiers de ROMs, émulateurs (détectés ou choisis), consoles prises en charge.
import { el, esc, icon, api, lib, toast, busy } from '../core.js';
import { definePage, nav, focusIn } from '../nav.js';
import { dialog } from '../widgets.js';
import { pickFile } from './add.js';

async function scan() {
  busy('Scan des ROMs…');
  try {
    const r = await api.post('/api/roms/scan');
    await lib.load();
    toast(`${r.count} ROM${r.count > 1 ? 's' : ''} trouvée${r.count > 1 ? 's' : ''}, ${r.playable} jouable${r.playable > 1 ? 's' : ''} · ${r.emulators} émulateur${r.emulators > 1 ? 's' : ''}`, { notify: true });
  } catch (e) { toast(e.message, { error: true }); }
  finally { busy(null); }
}

definePage('emulation', {
  libBound: true,
  title: () => 'Émulation',
  render(p = {}) {
    if (!this.data) this.el.innerHTML = '<div class="loading"><i class="spinner big"></i>Recherche des émulateurs…</div>';
    api.get('/api/emulation').then(d => { this.data = d; if (this.el.classList.contains('active')) this.draw(p.focus); })
      .catch(e => toast(e.message, { error: true }));
    if (this.data) this.draw(p.focus);
  },
  draw(focusKey) {
    const d = this.data;
    const root = this.el;
    const s = el('div', 'settings');
    const h2 = (iconId, text) => s.append(el('h2', '', `${icon(iconId)}${text}`));
    const row = (lead, title, desc, act, key) => {
      const r = el('div', 'set-row' + (act ? ' nav' : ''), `${lead}<div class="txt"><b>${title}</b><small>${desc}</small></div><span></span>`);
      if (!lead) r.style.gridTemplateColumns = '1fr auto';
      s.append(act ? nav(r, act, key) : r);
      return r;
    };

    h2('i-folder', 'Dossiers de ROMs');
    s.append(el('div', 'notice', 'Rangez vos jeux dans un sous-dossier par console, comme dans EmulationStation-DE ou RetroBat : <code>D:\\ROMs\\snes</code>, <code>D:\\ROMs\\psx</code>, <code>D:\\ROMs\\gc</code>… Vous pouvez aussi choisir directement un dossier de console.'));
    for (const r of d.romRoots) {
      const n = lib.games.filter(g => g.source === 'rom' && g.romPath && g.romPath.toLowerCase().startsWith(r.toLowerCase())).length;
      row(icon('i-folder'), esc(r), `${n} jeu${n > 1 ? 'x' : ''} trouvé${n > 1 ? 's' : ''}`, async () => {
        const c = await dialog({ title: r, buttons: [{ label: 'Retirer ce dossier', value: 'rm', icon: 'i-trash', danger: true }, { label: 'Fermer', value: null }] });
        if (c !== 'rm') return;
        await api.post('/api/config', { romRoots: d.romRoots.filter(x => x !== r) });
        await lib.load(); this.data = null; this.render();
        toast('Dossier retiré');
      }, 'root:' + r);
    }
    row(icon('i-plus'), 'Ajouter un dossier de ROMs…', 'Choisir un dossier avec la manette', async () => {
      const p = await pickFile('dir', 'Choisir un dossier de ROMs');
      if (!p) return;
      busy('Scan des ROMs…');
      await api.post('/api/config', { romRoots: [...d.romRoots, p] });
      await lib.load(); busy(null);
      this.data = null; this.render({ focus: 'add-root' });
      const n = lib.games.filter(g => g.source === 'rom' && g.romPath && g.romPath.toLowerCase().startsWith(p.toLowerCase())).length;
      toast(`${p} ajouté : ${n} jeu${n > 1 ? 'x' : ''}`, { notify: true });
    }, 'add-root');
    row(icon('i-refresh'), 'Scanner les ROMs et les émulateurs', d.scanned ? `Dernier scan : ${new Date(d.scanned).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}` : 'Jamais scanné', async () => { await scan(); this.data = null; this.render({ focus: 'scan' }); }, 'scan');

    h2('i-gamepad', 'Émulateurs');
    const found = d.emulators.filter(e => e.path).length;
    s.append(el('div', 'notice', `${found} émulateur${found > 1 ? 's' : ''} trouvé${found > 1 ? 's' : ''}. KaneMode les cherche dans Program Files, AppData, Scoop, <code>C:\\Emulators</code>, <code>D:\\Emulation</code>, RetroBat… Si un émulateur portable n’est pas détecté, indiquez son exécutable. Pour RetroArch, les cœurs doivent être installés (Menu principal → Charger un cœur → Télécharger).`));
    for (const e of [...d.emulators].sort((a, b) => !!b.path - !!a.path || a.name.localeCompare(b.name))) {
      row(`<span class="${e.path ? 'dot-ok' : 'dot-ko'}"></span>`, esc(e.name) + (e.source === 'manual' ? ' <small>(choisi)</small>' : ''),
        `${e.path ? esc(e.path) : 'Non trouvé'} · ${esc(e.systems.join(', '))}`, async () => {
          const c = await dialog({
            title: e.name, text: e.path ? esc(e.path) : 'Émulateur non détecté.',
            buttons: [
              { label: 'Indiquer l’exécutable…', value: 'pick', icon: 'i-folder', primary: true },
              ...(e.source === 'manual' ? [{ label: 'Détection automatique', value: 'auto', icon: 'i-refresh' }] : []),
              { label: 'Fermer', value: null },
            ],
          });
          if (c === 'pick') {
            const p = await pickFile('exe', `Exécutable de ${e.name}`);
            if (!p) return;
            await api.post('/api/config', { emulatorPaths: { [e.id]: p } });
          } else if (c === 'auto') {
            await api.post('/api/config', { emulatorPaths: { [e.id]: null } });
          } else return;
          await lib.load(); this.data = null; this.render({ focus: 'emu:' + e.id });
          toast(`${e.name} mis à jour`);
        }, 'emu:' + e.id).style.gridTemplateColumns = 'auto 1fr auto';
    }

    h2('i-rom', 'Consoles prises en charge');
    const grid = el('div', 'sys-grid');
    for (const sy of d.systems) {
      grid.append(el('div', 'sys-card' + (sy.count ? ' has' : ''), `<b>${esc(sy.name)}</b><small>dossier « ${esc(sy.folder)} » · .${sy.exts.slice(0, 4).join(' .')}${sy.count ? ` · <b>${sy.count} jeu${sy.count > 1 ? 'x' : ''}</b>` : ''}</small>`));
    }
    s.append(grid);

    root.replaceChildren(el('div', 'page-head', '<h1>Émulation</h1><p>Vos ROMs apparaissent dans la bibliothèque (onglet Émulation) avec leurs jaquettes SteamGridDB, et se lancent directement dans le bon émulateur.</p>'), s);
    focusIn(root, focusKey);
  },
  hints: () => [['a', 'Sélectionner'], ['b', 'Retour']],
});
