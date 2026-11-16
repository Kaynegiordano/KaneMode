// HDR automatique : Windows passe en HDR pendant un jeu (ou une vidéo) et revient en SDR ensuite.
// KaneMode ne coupe que le HDR qu'il a lui-même activé : un HDR déjà allumé par l'utilisateur reste.
// Les choix sont dans config.autoHdr ; un jeu peut forcer « toujours » ou « jamais » (config.gameHdr).
'use strict';

// Lecteurs vidéo reconnus (nom du programme, en minuscules) et OBS
const PLAYERS = ['vlc.exe', 'mpc-hc64.exe', 'mpc-hc.exe', 'mpc-be64.exe', 'mpc-be.exe', 'potplayermini64.exe', 'potplayermini.exe', 'potplayer64.exe', 'mpv.exe', 'mpvnet.exe'];
const OBS = ['obs64.exe', 'obs32.exe'];
// noEmulation : jeux émulés, portages PC et émulateurs jamais en HDR (sauf choix « HDR du jeu »)
const DEFAULTS = { games: true, outside: false, videos: false, obs: true, noEmulation: true };
const GAME_MODES = ['on', 'off'];
// Jeu lancé dont aucun programme n'est apparu dans son dossier : HDR rendu après ce délai (lanceur
// qui ne démarre pas le jeu, mise à jour, connexion refusée…)
const LAUNCH_GRACE = 3 * 60e3;

const base = p => String(p).split('\\').pop().toLowerCase();
const norm = d => String(d || '').replace(/[\\/]+$/, '').toLowerCase();

function prefs(config) { return { ...DEFAULTS, ...(config.autoHdr || {}) }; }

// Émulateurs reconnus à leur nom dans la bibliothèque (RetroArch de Steam, Dolphin ajouté à la main…)
const EMU_NAME = /\b(retroarch|pcsx2|duckstation|ppsspp|cemu|rpcs3|ryujinx|yuzu|citra|azahar|xemu|xenia|flycast|melonds|shadps4|vita3k|lichii|eglantine|eden emulator|dolphin emulator)\b|\b[ée]mulat/i;
/**
 * Test « touche à l'émulation » : jeu de l'émulation (ROM ou portage PC), ou entrée qui lance un
 * émulateur (programme reconnu par exes, des expressions sur le nom du fichier, ou nom de l'entrée).
 */
function emulationTest(exes = []) {
  return e => {
    if (!e) return false;
    if (e.source === 'rom') return true;
    const target = e.launch && e.launch.kind === 'exe' ? String(e.launch.target || '').split(/[\\/]/).pop() : '';
    if (target && exes.some(re => re.test(target))) return true;
    return EMU_NAME.test(String(e.name || ''));
  };
}

/**
 * read/write : configuration ; hdr() : -1 sans écran HDR, 0 coupé, 1 actif ; setHdr(on) ;
 * paths() : chemins des programmes ouverts ; games() : jeux de la bibliothèque [{ id, name, dir }] ;
 * log(message).
 */
function create({ read, write, hdr, setHdr, paths, games, isEmulation = emulationTest(), log = () => {}, now = Date.now }) {
  const reasons = new Map(); // cause → libellé (journal)
  const launched = new Map(); // id → { dir, at, seen } : jeux lancés par KaneMode, suivis par leur dossier
  let owned = !!read().autoHdrOwned; // KaneMode a allumé le HDR (gardé si l'hôte redémarre)
  let blocked = false, pending = Promise.resolve();
  const serial = work => (pending = pending.catch(() => {}).then(work));

  const setOwned = v => {
    owned = v;
    const c = read();
    if (v) c.autoHdrOwned = true; else delete c.autoHdrOwned;
    write(c);
  };
  const gameMode = id => (read().gameHdr || {})[id] || null;

  /** Allume ou coupe selon les causes en cours. */
  const apply = () => serial(async () => {
    const want = reasons.size > 0 && !blocked;
    if (want === owned) return;
    const st = await hdr();
    if (want) {
      if (st !== 0) return; // pas d'écran HDR, ou HDR déjà allumé par l'utilisateur : rien à rendre ensuite
      await setHdr(true);
      setOwned(true);
      log(`HDR activé (${[...reasons.values()].join(', ')})`);
    } else {
      if (st === 1) await setHdr(false);
      setOwned(false);
      log(blocked && reasons.size ? 'HDR coupé (OBS ouvert)' : 'HDR coupé (plus de jeu ni de vidéo)');
    }
  });

  return {
    prefs: () => prefs(read()),
    /** Jeu lancé par KaneMode (route /api/launch). */
    started(entry) {
      if (!entry || entry.source === 'kaneplay' || entry.streamHost || String(entry.id).startsWith('launcher:')) return;
      // Un seul jeu lancé par KaneMode à la fois : celui d'avant (qui n'a peut-être jamais démarré,
      // donc jamais « fermé ») ne garde plus le HDR
      let dropped = false;
      for (const k of [...reasons.keys()]) if (k.startsWith('game:') && k !== 'game:' + entry.id) { reasons.delete(k); launched.delete(k.slice(5)); dropped = true; }
      const p = prefs(read());
      const mode = gameMode(entry.id);
      // Émulation exclue : seul un « Toujours » choisi pour ce jeu passe outre
      if (p.noEmulation && mode !== 'on' && isEmulation(entry)) return;
      const auto = p.games && entry.type !== 'app';
      if (mode === 'off' || (mode !== 'on' && !auto)) return dropped ? apply() : undefined;
      reasons.set('game:' + entry.id, entry.name || entry.id);
      launched.set(entry.id, { dir: ownDir(entry.dir), at: now(), seen: false });
      return apply();
    },
    /** Jeu fermé (route /api/launch/ended). */
    ended(id) {
      launched.delete(id);
      if (!reasons.delete('game:' + id)) return;
      return apply();
    },
    /** Faut-il regarder les programmes ouverts ? */
    needsPoll() {
      const p = prefs(read());
      return p.outside || p.videos || owned || (p.obs && reasons.size > 0);
    },
    /** Programmes ouverts : jeux lancés ailleurs, lecteurs vidéo, OBS. */
    poll: async () => {
      const p = prefs(read());
      const list = (await paths()).map(x => String(x).toLowerCase());
      const names = new Set(list.map(base));
      // Jeux de la bibliothèque ouverts hors de KaneMode
      const seen = new Set();
      for (const g of await games()) {
        const mode = gameMode(g.id);
        if (mode === 'off' || (mode !== 'on' && (!p.outside || (p.noEmulation && g.emulation)))) continue;
        const d = norm(g.dir);
        if (d && list.some(x => x.startsWith(d + '\\'))) { seen.add('outside:' + g.id); reasons.set('outside:' + g.id, g.name); }
      }
      for (const k of [...reasons.keys()]) if (k.startsWith('outside:') && !seen.has(k)) reasons.delete(k);
      // Jeux lancés par KaneMode : HDR rendu quand plus rien ne tourne dans leur dossier (fermé sans que
      // KaneMode le voie), ou s'il n'y a jamais rien eu après LAUNCH_GRACE (jeu qui n'a pas démarré)
      for (const [id, g] of launched) {
        if (!g.dir) continue;
        if (list.some(x => x.startsWith(g.dir + '\\'))) { g.seen = true; continue; }
        if (g.seen || now() - g.at > LAUNCH_GRACE) {
          launched.delete(id);
          if (reasons.delete('game:' + id)) log(`HDR : ${g.seen ? 'jeu fermé' : 'jeu jamais démarré'} (${id})`);
        }
      }
      const player = p.videos && PLAYERS.find(n => names.has(n));
      if (player) reasons.set('video', player); else reasons.delete('video');
      blocked = p.obs && OBS.some(n => names.has(n));
      // HDR allumé avant un redémarrage de l'hôte et plus rien d'ouvert : on le rend
      return apply();
    },
    state: () => ({ owned, blocked, active: [...reasons.values()] }),
  };
}

/** Dossier propre à un jeu (normalisé), ou null : au moins trois niveaux (C:\Jeux\Nom), pas une bibliothèque entière. */
function ownDir(dir) {
  const d = norm(dir);
  return !d || d.split('\\').filter(Boolean).length < 3 || /\\(steamapps\\common|epic games|gog galaxy\\games|xboxgames)$/.test(d) ? null : d;
}

/** Jeux dont on peut reconnaître les programmes : dossier propre au jeu, jamais un dossier trop général. */
function trackable(entries) {
  const out = [];
  for (const e of entries) {
    if (e.type !== 'game' || e.installed === false || e.demo || e.source === 'kaneplay' || e.streamHost || e.source === 'rom') continue;
    if (!ownDir(e.dir)) continue;
    out.push({ id: e.id, name: e.name, dir: e.dir, emulation: !!e.emulation });
  }
  return out;
}

module.exports = { create, prefs, trackable, emulationTest, DEFAULTS, GAME_MODES, PLAYERS, OBS };
