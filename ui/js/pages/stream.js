// Streaming intégré : PC hôtes (Sunshine, Apollo, GeForce Experience), appairage avec un code
// affiché ici, applications de chaque PC, qualité, arrêt du jeu sur l'hôte. Le moteur (KanePlay)
// reste invisible : seule l'image du jeu s'affiche, en plein écran.
import { el, esc, icon, api, lib, toast, busy } from '../core.js';
import { definePage, nav, focusIn, closeLayer, topLayer } from '../nav.js';
import { dialog, openKeyboard, segmented, switchRow } from '../widgets.js';
import { gameCard } from '../cards.js';
import { openGame } from './game.js';

/** Appairage d'un PC : le code s'affiche dans KaneMode, à saisir sur le PC hôte. */
export async function pairHost(host, label = host) {
  let r;
  try { r = await api.post('/api/stream/pair', { host }); }
  catch (e) { return toast(e.message, { error: true }); }
  let timer = 0;
  const shown = dialog({
    title: `Appairer ${label}`,
    text: `<span class="pair-pin">${esc(r.pin)}</span>
      Sur <b>${esc(label)}</b>, ouvrez <b>Sunshine</b> (page Web <code>https://localhost:47990</code> → <b>PIN</b>) ou <b>Apollo</b>, et saisissez ce code.
      <span class="pair-status" id="pair-status"><i class="spinner"></i>En attente du code sur le PC hôte…</span>`,
    buttons: [{ label: 'Fermer', value: 'close' }],
  });
  timer = setInterval(async () => {
    const s = await api.get('/api/stream').catch(() => null);
    const p = s && s.pairing;
    if (!p || !p.done) return;
    clearInterval(timer);
    const status = document.getElementById('pair-status');
    if (p.ok) {
      toast(`${label} appairé · ses jeux arrivent dans la bibliothèque`, { notify: true });
      await lib.load();
      const L = topLayer();
      if (L && L.name === 'dialog') closeLayer(L, 'ok');
    } else if (status) {
      status.innerHTML = `<span style="color:#ff9a9d">${esc(p.error || 'Échec de l’appairage')}</span>`;
    }
  }, 1500);
  await shown;
  clearInterval(timer);
}

const RES = [['auto', 'Écran'], ['720', '720p'], ['1080', '1080p'], ['1440', '1440p'], ['4K', '4K']];
const FPS = [['auto', 'Écran'], [30, '30'], [60, '60'], [90, '90'], [120, '120']];
const BITRATE = [[0, 'Auto'], [10000, '10'], [20000, '20'], [40000, '40'], [80000, '80']];
const CODEC = [['auto', 'Auto'], ['h264', 'H.264'], ['hevc', 'HEVC'], ['av1', 'AV1']];

definePage('stream', {
  libBound: true,
  title: () => 'Streaming',
  render(p = {}) {
    if (!this.data) this.el.innerHTML = '<div class="loading"><i class="spinner big"></i>Recherche de vos PC…</div>';
    this.load(p.focus);
  },
  async load(focus, refresh = false) {
    try { this.data = await api.get('/api/stream' + (refresh ? '?refresh=1' : '')); }
    catch (e) { return toast(e.message, { error: true }); }
    if (this.el.classList.contains('active')) this.draw(focus);
  },
  draw(focusKey) {
    const d = this.data;
    const root = this.el;
    const out = [el('div', 'page-head', '<h1>Streaming</h1><p>Jouez aux jeux de vos autres PC, en plein écran, sans quitter KaneMode</p>')];
    if (!d.engine) {
      out.push(el('div', 'notice', 'Le moteur de streaming n’est pas présent. L’app KaneMode l’embarque ; en développement, compilez-le une fois avec <code>engine\\build-engine.ps1</code>.'));
      root.replaceChildren(...out);
      return focusIn(root, focusKey);
    }

    for (const h of d.hosts) {
      const pills = `<span class="pill ${h.online ? 'ok' : 'off'}">${h.online ? 'En ligne' : 'Hors ligne'}</span>${h.paired ? '' : '<span class="pill warn">Non appairé</span>'}`;
      out.push(el('h2', 'row-title', `${icon('i-desktop').replace('<svg', '<svg class="row-ico"')}${esc(h.name)} ${pills}<small>${esc(h.address || '')}</small>`));
      const acts = el('div', 'art-actions');
      if (!h.paired) {
        acts.append(nav(el('div', 'chip-btn big primary', `${icon('i-link')}Appairer ce PC`), () => this.pair(h.uuid, h.name), 'pair:' + h.uuid));
      } else {
        acts.append(
          nav(el('div', 'chip-btn', `${icon('i-refresh')}Actualiser les applis`), () => this.refreshApps(h), 'apps:' + h.uuid),
          nav(el('div', 'chip-btn', `${icon('i-power')}Quitter le jeu en cours`), () => this.quit(h), 'quit:' + h.uuid),
        );
      }
      out.push(acts);
      const games = h.apps.map(id => lib.byId(id)).filter(Boolean);
      if (h.paired && games.length) {
        const row = el('div', 'row');
        games.forEach(g => row.append(gameCard(g, 'capsule', openGame)));
        out.push(row);
      } else if (h.paired) {
        out.push(el('div', 'notice', 'Aucune application connue pour ce PC. <b>Actualiser les applis</b> quand il est allumé.'));
      } else {
        out.push(el('div', 'notice', 'Appairez ce PC une fois pour pouvoir y jouer : KaneMode affiche un code à 4 chiffres à saisir sur le PC hôte.'));
      }
    }
    const add = el('div', 'art-actions');
    add.append(
      nav(el('div', 'chip-btn big' + (d.hosts.length ? '' : ' primary'), `${icon('i-plus')}Ajouter un PC`), () => this.addHost(), 'add-host'),
      nav(el('div', 'chip-btn big', `${icon('i-refresh')}Actualiser`), () => this.load('refresh', true), 'refresh'),
    );
    if (!d.hosts.length) out.push(el('div', 'notice', 'Aucun PC hôte pour l’instant. Installez <b>Sunshine</b> (ou Apollo) sur le PC où sont vos jeux, puis <b>Ajouter un PC</b> avec son nom ou son adresse IP.'));
    out.push(add);

    // Qualité : envoyée au moteur à chaque session
    const q = el('div', 'settings stream-quality');
    q.append(el('h2', '', `${icon('i-gear')}Qualité du streaming`));
    const pr = d.prefs;
    const set = async (k, v) => {
      try { this.data.prefs = (await api.post('/api/stream/prefs', { [k]: v })).prefs; }
      catch (e) { toast(e.message, { error: true }); }
    };
    const seg = (title, desc, list, k, conv = x => x) => {
      const r = el('div', 'set-row', `<div class="txt"><b>${title}</b><small>${desc}</small></div>`);
      r.style.gridTemplateColumns = '1fr auto';
      r.append(segmented(list.map(([value, label]) => ({ value, label })), pr[k], v => set(k, conv(v)), 'q-' + k));
      q.append(r);
    };
    seg('Résolution', '« Écran » : celle de cet appareil', RES, 'resolution');
    seg('Images par seconde', '« Écran » : la fréquence de cet appareil', FPS, 'fps', v => (v === 'auto' ? v : +v));
    seg('Débit vidéo (Mb/s)', 'Plus haut : plus net, mais exige un meilleur réseau', BITRATE, 'bitrate', v => +v);
    seg('Codec vidéo', 'AV1 et HEVC : meilleure image à débit égal, si les deux PC les gèrent', CODEC, 'codec');
    for (const [k, title, desc] of [
      ['hdr', 'HDR', 'Si l’écran et le jeu le permettent'],
      ['overlay', 'Statistiques à l’écran', 'Débit, latence, images perdues'],
      ['audioOnHost', 'Son sur le PC hôte', 'Le son reste sur l’autre PC au lieu d’arriver ici'],
      ['quitAfter', 'Fermer le jeu en fin de session', 'Sinon il reste ouvert sur l’hôte, prêt à reprendre'],
    ]) q.append(switchRow({ title, desc, on: pr[k], key: 'q-' + k, onToggle: v => set(k, v) }));
    q.append(el('div', 'notice', 'Pendant le jeu : <b>Select + Start + LB + RB</b> (ou Ctrl+Alt+Maj+Q) quitte le streaming et revient à KaneMode.'));
    out.push(q);

    root.replaceChildren(...out);
    focusIn(root, focusKey);
  },
  async pair(host, label) {
    await pairHost(host, label);
    this.load('pair:' + host, true);
  },
  async addHost() {
    const host = await openKeyboard({ title: 'Nom ou adresse IP du PC hôte', placeholder: 'ex. 192.168.1.20 ou MON-PC' });
    if (!host || !host.trim()) return;
    await pairHost(host.trim());
    this.load('add-host', true);
  },
  async refreshApps(h) {
    busy(`Applications de ${h.name}…`);
    try {
      const r = await api.post('/api/stream/apps', { uuid: h.uuid });
      await lib.load();
      toast(r.ok ? 'Applications à jour' : r.error, { error: !r.ok });
    } catch (e) { toast(e.message, { error: true }); }
    finally { busy(null); }
    this.load('apps:' + h.uuid);
  },
  async quit(h) {
    busy(`Fermeture du jeu sur ${h.name}…`);
    try {
      const r = await api.post('/api/stream/quit', { uuid: h.uuid });
      toast(r.ok ? 'Jeu fermé sur le PC hôte' : r.error, { error: !r.ok });
    } catch (e) { toast(e.message, { error: true }); }
    finally { busy(null); }
  },
  hints: () => [['a', 'Choisir'], ['b', 'Retour']],
});
