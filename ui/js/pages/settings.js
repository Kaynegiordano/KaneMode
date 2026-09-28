// Paramètres, organisés comme SteamOS : catégories à gauche, réglages à droite.
import { el, esc, icon, api, lib, settings, saveSettings, sourceOf, toast, busy, fmt, native } from '../core.js';
import { definePage, nav, padLive, focusIn, go } from '../nav.js';
import { segmented, switchRow, openKeyboard, confirmDialog } from '../widgets.js';
import { pickFile } from './add.js';
import { exitToDesktop, openGame, openStreaming } from './game.js';
import { playBoot, chime } from '../boot.js';
import { sleepNow } from '../power.js';

const ACCENTS = ['#1a9fff', '#6a5cff', '#3fca5a', '#ff8a3d', '#ff4d8d', '#e5484d', '#1fc7c1', '#e6e9ee'];
const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L3', 'R3', '↑', '↓', '←', '→', 'Guide'];
const SECTIONS = [
  ['library', 'i-library', 'Bibliothèque'], ['sgdb', 'i-image', 'SteamGridDB'], ['emulation', 'i-rom', 'Émulation'], ['stream', 'i-wifi', 'Streaming'],
  ['look', 'i-palette', 'Apparence'], ['boot', 'i-media', 'Démarrage'], ['pad', 'i-gamepad', 'Manette'],
  ['access', 'i-info', 'Accessibilité'], ['power', 'i-moon', 'Veille'], ['device', 'i-battery', 'Console portable'],
  ['storage', 'i-drive', 'Stockage'], ['xbox', 'i-desktop', 'Mode Xbox'], ['system', 'i-cpu', 'Système'],
];
// Réglage demandé par une autre page → catégorie à afficher
const SECTION_OF = { 'sgdb-key': 'sgdb', scan: 'library', demo: 'library' };

export async function rescan() {
  busy('Analyse de la bibliothèque…');
  try {
    const r = await api.post('/api/scan');
    await lib.load();
    toast(r.added.length ? `${r.added.length} nouveauté${r.added.length > 1 ? 's' : ''} : ${r.added.slice(0, 3).join(', ')}${r.added.length > 3 ? '…' : ''}` : 'Bibliothèque à jour, rien de nouveau', { notify: r.added.length > 0 });
  } catch (e) { toast(e.message, { error: true }); }
  finally { busy(null); }
}

const h2 = (s, iconId, text) => s.append(el('h2', '', `${icon(iconId)}${text}`));
function actionRow(s, iconId, title, desc, act, key) {
  const r = el('div', 'set-row nav', `${icon(iconId)}<div class="txt"><b>${title}</b><small>${desc}</small></div><span></span>`);
  r.querySelector('svg').style.cssText = 'width:26px;height:26px;fill:var(--accent)';
  s.append(nav(r, act, key));
  return r;
}
function infoRow(s, title, desc, control) {
  const r = el('div', 'set-row', `<div class="txt"><b>${title}</b>${desc ? `<small>${desc}</small>` : ''}</div>`);
  r.style.gridTemplateColumns = '1fr auto';
  if (control) r.append(control);
  s.append(r);
  return r;
}
const toggle = (s, key, title, desc) => s.append(switchRow({ title, desc, on: settings[key], key, onToggle: v => { settings[key] = v; saveSettings(); } }));
const scaleSeg = key => segmented([90, 100, 110, 125].map(v => ({ value: v, label: v + ' %' })), settings.uiScale, v => { settings.uiScale = +v; saveSettings(); }, key);

let page;
const rerender = focus => page.show(page.section, focus);

// ---------- Appareil, réglages Windows, pilotes
const device = (force = false) => api.get(`/api/device?simulate=${encodeURIComponent(settings.simulateDevice || '')}${force ? '&refresh=1' : ''}`).catch(() => null);
async function openDevice(target) {
  try { await api.post('/api/device/open', { target, simulate: settings.simulateDevice || '' }); toast('Ouverture…'); }
  catch (e) { toast(e.message, { error: true }); }
}
async function openWin(p) {
  try { await api.post('/api/open-settings', { page: p }); toast('Ouverture des Paramètres Windows…'); }
  catch (e) { toast(e.message, { error: true }); }
}
const day = d => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

// ---------- Mises à jour de KaneMode (Releases GitHub)
async function updatesBlock(s) {
  h2(s, 'i-download2', 'Mises à jour');
  const box = el('div');
  s.append(box);
  let timer = 0;
  const draw = async focus => {
    const u = await api.get('/api/update').catch(() => null);
    if (!u || !box.isConnected) return clearInterval(timer);
    box.replaceChildren();
    const l = u.last, j = u.job;
    infoRow(box, `KaneMode ${esc(u.current)}`, u.packaged ? 'App installée' : 'Version de développement (mise à jour par l’installateur)');
    const chan = el('div', 'set-row', '<div class="txt"><b>Canal</b><small>Bêta : nouveautés plus tôt, parfois moins stables</small></div>');
    chan.style.gridTemplateColumns = '1fr auto';
    chan.append(segmented([{ value: 'stable', label: 'Stable' }, { value: 'beta', label: 'Bêta' }], u.channel, async v => {
      await api.post('/api/update/prefs', { channel: v });
      draw('upd-check');
    }, 'upd-chan'));
    box.append(chan);
    box.append(switchRow({ title: 'Vérifier au démarrage', desc: 'Une notification signale une nouvelle version', on: u.auto, key: 'upd-auto', onToggle: v => api.post('/api/update/prefs', { auto: v }) }));
    const status = !l ? 'Jamais vérifié' : l.available ? `Version ${esc(l.latest.version)} disponible${l.latest.prerelease ? ' (bêta)' : ''}` : l.latest ? `À jour · dernière version ${esc(l.latest.version)}` : 'Aucune version publiée pour ce canal';
    actionRow(box, 'i-refresh', 'Rechercher des mises à jour', `${status}${l ? ` · vérifié le ${day(l.checked)}` : ''}`, async () => {
      busy('Recherche des mises à jour…');
      try { await api.post('/api/update/check'); }
      catch (e) { toast(e.message, { error: true }); }
      finally { busy(null); }
      draw('upd-check');
    }, 'upd-check');
    if (l && l.available) {
      if (l.latest.notes) box.append(el('div', 'notice update-notes', esc(l.latest.notes).replace(/\r?\n/g, '<br>')));
      if (!u.packaged) {
        actionRow(box, 'i-globe', 'Ouvrir la page de téléchargement', 'Installateur KaneMode-Setup sur GitHub', () => api.post('/api/update/page'), 'upd-page');
      } else if (j.phase === 'downloading') {
        const pct = j.total ? Math.round(100 * j.received / j.total) : 0;
        infoRow(box, `Téléchargement de la version ${esc(j.version)}… ${pct} %`, `${fmt.size(j.received)} sur ${fmt.size(j.total)}`);
        clearInterval(timer);
        timer = setInterval(() => draw(), 1000);
      } else if (j.phase === 'ready' && j.version === l.latest.version) {
        clearInterval(timer);
        actionRow(box, 'i-download2', `Installer la version ${esc(l.latest.version)}`, 'KaneMode se ferme, s’installe et se relance tout seul (environ 30 secondes)', async () => {
          if (!await confirmDialog('Installer la mise à jour ?', 'KaneMode va se fermer pendant l’installation, puis se relancer. Les jeux en cours ne sont pas fermés.', 'Installer')) return;
          try { await api.post('/api/update/apply'); busy('Installation de la mise à jour…'); }
          catch (e) { toast(e.message, { error: true }); }
        }, 'upd-apply');
      } else {
        clearInterval(timer);
        if (j.phase === 'error') infoRow(box, '<span class="dot-ko"></span>Échec du téléchargement', esc(j.error || ''));
        actionRow(box, 'i-download2', `Télécharger la version ${esc(l.latest.version)}`, `${fmt.size(l.latest.msix.size)} · empreinte SHA-256 vérifiée`, async () => {
          try { await api.post('/api/update/download'); } catch (e) { return toast(e.message, { error: true }); }
          draw('upd-apply');
        }, 'upd-dl');
      }
    }
    if (focus) focusIn(box, focus);
  };
  await draw();
}

async function driversBlock(s) {
  const box = el('div');
  s.append(box);
  const draw = async focus => {
    const st = await api.get('/api/drivers').catch(() => ({}));
    if (!box.isConnected) return;
    box.replaceChildren();
    const last = st.last;
    const items = last && last.ok ? last.items : [];
    const sub = st.searching ? 'Recherche en cours sur Windows Update…'
      : !last ? 'Jamais vérifié sur ce PC · via Windows Update, sans droits administrateur'
        : !last.ok ? `Échec : ${esc(last.error || 'erreur inconnue')}`
          : `${items.length ? `${items.length} mise${items.length > 1 ? 's' : ''} à jour proposée${items.length > 1 ? 's' : ''}` : 'Aucune mise à jour de pilote en attente'} · vérifié le ${day(last.checked)}`;
    actionRow(box, 'i-search', 'Rechercher des mises à jour de pilotes', sub, async () => {
      busy('Recherche des pilotes sur Windows Update…');
      try { await api.post('/api/drivers/search'); }
      catch (e) { toast(e.message, { error: true }); }
      finally { busy(null); }
      draw('drv-search');
    }, 'drv-search');
    for (const it of items) {
      infoRow(box, esc(it.title), [it.class, it.provider || it.maker, it.date && `version du ${day(it.date)}`, it.size ? fmt.size(it.size) : ''].filter(Boolean).map(esc).join(' · '));
    }
    if (items.length) {
      actionRow(box, 'i-download2', items.length > 1 ? `Installer les ${items.length} mises à jour` : 'Installer la mise à jour',
        st.installing ? 'Installation en cours…' : 'Windows demande l’accord de l’administrateur ; un redémarrage peut être nécessaire', async () => {
          if (st.installing) return toast('Installation déjà en cours');
          if (!await confirmDialog('Installer les pilotes ?', 'Windows va demander l’autorisation de l’administrateur. Pendant l’installation, l’écran peut clignoter ou s’éteindre un instant.', 'Installer')) return;
          try { await api.post('/api/drivers/install', { ids: items.map(i => i.id) }); toast('Installation lancée · acceptez la demande de Windows'); }
          catch (e) { return toast(e.message, { error: true }); }
          // Suivi jusqu'à la fin de l'installation
          const timer = setInterval(async () => {
            const now = await api.get('/api/drivers').catch(() => null);
            if (!now || now.installing) return;
            clearInterval(timer);
            const r = now.install;
            if (!r) toast('Installation annulée', { error: true });
            else if (r.ok) toast(`${r.installed} pilote${r.installed > 1 ? 's' : ''} installé${r.installed > 1 ? 's' : ''}${r.reboot ? ' · redémarrez pour terminer' : ''}`, { notify: true });
            else toast(`Échec de l’installation : ${r.error || ''}`, { error: true });
            draw('drv-search');
          }, 3000);
        }, 'drv-install');
    }
    if (st.install && !st.installing) {
      infoRow(box, st.install.ok ? 'Dernière installation réussie' : 'Dernière installation échouée',
        st.install.ok ? `${st.install.installed} pilote(s) installé(s)${st.install.reboot ? ' · redémarrage nécessaire' : ''}` : esc(st.install.error || ''));
    }
    actionRow(box, 'i-open', 'Ouvrir Windows Update', 'Mises à jour facultatives : pilotes proposés par les constructeurs', () => openWin('optional-updates'), 'drv-wu');
    if (focus) focusIn(box, focus);
  };
  await draw();
}

const BUILDERS = {
  async library(s) {
    h2(s, 'i-library', 'Bibliothèque');
    actionRow(s, 'i-refresh', 'Actualiser la bibliothèque', `Détecte les jeux de toutes les boutiques et les ROMs${lib.generated ? ` · dernier scan le ${new Date(lib.generated).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}`, rescan, 'scan');
    s.append(switchRow({
      title: 'Bibliothèque de démonstration', key: 'demo', on: settings.demo,
      desc: 'Ajoute des jeux fictifs de toutes les boutiques et des ROMs pour voir une grosse bibliothèque. Marqués « DÉMO », ils ne se lancent pas.',
      onToggle: async v => { settings.demo = v; saveSettings(); await lib.load(); toast(v ? 'Démo activée' : 'Démo désactivée'); },
    }));
    h2(s, 'i-store', 'Boutiques et lanceurs');
    const counts = {};
    lib.games.forEach(g => { counts[g.source] = (counts[g.source] || 0) + 1; });
    const rowFor = (id, name, img, installed) => {
      const n = counts[id] || 0;
      const lead = img ? `<img src="${img}" alt="">` : '<span class="noicon"></span>';
      const status = installed === null ? `${n} élément${n > 1 ? 's' : ''}` : installed ? `Installé · ${n} élément${n > 1 ? 's' : ''}` : n ? `${n} élément${n > 1 ? 's' : ''} (démo)` : 'Non détecté sur ce PC';
      s.append(switchRow({
        lead, title: name, desc: `${status} · afficher dans la bibliothèque`, key: 'src:' + id, on: !settings.hiddenSources.includes(id),
        onToggle: v => { settings.hiddenSources = v ? settings.hiddenSources.filter(x => x !== id) : [...settings.hiddenSources, id]; saveSettings(); },
      }));
    };
    const launchers = [...lib.launchers].sort((a, b) => b.installed - a.installed || (counts[b.id] || 0) - (counts[a.id] || 0));
    for (const l of launchers) if (sourceOf(l.id).label !== l.id) rowFor(l.id, l.name, l.icon, l.installed);
    rowFor('custom', 'Ajouts perso', null, null);
    rowFor('rom', 'Émulation', null, null);
  },

  async sgdb(s) {
    h2(s, 'i-image', 'SteamGridDB');
    const cfg = await api.get('/api/config');
    s.append(el('div', 'notice', 'Jaquettes, fonds, logos et icônes de la communauté SteamGridDB pour <b>tous</b> vos jeux (Steam, autres boutiques, ajouts perso, ROMs). <b>Rien à configurer</b> : ni compte, ni clé. Pour un jeu précis : fiche du jeu → <b>Visuels</b> (Récupérer à nouveau, Parcourir SteamGridDB, Importer votre image).'));
    const cfgToggle = (key, title, desc, on) => s.append(switchRow({ title, desc, on, key: 'cfg:' + key, onToggle: async v => { await api.post('/api/config', { [key]: v }); await lib.load(); } }));
    cfgToggle('sgdbAuto', 'Visuels automatiques', 'Complète automatiquement les jaquettes, fonds et logos manquants', cfg.sgdb.auto);
    cfgToggle('sgdbPreferSteam', 'Préférer les visuels officiels Steam', 'Pour les jeux présents sur Steam ; sinon SteamGridDB passe en premier', cfg.sgdb.preferSteam);
    infoRow(s, 'Style préféré des jaquettes', 'Proposé en premier, automatiquement et dans « Parcourir »', segmented(
      [{ value: '', label: 'Tous' }, { value: 'alternate', label: 'Alternatif' }, { value: 'blurred', label: 'Flou' }, { value: 'white_logo', label: 'Logo blanc' }, { value: 'material', label: 'Material' }],
      cfg.sgdb.style, async v => { await api.post('/api/config', { sgdbStyle: v }); toast('Style enregistré'); }, 'sgstyle'));
    s.append(el('div', 'notice', 'Les visuels posés dans Steam par SGDBoop ou Steam ROM Manager (dossier <code>grid</code>) sont repris automatiquement.'));
    h2(s, 'i-gear', 'Avancé');
    actionRow(s, 'i-edit', 'Clé API personnelle (facultative)', cfg.sgdb.key ? `Utilisée (${esc(cfg.sgdb.hint)}) · passe par l’API officielle · A pour la remplacer` : 'Inutile au quotidien · utile seulement si l’accès public venait à changer', async () => {
      const key = await openKeyboard({ title: 'Clé API SteamGridDB (Ctrl+V pour coller)', placeholder: '32 caractères' });
      if (!key) return;
      busy('Vérification de la clé…');
      try { await api.post('/api/config', { sgdbKey: key.trim() }); toast('Clé SteamGridDB enregistrée'); await lib.load(); }
      catch (e) { toast(e.message, { error: true }); }
      finally { busy(null); }
      rerender('sgdb-key');
    }, 'sgdb-key');
    if (cfg.sgdb.key) {
      actionRow(s, 'i-trash', 'Retirer la clé', 'Revient à l’accès public, sans clé', async () => {
        if (!await confirmDialog('Retirer la clé SteamGridDB ?', 'Les visuels déjà choisis sont conservés.', 'Retirer', true)) return;
        await api.post('/api/config', { sgdbKey: null }); await lib.load(); rerender('sgdb-key');
      }, 'sgdb-del');
    }
  },

  async emulation(s) {
    h2(s, 'i-rom', 'Émulation');
    const d = await api.get('/api/emulation');
    const roms = lib.games.filter(g => g.source === 'rom' && !g.demo);
    infoRow(s, `${roms.length} ROM${roms.length > 1 ? 's' : ''} · ${d.emulators.filter(e => e.path).length} émulateur(s) détecté(s)`, `${d.romRoots.length} dossier(s) de ROMs · ${d.systems.filter(x => x.count).length} console(s)`);
    actionRow(s, 'i-rom', 'Gérer l’émulation', 'Dossiers de ROMs, émulateurs, consoles prises en charge', () => go('emulation'), 'open-emu');
  },

  async stream(s) {
    h2(s, 'i-wifi', 'Streaming');
    const d = await api.get('/api/stream').catch(() => null);
    if (!d || !d.engine) {
      infoRow(s, '<span class="dot-ko"></span>Moteur de streaming absent', 'L’app KaneMode l’embarque ; en développement : engine\\build-engine.ps1');
      return;
    }
    infoRow(s, `<span class="dot-ok"></span>Streaming intégré${d.dev ? ' (moteur compilé : engine\\out)' : ''}`, 'Jouez aux jeux de vos autres PC (Sunshine, Apollo, GeForce Experience) en plein écran');
    for (const h of d.hosts) {
      infoRow(s, `<span class="${h.paired ? 'dot-ok' : 'dot-ko'}"></span>${esc(h.name)}`, `${h.paired ? 'Appairé' : 'Non appairé'} · ${h.apps} application${h.apps > 1 ? 's' : ''}`);
    }
    actionRow(s, 'i-wifi', 'Ouvrir le streaming', 'PC trouvés automatiquement, appairage, bibliothèque de chaque PC, qualité, profils', openStreaming, 'open-stream');
    s.append(el('div', 'notice', 'Les jeux de vos PC appairés sont aussi dans la bibliothèque de KaneMode (onglet <b>KanePlay</b>) : <b>A</b> les lance directement. Pendant un jeu, <b>LB + RB + Select + Y</b> met la session en pause : le jeu reste ouvert sur le PC, <b>Reprendre</b> y retourne. Sur l’accueil du streaming, <b>B</b> revient à KaneMode.'));
  },
  async look(s) {
    h2(s, 'i-palette', 'Apparence');
    const sw = infoRow(s, 'Couleur d’accent', 'Boutons, curseurs et reflets');
    const swatches = el('div', 'swatches');
    for (const c of ACCENTS) {
      const d = el('div', 'swatch' + (settings.accent === c ? ' active' : ''), icon('i-check'));
      d.style.setProperty('--sw', c);
      swatches.append(nav(d, () => { settings.accent = c; saveSettings(); swatches.querySelectorAll('.swatch').forEach(x => x.classList.toggle('active', x === d)); }, 'accent:' + c));
    }
    sw.append(swatches);
    infoRow(s, 'Fond d’écran', 'Derrière les menus', segmented([{ value: 'art', label: 'Jaquette floue' }, { value: 'gradient', label: 'Dégradé animé' }, { value: 'dark', label: 'Uni' }], settings.background, v => { settings.background = v; saveSettings(); }, 'bg'));
    infoRow(s, 'Taille de l’interface', 'Pour un grand écran vu de loin, ou l’écran d’une console portable', scaleSeg('scale'));
    toggle(s, 'badges', 'Toujours afficher la boutique', 'Pastille de la boutique sur chaque jaquette de la bibliothèque');
    h2(s, 'i-home', 'Accueil');
    toggle(s, 'homeApps', 'Rangée « Applications »', 'Applis et raccourcis ajoutés');
    toggle(s, 'homeStores', 'Rangée « Boutiques et plateformes »', 'Lanceurs détectés et tuile Bureau');
    toggle(s, 'sounds', 'Sons de l’interface', 'Petits sons de navigation et de validation');
    toggle(s, 'notifications', 'Notifications', 'Nouveaux jeux détectés, ajouts, clés enregistrées…');
  },

  async boot(s) {
    h2(s, 'i-media', 'Démarrage');
    const cfg = await api.get('/api/config');
    const set = (k, v) => { settings[k] = v; saveSettings(); };
    infoRow(s, 'Animation', 'Au lancement de KaneMode · n’importe quel bouton la passe', segmented(
      [{ value: 'logo', label: 'Logo KaneMode' }, { value: 'video', label: 'Vidéo perso' }, { value: 'none', label: 'Aucune' }],
      settings.bootMode, v => {
        if (v === 'video' && !cfg.bootVideo) toast('Choisissez la vidéo plus bas (« Vidéo perso… »)');
        set('bootMode', v);
      }, 'boot-mode'));
    infoRow(s, 'Son', 'Court carillon joué avec le logo, façon console de salon', segmented(
      [{ value: 'chime', label: 'Carillon KaneMode' }, { value: 'custom', label: 'Son perso' }, { value: 'none', label: 'Aucun' }],
      settings.bootSound, v => {
        if (v === 'custom' && !cfg.bootSound) toast('Choisissez le son plus bas (« Son perso… »)');
        set('bootSound', v);
      }, 'boot-sound'));
    infoRow(s, 'Volume du son', 'Démarrage, mise en veille et réveil', segmented(
      [25, 50, 70, 100].map(v => ({ value: v, label: v + ' %' })), settings.bootVolume,
      v => { set('bootVolume', +v); chime('wake'); }, 'boot-vol'));
    actionRow(s, 'i-play', 'Tester le démarrage', 'Rejoue l’animation et le son choisis', () => playBoot({ force: true, mode: settings.bootMode === 'none' ? 'logo' : settings.bootMode }), 'boot-play');
    h2(s, 'i-folder', 'Personnaliser');
    actionRow(s, 'i-media', 'Vidéo perso…', cfg.bootVideo ? `Actuelle : ${esc(cfg.bootVideo)} · A pour en choisir une autre` : 'Un fichier .mp4 ou .webm sur vos disques (votre ancienne vidéo est dans extras\\ du dossier KaneMode)', async () => {
      const p = await pickFile('video', 'Choisir la vidéo de démarrage');
      if (!p) return;
      await api.post('/api/config', { bootVideo: p });
      set('bootMode', 'video');
      toast('Vidéo de démarrage enregistrée');
      rerender('boot-video');
    }, 'boot-video');
    if (cfg.bootVideo) actionRow(s, 'i-trash', 'Retirer la vidéo perso', 'Revient au logo KaneMode', async () => {
      await api.post('/api/config', { bootVideo: null });
      if (settings.bootMode === 'video') set('bootMode', 'logo');
      rerender('boot-video');
    }, 'boot-video-del');
    actionRow(s, 'i-music', 'Son perso…', cfg.bootSound ? `Actuel : ${esc(cfg.bootSound)} · A pour en choisir un autre` : 'Un fichier .mp3, .wav, .ogg ou .m4a, idéalement de 2 à 5 secondes', async () => {
      const p = await pickFile('audio', 'Choisir le son de démarrage');
      if (!p) return;
      await api.post('/api/config', { bootSound: p });
      set('bootSound', 'custom');
      toast('Son de démarrage enregistré');
      rerender('boot-sound-pick');
    }, 'boot-sound-pick');
    if (cfg.bootSound) actionRow(s, 'i-trash', 'Retirer le son perso', 'Revient au carillon KaneMode', async () => {
      await api.post('/api/config', { bootSound: null });
      if (settings.bootSound === 'custom') set('bootSound', 'chime');
      rerender('boot-sound-pick');
    }, 'boot-sound-del');
    toggle(s, 'splash', 'Logo pendant le chargement', 'Quand l’animation de démarrage est désactivée');
  },

  async pad(s) {
    h2(s, 'i-gamepad', 'Manette');
    infoRow(s, 'Symboles des boutons', 'Automatique : selon la manette utilisée', segmented([{ value: 'auto', label: 'Automatique' }, { value: 'xbox', label: 'Xbox' }, { value: 'ps', label: 'PlayStation' }], settings.padGlyphs, v => { settings.padGlyphs = v; saveSettings(); }, 'glyphs'));
    page.padName = infoRow(s, 'Aucune manette détectée', 'Appuyez sur un bouton de la manette pour la réveiller');
    const tester = el('div', 'set-row');
    tester.style.gridTemplateColumns = '1fr';
    page.buttons = el('div', 'tester', PAD_NAMES.map(n => `<span>${n}</span>`).join(''));
    page.sticks = el('div', 'sticks', '<div class="stick"><i></i></div>Stick gauche<div class="stick"><i></i></div>Stick droit');
    tester.append(el('div', 'txt', '<b>Testeur de boutons</b><small>Les boutons s’allument quand vous appuyez dessus</small>'), page.buttons, page.sticks);
    s.append(tester);
  },

  async access(s) {
    h2(s, 'i-info', 'Accessibilité');
    toggle(s, 'reduceMotion', 'Réduire les animations', 'Supprime les zooms, fondus et reflets');
    toggle(s, 'highContrast', 'Contraste élevé', 'Textes plus lisibles et contour jaune très visible autour de l’élément sélectionné');
    infoRow(s, 'Taille de l’interface', 'Aussi réglable dans Apparence', scaleSeg('scale2'));
  },

  async power(s) {
    h2(s, 'i-moon', 'Veille');
    actionRow(s, 'i-moon', 'Mettre en veille maintenant', native.available ? 'L’écran s’éteint en fondu ; au réveil, KaneMode revient là où vous étiez' : 'Simulée dans le navigateur : n’importe quel bouton réveille', () => sleepNow(), 'sleep-now');
    const mins = (list, key, never = 'Jamais') => segmented(list.map(v => ({ value: v, label: v ? `${v} min` : never })), settings[key], v => { settings[key] = +v; saveSettings(); }, key);
    infoRow(s, 'Atténuer l’écran après', 'Sans activité dans KaneMode · le moindre bouton le rallume', mins([0, 1, 2, 5, 10], 'dimAfter'));
    infoRow(s, 'Veille automatique sur batterie', 'Consoles portables et PC portables · jamais pendant un jeu', mins([0, 5, 10, 15, 30], 'sleepAfterBattery'));
    infoRow(s, 'Veille automatique sur secteur', 'PC branché ou console en charge', mins([0, 15, 30, 60], 'sleepAfterAC'));
    toggle(s, 'wakeAnimation', 'Animation de réveil', 'Logo KaneMode et carillon au retour de veille, puis vérification des manettes');
    const d = await device();
    if (d && d.ok) infoRow(s, d.modernStandby ? 'Veille moderne (S0)' : d.s3 ? 'Veille classique (S3)' : 'Veille indisponible',
      d.modernStandby ? 'Comme une console : le PC s’endort et se réveille en une seconde, les téléchargements peuvent continuer.'
        : d.s3 ? 'Le PC s’endort entièrement ; la manette ou le clavier peuvent le réveiller selon le BIOS.' : 'Ce PC ne propose pas de veille (voir les options d’alimentation).');
    actionRow(s, 'i-open', 'Options d’alimentation de Windows', 'Bouton d’alimentation, écran, veille du système', () => openWin('power'), 'win-power');
    s.append(el('div', 'notice', 'Comme sur SteamOS, <b>Mettre en veille</b> agit tout de suite, sans confirmation. Réglez le <b>bouton d’alimentation</b> de la console sur « Veille » dans les options d’alimentation de Windows pour retrouver le même geste.'));
  },

  async device(s) {
    h2(s, 'i-battery', 'Console portable');
    const d = await device(true);
    if (!d || !d.ok) { s.append(el('div', 'notice', 'Impossible de décrire cet appareil.')); return; }
    const hh = d.handheld;
    const bat = d.battery ? ` · batterie ${d.battery.percent} %${d.battery.charging ? ' (en charge)' : ''}` : '';
    infoRow(s, hh ? `<span class="dot-ok"></span>${esc(hh.name)} détectée${d.simulated ? ' (simulation)' : ''}` : '<span class="dot-ko"></span>Pas une console portable',
      `${esc(d.manufacturer)} ${esc(d.model)}${d.family && d.family !== d.model ? ` (${esc(d.family)})` : ''} · ${esc(d.cpu)} · ${d.memoryGb} Go${d.screenInches ? ` · écran ${d.screenInches}″` : ''}${bat}`);
    if (settings.demo || d.simulated) {
      infoRow(s, 'Simuler une console', 'Démo : pour voir ces réglages sur un PC de bureau', segmented(
        [{ value: '', label: 'Non' }, { value: 'rog-ally', label: 'ROG Ally' }, { value: 'legion-go', label: 'Legion Go' }, { value: 'steam-deck', label: 'Steam Deck' }],
        settings.simulateDevice || '', v => { settings.simulateDevice = v; saveSettings(); rerender('simulateDevice-' + v); }, 'simulateDevice'));
    }
    if (hh) {
      const tool = hh.tool;
      if (tool && tool.app) actionRow(s, 'i-open', `Ouvrir ${esc(tool.name)}`, 'Mises à jour du BIOS et des pilotes, performances (TDP), boutons, éclairage', () => openDevice(tool.app.target), 'hh-tool');
      else if (tool) actionRow(s, 'i-globe', `Installer ${esc(tool.name)}`, `Logiciel ${esc(hh.maker)} absent · ouvre la page d’assistance officielle`, () => openDevice(hh.support), 'hh-tool');
      if (hh.support && tool && tool.app) actionRow(s, 'i-globe', `Assistance ${esc(hh.maker)}`, 'BIOS, pilotes et manuels sur le site officiel', () => openDevice(hh.support), 'hh-support');
      actionRow(s, 'i-grid', 'Adapter l’interface à cet écran', `Textes et jaquettes plus grands pour un écran de ${d.screenInches || 7}″ tenu en main`, () => {
        settings.uiScale = 125; settings.badges = false; saveSettings(); toast('Interface adaptée à la console');
      }, 'hh-scale');
    }

    h2(s, 'i-download2', 'Pilotes');
    for (const g of d.gpus) {
      const old = g.ageDays != null && g.ageDays > 180;
      const age = g.ageDays == null ? '' : g.ageDays < 45 ? ' · récent' : ` · il y a ${g.ageDays < 365 ? Math.round(g.ageDays / 30) + ' mois' : Math.floor(g.ageDays / 365) + ' an' + (g.ageDays >= 730 ? 's' : '')}`;
      const desc = `Pilote ${esc(g.driver || '?')}${g.date ? ` du ${new Date(g.date).toLocaleDateString('fr-FR')}` : ''}${age}${old ? ' · une mise à jour est probablement disponible' : ''}`;
      if (g.tool && g.tool.app) actionRow(s, 'i-open', `${esc(g.name)} · ouvrir ${esc(g.tool.name)}`, desc, () => openDevice(g.tool.app.target), 'gpu:' + g.name);
      else if (g.page) actionRow(s, 'i-globe', `${esc(g.name)} · pilotes ${esc(g.maker)}`, desc + ' · ouvre la page officielle', () => openDevice(g.page), 'gpu:' + g.name);
      else infoRow(s, esc(g.name), desc);
    }
    if (hh && d.gpus.some(g => g.vendor === '1002')) s.append(el('div', 'notice', `Sur une ${esc(hh.name)}, préférez les pilotes graphiques proposés par ${esc(hh.maker)} (${esc(hh.tool ? hh.tool.name : 'site officiel')}) : ils sont réglés pour la console (consommation, écran, boutons).`));
    await driversBlock(s);
  },

  async storage(s) {
    h2(s, 'i-drive', 'Stockage');
    const drives = await api.get('/api/storage');
    for (const d of drives) {
      const games = d.games.reduce((a, g) => a + g.size, 0);
      const used = d.total - d.free;
      s.append(el('div', 'drive', `<div class="drive-head"><b>Disque ${d.letter}</b><small>${fmt.gb(d.free)} libres sur ${fmt.gb(d.total)}</small></div>
        <div class="drive-bar"><i class="games" style="width:${(100 * games / d.total).toFixed(2)}%"></i><i class="other" style="width:${(100 * Math.max(0, used - games) / d.total).toFixed(2)}%"></i></div>
        <div class="legend"><span style="--c:var(--accent)">Jeux ${fmt.gb(games)}</span><span style="--c:rgba(255,255,255,.28)">Autres ${fmt.gb(Math.max(0, used - games))}</span><span style="--c:rgba(255,255,255,.08)">Libre ${fmt.gb(d.free)}</span></div>`));
      for (const g of d.games.slice(0, 8)) {
        const e = lib.byId(g.id);
        const r = el('div', 'set-row nav', `<div class="txt"><b>${esc(g.name)}</b><small>${fmt.size(g.size)}</small></div><span></span>`);
        r.style.gridTemplateColumns = '1fr auto';
        s.append(e ? nav(r, () => openGame(e), 'store:' + g.id) : r);
      }
    }
  },

  async xbox(s) {
    h2(s, 'i-desktop', 'Mode Xbox (plein écran)');
    const x = await api.get('/api/xboxmode');
    infoRow(s, x.enabled ? '<span class="dot-ok"></span>Mode Xbox activé' : '<span class="dot-ko"></span>Mode Xbox non activé',
      `Windows ${esc(x.windows)} · ${x.compatible ? (x.native ? 'build compatible (native)' : 'build compatible (ancienne méthode)') : 'build non compatible : mettez Windows à jour'}`);
    infoRow(s, 'XboxFullScreenExperienceTool', x.toolInstalled ? `Installé : ${esc(x.toolPath)}` : 'Non installé');
    infoRow(s, 'Activation silencieuse (/silentenable)', x.enabler ? 'Compilée et prête (setup\\bin\\xfset)' : 'Pas encore compilée : setup\\build-xbox-enabler.ps1');
    infoRow(s, native.available ? '<span class="dot-ok"></span>App native KaneMode' : '<span class="dot-ko"></span>Version navigateur (prototype)',
      native.available ? 'Déclarée à Windows comme application de jeu : elle peut devenir l’application d’accueil du mode Xbox.'
        : 'Seule l’app native peut devenir l’application d’accueil : native\\build.ps1 -Register');
    actionRow(s, 'i-open', 'Ouvrir les réglages du mode Xbox', 'Paramètres Windows > Jeux > Mode Xbox : choisissez KaneMode comme application d’accueil', async () => {
      openWin('xbox');
    }, 'open-xbox-settings');
    s.append(el('div', 'notice', `Le mode Xbox complet (celui qui permet de choisir l’application d’accueil) s’active avec <code>setup\\install.ps1</code>. Sur ce PC, ${x.enabled ? 'c’est déjà fait' : 'lancez-le en administrateur'}. Ensuite : réglages du mode Xbox → <b>Choisir l’application d’accueil</b> → <b>KaneMode</b>, et « Entrer en mode Xbox au démarrage ». Pour tout annuler : <code>setup\\uninstall.ps1 -RevertXboxMode</code>.`));
  },

  async system(s) {
    h2(s, 'i-cpu', 'Système');
    const x = await api.get('/api/system').catch(() => null);
    const grid = el('div', 'sysgrid');
    if (x) {
      const cell = (k, v) => `<div><small>${k}</small><b>${esc(v)}</b></div>`;
      grid.innerHTML = cell('Processeur', `${x.cpuName.trim()} (${x.cores} cœurs)`) + cell('Mémoire', `${fmt.gb(x.memUsed)} / ${fmt.gb(x.memTotal)}`)
        + cell('Système', x.os) + cell('Allumé depuis', fmt.duration(x.uptime)) + cell('Hôte', `Node ${x.node}`) + cell('Données', x.dataDir);
    }
    s.append(grid);
    await updatesBlock(s);
    h2(s, 'i-cpu', 'Interface');
    actionRow(s, 'i-restart', 'Redémarrer l’interface', 'Recharge KaneMode sans quitter', () => location.reload(), 'reload');
    actionRow(s, 'i-exit', 'Quitter vers le bureau Windows', 'Ferme KaneMode', exitToDesktop, 'exit');
  },
};

page = definePage('settings', {
  libBound: true,
  title: () => 'Paramètres',
  render(p = {}) {
    const section = p.section || SECTION_OF[p.focus] || this.section || 'library';
    this.show(section, p.focus);
  },
  async show(section, focus) {
    this.section = section;
    cancelAnimationFrame(this.raf);
    const root = this.el;
    const wrap = el('div', 'settings-wrap');
    const side = el('div', 'settings-nav');
    for (const [id, iconId, label] of SECTIONS) {
      const it = el('div', 'menu-item' + (id === section ? ' current' : ''), `${icon(iconId)}${label}`);
      side.append(nav(it, () => this.show(id, 'sec:' + id), 'sec:' + id));
    }
    const s = el('div', 'settings');
    wrap.append(side, s);
    root.replaceChildren(el('div', 'page-head', '<h1>Paramètres</h1>'), wrap);
    focusIn(root, focus && focus.startsWith('sec:') ? focus : 'sec:' + section, { scroll: false });
    try { await BUILDERS[section](s); }
    catch (e) { s.append(el('div', 'notice', `Impossible de charger cette section : ${esc(e.message)}`)); }
    if (focus && !focus.startsWith('sec:')) focusIn(root, focus);
    if (section === 'pad') this.live();
  },
  live() {
    const tick = () => {
      if (!this.el.classList.contains('active') || this.section !== 'pad') return;
      if (padLive.connected) {
        this.padName.innerHTML = `<div class="txt"><b>${esc(padLive.id.replace(/\(.*?\)/g, '').trim() || 'Manette')}</b><small>${padLive.connected} manette${padLive.connected > 1 ? 's' : ''} connectée${padLive.connected > 1 ? 's' : ''} · ${/054c/i.test(padLive.id) ? 'PlayStation' : 'Xbox / standard'}</small></div>`;
      }
      [...this.buttons.children].forEach((b, i) => b.classList.toggle('on', !!padLive.buttons[i]));
      const [lx, ly, rx, ry] = padLive.axes;
      const dots = this.sticks.querySelectorAll('i');
      dots[0].style.transform = `translate(${lx * 27}px, ${ly * 27}px)`;
      dots[1].style.transform = `translate(${rx * 27}px, ${ry * 27}px)`;
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  },
  leave() { cancelAnimationFrame(this.raf); },
  hints: () => [['a', 'Modifier'], ['b', 'Retour']],
});
