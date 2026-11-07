// Hôte du prototype KaneMode : sert l'interface et expose l'API que l'app native
// (WinUI 3 + WebView2) reproduira plus tard. Sans dépendance : node host/server.js
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const steam = require('./lib/steam');
const sgdb = require('./lib/sgdb');
const emu = require('./lib/emulation');
const emuStoreLib = require('./lib/emu-store');
const emuSetup = require('./lib/emu-setup');
const emuMetaLib = require('./lib/emu-meta');
const nintendoLib = require('./lib/nintendo-art');
const emuMods = require('./lib/emu-mods');
const emuPresets = require('./lib/emu-presets');
const sys = require('./lib/system');
const device = require('./lib/device');
const kaneplay = require('./lib/kaneplay');
const update = require('./lib/update');
const syscontrol = require('./lib/syscontrol');
const oem = require('./lib/oem');
const gpuctl = require('./lib/gpuctl');
const dealsLib = require('./lib/deals');
const gpuLib = require('./lib/gpudrivers');
const dolbyLib = require('./lib/dolby');
const { createPathWatch } = require('./lib/pathwatch');
const launchLib = require('./lib/launch');
const libraryRemoval = require('./lib/library-removal');
const accountsLib = require('./lib/accounts');
const powerLib = require('./lib/power-profiles');
const autoHdrLib = require('./lib/autohdr');
const wifi = require('./lib/wifi');
const weatherLib = require('./lib/weather');
const hostScaleLib = require('./lib/hostscale');

const PORT = +process.env.PORT || 5173;
const ROOT = path.join(__dirname, '..');
const UI = path.join(ROOT, 'ui');
// L'app native (dossier d'installation en lecture seule) fournit un dossier de données inscriptible.
const DATA = process.env.KANEMODE_DATA || path.join(ROOT, 'data');
const FILES = {
  library: path.join(DATA, 'library.json'), custom: path.join(DATA, 'custom.json'), state: path.join(DATA, 'state.json'),
  programs: path.join(DATA, 'programs.json'), meta: path.join(DATA, 'meta.json'), config: path.join(DATA, 'config.json'),
  roms: path.join(DATA, 'roms.json'), sgdb: path.join(DATA, 'sgdb.json'),
};
const ICONS = path.join(DATA, 'icons');
const ARTCACHE = path.join(DATA, 'artcache');
const ART = path.join(DATA, 'art');
const EDGE_PROFILE = path.join(DATA, 'edge-profile');
for (const d of [DATA, ICONS, ARTCACHE, ART]) fs.mkdirSync(d, { recursive: true });

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.opus': 'audio/ogg', '.flac': 'audio/flac',
};
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];
const RUN_EXT = ['.exe', '.lnk', '.bat', '.cmd', '.url'];
const ART_KINDS = ['portrait', 'hero', 'logo', 'header', 'icon'];

// ---------------------------------------------------------------- utilitaires
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return d; } };
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));
const str = v => (typeof v === 'string' && v ? v : null); // PowerShell sérialise parfois « rien » en {}
const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const safeId = id => String(id).replace(/[^\w.-]+/g, '_');
const isImage = p => !!str(p) && IMAGE_EXT.includes(path.extname(p).toLowerCase()) && isFile(p);

const VIDEO_EXT = ['.mp4', '.webm'];
const AUDIO_EXT = ['.mp3', '.wav', '.ogg', '.m4a', '.opus', '.flac'];
const config = () => {
  const cfg = Object.assign({ updateChannel: 'stable', updateAuto: true, bootVideo: null, bootSound: null, sgdbKey: null, sgdbAuto: true, sgdbPreferSteam: true, sgdbStyle: '', romRoots: [], emulatorPaths: {}, emulatorPrefs: {} }, readJson(FILES.config, {}));
  if (cfg.lang && !['fr', 'en'].includes(cfg.lang)) delete cfg.lang;
  return cfg;
};
const state = () => Object.assign({ played: {}, overrides: {}, artOverrides: {}, collections: [] }, readJson(FILES.state, {}));

function runPs(script, args = []) {
  return new Promise(resolve => {
    const p = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, script), ...args], { windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => resolve({ code, out: out.trim(), err: err.trim() }));
    p.on('error', e => resolve({ code: -1, out: '', err: e.message }));
  });
}

const decodeEntities = s => String(s || '').replace(/<[^>]+>/g, '')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();
const normName = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[™®©]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim();

// ---------------------------------------------------------------- bibliothèque de démonstration
// Entrées fictives, clairement marquées « démo », pour visualiser une bibliothèque multi-boutiques.
const DEMO = [
  ['epic', 'Alan Wake 2'], ['epic', 'Hades II'], ['gog', 'The Witcher 3: Wild Hunt'], ['gog', 'Cyberpunk 2077'],
  ['ubisoft', "Assassin's Creed Mirage"], ['ea', 'Mass Effect Legendary Edition'], ['battlenet', 'Diablo IV'],
  ['xbox', 'Forza Horizon 5'], ['xbox', 'Hellblade II'], ['amazon', 'Fallout 76'], ['rockstar', 'Red Dead Redemption 2'],
  ['riot', 'VALORANT'], ['custom', 'Dolphin'], ['custom', 'Netflix'],
  ['rom', 'Super Mario World', 'snes', 'Super Nintendo'], ['rom', 'The Legend of Zelda: Ocarina of Time', 'n64', 'Nintendo 64'],
  ['rom', 'Metroid Prime', 'gc', 'GameCube'], ['rom', 'Crash Bandicoot', 'psx', 'PlayStation'], ['rom', 'Sonic the Hedgehog 2', 'megadrive', 'Mega Drive'],
].map(([source, name, system, systemName], i) => ({
  id: `demo:${normName(name).replace(/ /g, '-')}`, source, name, demo: true, system: system || null, systemName: systemName || null,
  emulator: system ? 'RetroArch' : null,
  type: ['Dolphin', 'Netflix'].includes(name) ? 'app' : 'game', installed: i % 5 !== 3,
  lastPlayed: i < 5 ? Math.floor(Date.now() / 1000) - (i + 1) * 86400 * 2 : 0, playtime: i < 8 ? (i + 1) * 317 : 0,
  sizeOnDisk: system ? 8e6 * (i + 1) : [48, 22, 51, 70, 38, 120, 90, 110, 64, 75, 120, 38, 0.1, 0.2][i] * 1e9,
  launch: null, art: {},
}));

// ---------------------------------------------------------------- métadonnées (boutique Steam publique)
let meta = readJson(FILES.meta, {});
let version = 1;
const SOFTWARE_GENRES = new Set(['51', '52', '53', '54', '55', '56', '57', '58', '59', '60']);
const queue = [];
let busy = false;

// Langue des données de Steam (genres, descriptions) : celle de l'interface ; prix toujours pour la France
const STEAM_LANG = { fr: 'french', en: 'english' };
const steamLang = () => STEAM_LANG[config().lang] || 'french';
async function steamJson(url) {
  const r = await fetch(url, { headers: { 'Accept-Language': (config().lang || 'fr') + ',en;q=0.5' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function fetchMeta(entry) {
  let steamId = entry.steamAppId || null;
  if (!steamId) {
    const s = await steamJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(entry.name)}&l=${steamLang()}&cc=FR`);
    const want = normName(entry.name);
    const items = s.items || [];
    // Sans les mentions d'édition : « X - Complete Edition » correspond bien à « X ».
    const bare = n => normName(n).replace(/\b(complete|definitive|deluxe|ultimate|enhanced|gold|standard|premium|goty|game of the year|director s cut|remastered|anniversary|edition)\b/g, '').replace(/\s+/g, ' ').trim();
    const hit = items.find(it => normName(it.name) === want) || items.find(it => bare(it.name) === bare(entry.name)) || items.find(it => {
      const n = normName(it.name);
      return (n.startsWith(want) || want.startsWith(n)) && Math.min(n.length, want.length) / Math.max(n.length, want.length) > 0.6;
    });
    if (!hit) return { steamId: null, fetched: Date.now() };
    steamId = hit.id;
  }
  const d = await steamJson(`https://store.steampowered.com/api/appdetails?appids=${steamId}&l=${steamLang()}&cc=FR`);
  // Steam renvoie parfois la réponse sous une autre clé que l'appid demandé : on prend la première.
  const first = d[steamId] || Object.values(d)[0];
  const info = first && first.success ? first.data : null;
  if (!info) return { steamId, fetched: Date.now() };
  // Recherche par nom : on refuse un DLC, une bande-son ou une démo pris pour le jeu.
  if (!entry.steamAppId && info.type !== 'game') return { steamId: null, fetched: Date.now() };
  const genres = (info.genres || []).map(g => ({ id: String(g.id), name: g.description }));
  // Genres comparés par identifiant (Indépendant 23, Occasionnel 4, Accès anticipé 70) : pas par leur nom, qui suit la langue
  const software = info.type !== 'game' && info.type !== 'dlc' || (genres.length && genres.every(g => SOFTWARE_GENRES.has(g.id) || ['23', '4', '70'].includes(g.id)) && genres.some(g => SOFTWARE_GENRES.has(g.id)));
  const cats = info.categories || [];
  return {
    steamId, fetched: Date.now(), lang: steamLang(), name: info.name, kind: info.type,
    type: software ? 'app' : 'game',
    description: decodeEntities(info.short_description),
    genres: genres.map(g => g.name).slice(0, 4),
    developers: info.developers || [], publishers: info.publishers || [],
    release: info.release_date && info.release_date.date || null,
    metacritic: info.metacritic && info.metacritic.score || null,
    controller: cats.some(c => c.id === 28) ? 'full' : cats.some(c => c.id === 18) ? 'partial' : null,
    multiplayer: cats.some(c => [1, 9, 24, 36, 37, 38, 39].includes(c.id)),
    headerUrl: info.header_image || null,
  };
}

function enqueueMeta(entries) {
  for (const e of entries) {
    if (['rom','roblox','minecraft'].includes(e.source) || (!e.steamAppId && e.type === 'app')) continue; // rien à chercher sur Steam
    const m = meta[e.id];
    // Données incomplètes, ou dans une autre langue que celle de l'interface (genres, description)
    const stale = m && m.steamId && (((!m.type || (e.steamAppId && !m.name)) && Date.now() - m.fetched > 3600e3) || (m.name && (m.lang || 'french') !== steamLang()));
    if ((m && !stale) || queue.some(q => q.id === e.id)) continue;
    queue.push(e);
  }
  pump();
}
// Les métadonnées arrivent en arrière-plan, sans que l'interface ne s'en aperçoive : leurs
// changements sont signalés par paquets (au plus toutes les 8 s), pas un par jeu.
let metaDirty = false, metaFlush = null;
function metaChanged() {
  metaDirty = true;
  if (metaFlush) return;
  metaFlush = setTimeout(() => {
    metaFlush = null;
    if (!metaDirty) return;
    metaDirty = false;
    writeJson(FILES.meta, meta);
    version++;
  }, 8000);
}
async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const e = queue.shift();
    try { meta[e.id] = await fetchMeta(e); metaChanged(); }
    catch { /* hors ligne ou limite atteinte : on réessaiera plus tard */ }
    await new Promise(r => setTimeout(r, 400)); // reste poli avec l'API Steam
  }
  busy = false;
}

// ---------------------------------------------------------------- assemblage de la bibliothèque
const mergeArt = (base = {}, over = {}) => { const a = { ...base }; for (const k of ART_KINDS) if (str(over[k])) a[k] = over[k]; return a; };
const isUri = t => /^[a-z][\w+.-]*:/i.test(t) && !/^[a-z]:\\/i.test(t);

// La bibliothèque assemblée est gardée en mémoire : chaque image (/art/…) en a besoin pour trouver
// son jeu, et la reconstruire (fichiers, visuels Steam) coûtait ~100 ms par image. Elle est
// refaite dès que quelque chose change (`version`), et au plus tard après quelques secondes (visuels
// ajoutés dans Steam, raccourcis non-Steam).
const entriesCache = new Map();
function allEntries(withDemo) {
  const key = withDemo ? 'demo' : 'real';
  const hit = entriesCache.get(key);
  if (hit && hit.version === version && Date.now() - hit.at < 5000) return hit.value;
  const value = buildEntries(withDemo);
  value.byId = new Map(value.games.map(g => [g.id, g]));
  entriesCache.set(key, { version, at: Date.now(), value });
  return value;
}
function buildEntries(withDemo) {
  const lib = readJson(FILES.library, { games: [], launchers: [] });
  const ud = str(lib.steamUserdata);
  const steamRoot = ud ? path.dirname(ud) : null;
  const local = ud ? steam.localApps(ud) : {};
  const grid = ud ? steam.gridDir(ud) : null;
  const installedSteam = new Set();
  const games = (lib.games || []).map(g => {
    if (g.source === 'steam' && g.steamAppId) {
      installedSteam.add(String(g.steamAppId));
      const la = local[g.steamAppId] || {};
      return { ...g, installed: true, playtime: la.playtime || 0, lastPlayed: Math.max(g.lastPlayed || 0, la.lastPlayed || 0), art: mergeArt(g.art, steam.gridArt(grid, g.steamAppId)) };
    }
    return { ...g, installed: true };
  });
  // Jeux Steam déjà joués mais désinstallés : le nom vient des métadonnées.
  const pending = [];
  for (const [appid, la] of Object.entries(local)) {
    if (installedSteam.has(appid) || !la.playtime) continue;
    const id = 'steam:' + appid;
    const m = meta[id];
    if (!m || (m.steamId && !m.name)) { pending.push({ id, steamAppId: +appid, name: '', source: 'steam', type: 'game' }); continue; }
    if (!m.name || m.kind !== 'game') continue;
    games.push({
      id, source: 'steam', steamAppId: +appid, name: m.name, type: 'game', installed: false,
      playtime: la.playtime, lastPlayed: la.lastPlayed, sizeOnDisk: 0,
      launch: { kind: 'uri', target: `steam://install/${appid}` },
      art: mergeArt(steamRoot ? steam.cacheArt(steamRoot, appid) : {}, steam.gridArt(grid, appid)),
    });
  }
  const custom = readJson(FILES.custom, []).map(c => ({ ...c, installed: !c.launch || isUri(c.launch.target) || isFile(c.launch.target) }));
  const roms = (readJson(FILES.roms, {}) || {}).roms || [];
  return {
    generated: lib.generated, steamUserdata: ud, pending,
    games: [...accounts.entries([...games, ...(ud ? steam.shortcuts(ud) : [])]), ...custom, ...roms, ...(withDemo ? DEMO : [])],
    launchers: lib.launchers || [],
  };
}
function findEntry(id) {
  const all = allEntries(true);
  if (id.startsWith('launcher:')) return all.launchers.find(l => l.id === id.slice(9));
  return all.byId.get(id);
}

// Pas de recherche SteamGridDB pour le bureau à distance de KanePlay (aucun jeu de ce nom)
const noSgdb = e => e.source === 'kaneplay';

// Dossier dont les processus sont « le jeu » : l'app native s'en sert pour savoir s'il tourne,
// le remettre devant ou l'arrêter (émulation : le dossier de l'émulateur)
function trackDir(g) {
  if (g.demo || g.source === 'kaneplay' || g.streamHost) return null;
  if (g.source === 'rom') return g.launch && str(g.launch.target) ? path.dirname(g.launch.target) : null;
  if (str(g.installDir)) return g.installDir;
  const l = g.launch;
  return l && l.kind === 'exe' && /\.exe$/i.test(str(l.target)) ? path.dirname(l.target) : null;
}

// La date du fichier local change l'URL quand Steam ou SGDBoop remplace un visuel.
function fileRevision(file) {
  try { const st = fs.statSync(file); return Math.floor(st.mtimeMs).toString(36) + '-' + st.size.toString(36); } catch { return '0'; }
}
function publicEntry(g, st, cfg) {
  const m = meta[g.id] || {};
  const ov = st.overrides[g.id] || {};
  const played = st.played[g.id] || {};
  const artOv = st.artOverrides[g.id] || {};
  const steamId = g.steamAppId || m.steamId;
  const sgdbOn = !!cfg.sgdbAuto;
  const art = {};
  for (const k of ART_KINDS) {
    const local = str(artOv[k]) || str(g.art && g.art[k]);
    if (local || (steamId && k !== 'icon') || (sgdbOn && !g.demo && !noSgdb(g)) || (g.source === 'rom' && !g.demo && k !== 'icon')) {
      art[k] = `/art/${encodeURIComponent(g.id)}/${k}` + (artOv[k] ? `?v=${artOv._v || 1}` : local ? `?local=${fileRevision(local)}` : '?r=' + ((st.artRev || {})[g.id] || 1) + (k === 'portrait' && cfg.sgdbStyle ? '&style=' + encodeURIComponent(cfg.sgdbStyle) : ''));
    }
  }
  return {
    id: g.id, source: g.source, name: g.name, demo: !!g.demo, shortcut: !!g.shortcut,
    type: ov.type || (g.source === 'custom' || g.source === 'rom' ? g.type : m.type || g.type || 'game'),
    hidden: ov.hidden === undefined ? !!g.accountHidden : !!ov.hidden, removed: !!ov.removed, installed: g.installed !== false,
    canInstall: g.canInstall, installing: !!g.installing, sourceLabel: g.sourceLabel || null,
    lastPlayed: Math.max(g.lastPlayed || 0, played.last || 0), playCount: played.count || 0,
    playtime: (g.playtime || 0) + Math.round(played.minutes || 0),
    sizeOnDisk: g.sizeOnDisk || 0, installDir: str(g.installDir), steamAppId: g.steamAppId || null, trackDir: trackDir(g),
    streamHost: g.streamHost || null, system: g.system || null, systemName: g.systemName || null, region: g.region || null,
    emulator: g.emulator || null, emulatorId: g.emulatorId || null, core: g.core || null, romPath: g.romPath || null, installEmu: g.installEmu || null, archive: g.archive || null, added: g.added || 0,
    launch: g.launch && str(g.launch.target) ? { kind: g.launch.kind, target: g.launch.target, args: str(g.launch.args) || '' } : null,
    customArt: Object.keys(artOv).filter(k => k !== '_v'),
    art,
    meta: m.steamId !== undefined ? {
      description: m.description, genres: m.genres, developers: m.developers, publishers: m.publishers,
      release: m.release, metacritic: m.metacritic, controller: m.controller, multiplayer: m.multiplayer, steamId: m.steamId,
    } : null,
  };
}

// ---------------------------------------------------------------- réglages système, profils d'énergie
device.setCacheFile(path.join(DATA, 'device.json'));
const sysctl = syscontrol.create(async () => syscontrol.vendorOf((await device.info()).handheld));
const dolby = dolbyLib.create({ launch: target => run(target) });
const PERF_MODES = ['eco', 'balanced', 'performance'];
// Puissance des profils ASUS en watts, [sur batterie, sur secteur] (valeurs d'Armoury Crate SE). Elle
// est imposée avec le profil (les trois limites SPL, sPPT et fPPT égales) : sans cela, une puissance
// réglée à la main ou par un autre programme pouvait rester en place et le mode ne changeait rien.
const ASUS_WATTS = {
  'rog-ally': { silent: [10, 10], performance: [15, 15], turbo: [25, 30] },
  'rog-ally-x': { silent: [13, 13], performance: [17, 17], turbo: [25, 30] },
};
/**
 * Modes de performance KaneMode : chacun règle ensemble le mode d'alimentation de Windows, la limite
 * et le turbo du processeur et, sur une console reconnue, le profil du constructeur (puissance et
 * ventilateurs, comme Armoury Crate ou Legion Space) et, sur ROG Ally, la puissance elle-même.
 */
function perfPreset(mode, st, handheld) {
  const v = st && st.vendor;
  const pick = (...names) => (v && v.modes ? names.find(n => v.modes.includes(n)) : undefined);
  const base = {
    eco: { powerMode: 'efficiency', cpuMax: 70, boost: false, vendor: pick('silent', 'quiet') },
    balanced: { powerMode: 'balanced', cpuMax: 100, boost: true, vendor: pick('performance', 'balanced') },
    performance: { powerMode: 'performance', cpuMax: 100, boost: true, vendor: pick('turbo', 'performance') },
  }[mode];
  if (!base) return {};
  const w = v && v.vendor === 'asus' && base.vendor && ASUS_WATTS[handheld] && ASUS_WATTS[handheld][base.vendor];
  if (w) base.tdp = w[st.ac ? 1 : 0];
  return base;
}
/** Profil complet : le mode choisi, puis les réglages précisés un par un (qui l'emportent). */
async function expandProfile(profile, source) {
  const { mode, ...rest } = profile || {};
  if (!PERF_MODES.includes(mode)) return rest;
  const st = await sysctl.state().catch(() => null);
  const hh = (await device.info().catch(() => ({}))).handheld;
  const base = perfPreset(mode, source ? { ...st, ac: source === 'ac' } : st, hh && hh.id);
  for (const k of Object.keys(base)) if (base[k] === undefined) delete base[k];
  return { ...base, ...rest };
}
const setPerfMode = mode => {
  const c = config();
  if (c.perfMode === mode && (mode === 'custom' || c.customTdp == null)) return;
  c.perfMode = mode;
  if (mode !== 'custom') delete c.customTdp; // un mode remplace la puissance réglée à la main
  writeJson(FILES.config, c);
};

// ---------------------------------------------------------------- mode tenu
// Armoury Crate SE (et ses profils par jeu), Legion Space, le branchement du chargeur ou la sortie de
// veille peuvent remettre un autre profil ou une autre puissance sur la console. Toutes les 5 s,
// KaneMode lit le profil en cours (lecture ACPI, instantanée) et rétablit le mode choisi. S'il est
// changé sans cesse, un autre programme l'impose : KaneMode s'efface 10 minutes et le signale.
const keeper = { tick: Date.now(), ac: null, fixes: [], pausedUntil: 0, quiet: 0, busy: false, st: null, stAt: 0 };
const keeperConflict = () => Date.now() < keeper.pausedUntil;
const netState = { t: 0, p: null }; // connexion réseau (GET /api/net)
const hostScale = hostScaleLib.create(ROOT); // complément PC hôte (Paramètres → Streaming)
const weather = weatherLib.create({ read: config, write: c => writeJson(FILES.config, c) }); // panneau Heure (GET /api/weather)
const deals = dealsLib.create(DATA, { lang: () => config().lang || 'fr' }); // bons plans des boutiques (GET /api/deals)
// Réglages graphiques du pilote : outil du fabricant de la carte (voir lib/gpuctl.js)
const gfx = gpuctl.create({ vendors: async () => { const d = await device.info(); return d && d.ok ? (d.gpus || []).map(g => String(g.vendor || '').toUpperCase()) : null; } });
const hudLive = { t: 0, p: null }; // mesures des widgets Game Bar (GET /api/hud/live)

// ---------------------------------------------------------------- limite d'images, jeux seulement
// La limite d'images du pilote (AMD : Radeon Chill ; NVIDIA : « Max Frame Rate » ; Intel : Frame Limit)
// vaut pour toute application 3D, KaneMode compris :
// réglée à 60 i/s dans le widget, elle bridait aussi l'interface (120 Hz sur la ROG Ally). La limite
// choisie est gardée (config.fpsLimit) et appliquée seulement quand KaneMode n'est pas au premier
// plan ; l'app signale chaque passage (POST /api/graphics/front).
const fpsScope = { front: true, busy: null };
async function applyFpsScope() {
  const run = async () => {
    const st = await gfx.state(true).catch(() => null);
    if (!st || !st.available || !st.fps) return st;
    const c = config();
    // Première fois : la limite déjà réglée dans le pilote devient celle des jeux
    if (c.fpsLimit == null) { c.fpsLimit = st.fps.on ? st.fps.value : 0; writeJson(FILES.config, c); }
    const want = fpsScope.front ? 0 : c.fpsLimit;
    const now = st.fps.on ? st.fps.value : 0;
    if (want === now) return st;
    console.log(want ? `Limite de ${want} i/s appliquée (jeu au premier plan)` : 'Limite d’images levée (KaneMode au premier plan)');
    return gfx.set('fps', want);
  };
  // Une application à la fois, dans l'ordre des passages
  fpsScope.busy = (fpsScope.busy || Promise.resolve()).catch(() => {}).then(run);
  return fpsScope.busy;
}
const withFps = st => (st && st.available ? { ...st, fpsLimit: config().fpsLimit ?? (st.fps && st.fps.on ? st.fps.value : 0), kanemodeFront: fpsScope.front } : st);
const losslessCheck = { t: 0, p: null }; // Lossless Scaling ouvert (GET /api/widget)
/** Un réglage vient d'être fait à la main ou par un mode : pas de vérification pendant 4 s. */
const keeperQuiet = () => { keeper.quiet = Date.now(); };
async function keepPerf(reason) {
  if (keeper.busy) return;
  keeper.busy = true;
  try {
    await powerController.sync({ refresh: reason === 'sortie de veille' });
    if (Date.now() - keeper.quiet < 4000) return;
    const hh = (await device.info().catch(() => ({}))).handheld;
    if (!syscontrol.vendorOf(hh)) return;
    const pol = await sysctl.policy();
    const acChanged = keeper.ac != null && pol.ac != null && pol.ac !== keeper.ac;
    if (pol.ac != null) keeper.ac = pol.ac;
    const c = config();
    if (PERF_MODES.includes(c.perfMode)) {
      // Profils proposés par la console : l'état complet n'est relu que toutes les 5 minutes (il
      // interroge aussi le son, l'écran, les radios…), la source d'alimentation vient de la lecture rapide
      if (!keeper.st || Date.now() - keeper.stAt > 300000) { keeper.st = await sysctl.state(); keeper.stAt = Date.now(); }
      const p = perfPreset(c.perfMode, { ...keeper.st, ac: pol.ac != null ? pol.ac : keeper.st.ac }, hh.id);
      for (const k of Object.keys(p)) if (p[k] === undefined) delete p[k];
      if (Date.now() - keeper.quiet < 4000 || config().perfMode !== c.perfMode) return; // changé entre-temps
      if (p.vendor && pol.vendor && pol.vendor !== p.vendor) {
        const now = Date.now();
        keeper.fixes = keeper.fixes.filter(t => now - t < 120000).concat(now);
        if (keeperConflict()) return;
        if (keeper.fixes.length > 4) {
          keeper.pausedUntil = now + 600000;
          console.log(`Mode ${c.perfMode} : un autre programme impose le profil ${pol.vendor} (Armoury Crate SE ?), KaneMode ne le rétablit plus pendant 10 minutes`);
          return;
        }
        console.log(`Mode ${c.perfMode} rétabli : la console était passée en profil ${pol.vendor}`);
        await sysctl.apply(p);
      } else if (acChanged || reason) {
        // Même profil : la puissance est remise (le secteur change celle du profil Turbo)
        if (reason) console.log(`Mode ${c.perfMode} : puissance remise (${reason})`);
        await sysctl.apply({ vendor: acChanged ? p.vendor : undefined, tdp: p.tdp });
      }
    } else if (c.perfMode === 'custom' && c.customTdp != null && (acChanged || reason)) {
      await sysctl.call('tdp', { value: c.customTdp });
    }
  } catch { /* console occupée : prochaine vérification dans 5 s */ }
  finally { keeper.busy = false; }
}
setInterval(() => {
  const now = Date.now();
  // Minuterie arrêtée plus de 30 s : la console sortait de veille
  const woke = now - keeper.tick > 30000;
  keeper.tick = now;
  keepPerf(woke ? 'sortie de veille' : null);
}, 5000);
const PROFILE_FIELDS = {
  mode: v => PERF_MODES.includes(v),
  powerMode: v => ['efficiency', 'balanced', 'performance'].includes(v),
  vendor: v => /^[a-z]{3,12}$/.test(v),
  tdp: v => (Number.isInteger(v) && v >= 5 && v <= 40) || (v && typeof v === 'object' && ['spl', 'sppt', 'fppt'].every(k => Number.isInteger(v[k]) && v[k] >= 5 && v[k] <= 40)),
  cpuMax: v => Number.isInteger(v) && v >= 30 && v <= 100,
  boost: v => typeof v === 'boolean',
  refresh: v => Number.isInteger(v) && v >= 30 && v <= 500,
  brightness: v => Number.isInteger(v) && v >= 0 && v <= 100,
};
const powerProfiles = () => {
  return powerLib.profiles(config());
};
const powerController = powerLib.create({ read: config, write: c => writeJson(FILES.config, c),
  policy: () => sysctl.policy(), expand: expandProfile,
  // Turbo à 30 W sur secteur : consoles dont le profil constructeur a cette puissance (ROG Ally)
  turbo: async () => { const hh = (await device.info().catch(() => ({}))).handheld; return !!(hh && ASUS_WATTS[hh.id]); },
  apply: async p => { keeperQuiet(); const r = await sysctl.apply(p); keeperQuiet(); return r; },
  applied: (mode, profile, source) => {
    keeper.ac = source === 'ac';
    keeper.fixes = []; keeper.pausedUntil = 0;
    setPerfMode(mode);
    const c = config();
    if (profile.tdp != null) c.customTdp = profile.tdp; else delete c.customTdp;
    writeJson(FILES.config, c);
  },
});
// ---------------------------------------------------------------- HDR automatique (voir lib/autohdr.js)
// Jeux de la bibliothèque et leur dossier, gardés 30 s (classement jeu / application de l'utilisateur compris)
const hdrType = (g, st = state()) => (st.overrides[g.id] || {}).type || (g.source === 'custom' || g.source === 'rom' ? g.type : (meta[g.id] || {}).type || g.type || 'game');
const hdrGamesMemo = { t: 0, list: [] };
function hdrGames() {
  if (Date.now() - hdrGamesMemo.t < 30000) return hdrGamesMemo.list;
  const st = state();
  const list = allEntries(false).games.map(g => ({
    id: g.id, name: g.name, source: g.source, installed: g.installed, demo: g.demo, streamHost: g.streamHost,
    type: hdrType(g, st),
    dir: trackDir(g),
  }));
  hdrGamesMemo.t = Date.now(); hdrGamesMemo.list = autoHdrLib.trackable(list);
  return hdrGamesMemo.list;
}
const autoHdr = autoHdrLib.create({
  read: config, write: c => writeJson(FILES.config, c),
  hdr: async () => (await sysctl.call('hdrstate')).hdr,
  setHdr: on => sysctl.call('hdr', { value: on }),
  paths: async () => (await sysctl.call('procpaths')).paths || [],
  games: async () => hdrGames(),
  log: m => console.log(m),
});
// Écran HDR branché ? Relu chaque minute : sans lui (écran de l'Ally seul), rien n'est surveillé
const hdrScreen = { t: 0, ok: false };
setInterval(async () => {
  try {
    if (Date.now() - hdrScreen.t > 60000) { hdrScreen.ok = (await sysctl.call('hdrstate')).hdr >= 0; hdrScreen.t = Date.now(); }
    if (hdrScreen.ok && autoHdr.needsPoll()) await autoHdr.poll();
  } catch { /* réglages système occupés : prochain passage dans 4 s */ }
}, 4000);

// ---------------------------------------------------------------- pilotes (Windows Update)
const driverJobs = device.drivers(DATA);
// Mises à jour officielles du constructeur de la console (BIOS, pilotes du modèle)
const oemUpdates = oem.tracker(DATA);
// Pilotes graphiques des fabricants (NVIDIA, AMD, Intel), voir lib/gpudrivers.js
const gpuDrivers = gpuLib.tracker(DATA);
/**
 * Pilotes disponibles pour cette machine, à signaler (notification dans l'interface) : carte
 * graphique (sauf puce AMD d'une console portable, dont le constructeur fournit le pilote), BIOS et
 * pilotes du constructeur de la console.
 */
function driverNews() {
  const items = [];
  const g = gpuDrivers.status().last;
  for (const x of (g && g.gpus) || []) {
    if (x.status === 'new' && !x.preferOem) items.push({ key: `gpu:${x.name}:${x.latest}`, title: `${x.title || 'Pilote ' + x.maker} ${x.latest}`, detail: `${x.name} · installé : ${x.installed || '?'}` });
  }
  const o = oemUpdates.status().last;
  for (const c of (o && o.ok && o.channels) || []) {
    if (c.status === 'new') items.push({ key: `oem:${c.id}:${c.latest}`, title: `${c.title} ${c.latest}`, detail: `installé : ${c.installed || '?'}` });
    for (const i of c.items || []) if (i.status === 'new') items.push({ key: `oem:${i.title}:${i.version}`, title: `${i.title} ${i.version}`, detail: `installé : ${i.installed || '?'}` });
  }
  return { checked: g ? g.checked : null, items };
}
/** Vérification des pilotes au plus une fois par jour, jamais avec un jeu devant. */
async function checkDriversDaily() {
  if (!fpsScope.front) return;
  const last = gpuDrivers.status().last;
  if (last && Date.now() - Date.parse(last.checked) < 20 * 3600e3) return;
  const dev = await device.info().catch(() => null);
  if (!dev || !dev.ok) return;
  await gpuDrivers.check(dev).catch(() => null);
  if (oemUpdates.supported(dev.handheld)) await oemUpdates.check(dev).catch(() => null);
  const n = driverNews().items.length;
  console.log(`Pilotes vérifiés : ${n ? `${n} mise${n > 1 ? 's' : ''} à jour disponible${n > 1 ? 's' : ''}` : 'rien de nouveau'}`);
}

// ---------------------------------------------------------------- streaming (moteur KanePlay)
// Copie embarquée dans l'app native (dossier kaneplay\ à côté de app\, voir native\build.ps1)
const KANEPLAY_BUNDLED = path.join(ROOT, '..', 'kaneplay', 'KanePlay.exe');
// Développement : moteur compilé depuis le sous-module (engine\build-engine.ps1)
const KANEPLAY_DEV = path.join(ROOT, 'engine', 'out', 'KanePlay.exe');
// Icône de KaneMode pour la fenêtre du streaming (paquet : app\kanemode.ico)
const KANEMODE_ICON = [path.join(ROOT, 'kanemode.ico'), path.join(ROOT, 'setup', 'kanemode.ico')].find(isFile) || null;
// Jaquette : dessinée par l'interface (ui/js/streamcover.js), aux couleurs et dans la langue de KaneMode
const KANEPLAY_COVER = null;
const kp = { exe: null, entries: [], hosts: [] };
// Apparence de KaneMode reprise par l'écran de streaming : icône, couleur d'accent, coins, langue
const engineLook = () => {
  const cfg = config();
  return { icon: KANEMODE_ICON, accent: cfg.accent, corners: cfg.corners, lang: cfg.lang,
    sounds: cfg.sounds === true, soundTheme: cfg.soundTheme, soundVolume: cfg.soundVolume, soundMoves: cfg.soundMoves };
};
// Langues de l'interface (ui/js/i18n.js) : la langue choisie est gardée pour les widgets et le streaming
const LANGS = ['fr', 'en'];
let kpLast = 0;
async function refreshKanePlay() {
  kpLast = Date.now();
  try {
    const exe = await kaneplay.findExe(KANEPLAY_BUNDLED, KANEPLAY_DEV);
    const hosts = exe ? await kaneplay.hosts() : [];
    const one = kaneplay.entry(exe, KANEPLAY_COVER, engineLook());
    const entries = one ? [one] : [];
    const sig = (x, h, list) => JSON.stringify([x, h.map(y => y.uuid + y.paired), list.map(e => e.id + e.name + !!e.art.portrait)]);
    const changed = sig(exe, hosts, entries) !== sig(kp.exe, kp.hosts, kp.entries);
    Object.assign(kp, { exe, hosts, entries });
    if (changed) version++;
  } catch (e) { console.error('Streaming :', e.message); }
}

// ---------------------------------------------------------------- visuels : surcharges, Steam, SteamGridDB
let sgdbCache = readJson(FILES.sgdb, {});
const gamePending = new Map(), artPending = new Map();
async function sgdbGameFor(e, key) {
  if (e.id in sgdbCache) return sgdbCache[e.id];
  if (gamePending.has(e.id)) return gamePending.get(e.id);
  const promise = sgdb.gameFor(key, e).then(g => {
    sgdbCache[e.id] = g ? { id: g.id, name: g.name } : null;
    writeJson(FILES.sgdb, sgdbCache);
    return sgdbCache[e.id];
  }).finally(() => gamePending.delete(e.id));
  gamePending.set(e.id, promise);
  return promise;
}
const cached = base => { for (const ext of ['.png', '.jpg', '.webp', '.ico']) if (isFile(base + ext)) return base + ext; return null; };
const recentMiss = base => { try { return Date.now() - fs.statSync(base + '.miss').mtimeMs < 24 * 3600e3; } catch { return false; } };

// Pas plus de 4 recherches SteamGridDB à la fois quand une grille entière se charge
let sgdbRunning = 0;
const sgdbWaiting = [];
async function sgdbSlot(fn) {
  if (sgdbRunning >= 4) await new Promise(r => sgdbWaiting.push(r));
  else sgdbRunning++;
  try { return await fn(); }
  finally { const next = sgdbWaiting.shift(); if (next) next(); else sgdbRunning--; }
}

async function sgdbAuto(e, kind, cfg) {
  const base = path.join(ARTCACHE, `sgdb_${safeId(e.id)}_${kind}${kind === 'portrait' && cfg.sgdbStyle ? '_' + cfg.sgdbStyle : ''}`);
  const hit = cached(base);
  if (hit) return hit;
  if (recentMiss(base)) return null;
  if (artPending.has(base)) return artPending.get(base);
  const promise = sgdbSlot(() => sgdbFetch(e, kind, cfg, base)).finally(() => artPending.delete(base));
  artPending.set(base, promise);
  return promise;
}
async function sgdbFetch(e, kind, cfg, base) {
  const again = cached(base);
  if (again) return again;
  try {
    const game = await sgdbGameFor(e, cfg.sgdbKey);
    const options = { style: kind === 'portrait' ? cfg.sgdbStyle : '' };
    let list = game ? await sgdb.assets(cfg.sgdbKey, game.id, kind, { ...options, firstPage: !options.style }) : [];
    // Une seule page suffit généralement ; les autres ne sont lues que sans visuel adapté.
    if (game && !list.length) list = await sgdb.assets(cfg.sgdbKey, game.id, kind, options);
    if (!list.length) { fs.writeFileSync(base + '.miss', ''); return null; }
    const img = await sgdb.download(list[0].url);
    fs.writeFileSync(base + img.ext, img.data);
    return base + img.ext;
  } catch { return null; } // réseau ou clé refusée : pas de marqueur, on réessaiera
}

const REMOTE = { portrait: ['library_600x900_2x.jpg', 'library_600x900.jpg'], hero: ['library_hero.jpg'], logo: ['logo.png'], header: ['header.jpg'] };
const HOSTS = ['https://shared.fastly.steamstatic.com/store_item_assets/steam/apps', 'https://cdn.cloudflare.steamstatic.com/steam/apps'];
async function steamCdn(steamId, kind) {
  const base = path.join(ARTCACHE, `${steamId}_${kind}`);
  const hit = cached(base);
  if (hit) return hit;
  if (recentMiss(base)) return null;
  const urls = [];
  for (const f of REMOTE[kind] || []) for (const h of HOSTS) urls.push(`${h}/${steamId}/${f}`);
  const m = Object.values(meta).find(x => x.steamId === steamId && x.headerUrl);
  if (kind === 'header' && m) urls.push(m.headerUrl);
  let unavailable = false;
  for (const u of urls) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
      if (r.status !== 404 && r.status !== 410 && !r.ok) unavailable = true;
      if (!r.ok || !(r.headers.get('content-type') || '').startsWith('image/')) continue;
      const file = base + (u.includes('.png') ? '.png' : '.jpg');
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      return file;
    } catch { unavailable = true; } // panne réseau : réessayer au prochain affichage
  }
  if (!unavailable) fs.writeFileSync(base + '.miss', '');
  return null;
}

/** Ordre : choix de l'utilisateur > fichier local (Steam, grid, scan) > SteamGridDB / boutique Steam > rien. */
async function resolveArt(e, kind) {
  const st = state();
  const ov = str((st.artOverrides[e.id] || {})[kind]);
  if (ov && isFile(ov)) return ov;
  const local = str(e.art && e.art[kind]);
  if (local && isFile(local)) return local;
  if ((e.demo && e.source === 'rom') || noSgdb(e)) return null;
  // Jeu rétro : images de libretro (nom No-Intro / Redump), SteamGridDB à défaut
  if (e.source === 'rom') { const f = await emuMeta.art(e, kind); if (f) return f; }
  const cfg = config();
  const steamId = e.steamAppId || (meta[e.id] || {}).steamId;
  const sgdbOn = cfg.sgdbAuto;
  if (sgdbOn && kind === 'portrait' && cfg.sgdbStyle) { const f = await sgdbAuto(e, kind, cfg); if (f) return f; }
  if (sgdbOn && (!steamId || !cfg.sgdbPreferSteam)) { const f = await sgdbAuto(e, kind, cfg); if (f) return f; }
  if (steamId && kind !== 'icon') { const f = await steamCdn(steamId, kind); if (f) return f; }
  if (sgdbOn && steamId && cfg.sgdbPreferSteam) { const f = await sgdbAuto(e, kind, cfg); if (f) return f; }
  if (isSwitchRom(e)) return nintendoAuto(e, kind);
  return null;
}

// Jeu Switch ou Switch 2 : premier visuel du site de Nintendo, téléchargé une fois
async function nintendoAuto(e, kind) {
  const base = path.join(ARTCACHE, `nin_${safeId(e.id)}_${kind}`);
  const hit = cached(base);
  if (hit) return hit;
  if (recentMiss(base)) return null;
  if (artPending.has(base)) return artPending.get(base);
  const promise = (async () => {
    try {
      const list = await nintendo.assets(await nintendo.gameFor(e), kind);
      if (!list.length) { fs.writeFileSync(base + '.miss', ''); return null; }
      const img = await nintendoLib.download(list[0].url);
      fs.writeFileSync(base + img.ext, img.data);
      return base + img.ext;
    } catch { return null; } // hors ligne : nouvel essai au prochain affichage
  })().finally(() => artPending.delete(base));
  artPending.set(base, promise);
  return promise;
}

function setArtOverride(id, kind, file) {
  const st = state();
  const o = st.artOverrides[id] = { ...(st.artOverrides[id] || {}) };
  if (file) o[kind] = file; else delete o[kind];
  o._v = (o._v || 0) + 1;
  if (Object.keys(o).length === 1) delete st.artOverrides[id];
  writeJson(FILES.state, st);
  version++;
}

// ---------------------------------------------------------------- lancement (+ suivi du temps de jeu)
function recordPlay(id) {
  const st = state();
  const p = st.played[id] || {};
  st.played[id] = { ...p, last: Math.floor(Date.now() / 1000), count: (p.count || 0) + 1 };
  writeJson(FILES.state, st);
}
function addMinutes(id, minutes) {
  const st = state();
  const p = st.played[id] || {};
  st.played[id] = { ...p, minutes: (p.minutes || 0) + minutes };
  writeJson(FILES.state, st);
  version++;
}

// Jeu Steam en cours (0 si aucun) : Steam le note dans le registre de l'utilisateur. Lu par le service
// syscontrol déjà ouvert (quelques ms) ; reg.exe en secours (plusieurs centaines de ms sur l'Ally)
async function steamRunningApp() {
  try { return (await sysctl.call('steamapp')).app || 0; } catch { /* service indisponible */ }
  return new Promise(resolve => {
    execFile('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'RunningAppID'], { windowsHide: true, timeout: 3000 }, (err, out) => {
      const m = !err && /RunningAppID\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(out);
      resolve(m ? parseInt(m[1], 16) : 0);
    });
  });
}
/** Programme ouvert ? (nom sans « .exe ») Par syscontrol, tasklist en secours. */
async function processOpen(name) {
  try { return (await sysctl.call('procs', { value: [name] })).running.length > 0; } catch { /* service indisponible */ }
  return new Promise(resolve => execFile('tasklist.exe', ['/FI', `IMAGENAME eq ${name}.exe`, '/NH'], { windowsHide: true, timeout: 4000 },
    (err, out) => resolve(!err && out.toLowerCase().includes(name.toLowerCase() + '.exe'))));
}
// steam.exe, à côté du dossier userdata trouvé par l'analyse
function steamClient() {
  const ud = str(readJson(FILES.library, {}).steamUserdata);
  const exe = ud ? path.join(path.dirname(ud), 'steam.exe') : null;
  return exe && isFile(exe) ? exe : null;
}
// Lanceur d'Epic Games, à son emplacement habituel
function epicClient() {
  const detected = readJson(FILES.library, {}).launchers?.find(l => l.id === 'epic')?.exe;
  if (typeof detected === 'string' && path.basename(detected).toLowerCase() === 'epicgameslauncher.exe' && isFile(detected)) return detected;
  for (const base of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles].filter(Boolean)) {
    for (const arch of ['Win64', 'Win32']) {
      const exe = path.join(base, 'Epic Games', 'Launcher', 'Portal', 'Binaries', arch, 'EpicGamesLauncher.exe');
      if (isFile(exe)) return exe;
    }
  }
  return null;
}
// Boutiques démarrées sans leur fenêtre (zone de notification) : avant un jeu, ou dès le démarrage de
// KaneMode pour que le premier jeu parte tout de suite (Paramètres → Bibliothèque)
const STORE_BG = {
  steam: { name: 'Steam', proc: 'steam', exe: steamClient, args: '-silent' },
  epic: { name: 'Epic Games', proc: 'EpicGamesLauncher', exe: epicClient, args: '-silent' },
};
/**
 * Démarre une boutique sans sa fenêtre si elle n'est pas ouverte. `wait` : attend qu'elle tourne (le
 * lien du jeu part ensuite vers elle). On passe par un raccourci ouvert par l'Explorateur, comme pour
 * les liens : lancée directement par l'hôte, la boutique ferait partie du paquet de KaneMode (et
 * serait fermée à chaque mise à jour).
 */
async function startStoreSilently(id, { wait = true } = {}) {
  const s = STORE_BG[id];
  const exe = s && s.exe();
  if (!exe || await processOpen(s.proc)) return false;
  const lnk = path.join(DATA, `${id}-silent-${crypto.createHash('md5').update(exe.toLowerCase()).digest('hex').slice(0, 8)}.lnk`);
  if (!isFile(lnk)) {
    const q = v => `'${v.replace(/'/g, "''")}'`;
    await new Promise(resolve => execFile('powershell.exe', ['-NoProfile', '-Command',
      `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${q(lnk)}); $s.TargetPath = ${q(exe)}; $s.Arguments = ${q(s.args)}; $s.WorkingDirectory = ${q(path.dirname(exe))}; $s.Save()`],
    { windowsHide: true, timeout: 15000 }, () => resolve()));
    if (!isFile(lnk)) { console.error(`Raccourci ${s.name} sans fenêtre impossible à créer`); return false; }
  }
  console.log(`${s.name} fermé : démarrage sans sa fenêtre${wait ? '' : ' (prêt pour le premier jeu)'}`);
  spawn('explorer.exe', [lnk], { detached: true, stdio: 'ignore' }).unref();
  if (!wait) return true;
  for (let i = 0; i < 20 && !await processOpen(s.proc); i++) await new Promise(r => setTimeout(r, 250));
  await new Promise(r => setTimeout(r, 1500)); // le temps qu'elle prenne la main sur ses liens
  return true;
}
const startSteamSilently = () => startStoreSilently('steam');

/**
 * Boutiques gardées prêtes : réglage de l'utilisateur, sinon celles dont au moins un jeu est installé
 * (Steam et Epic ; les jeux GOG, Ubisoft… se lancent sans leur boutique ou la démarrent eux-mêmes).
 */
function storesReady() {
  const pref = config().storesReady || {};
  const games = readJson(FILES.library, { games: [] }).games || [];
  const out = {};
  for (const id of Object.keys(STORE_BG)) {
    out[id] = typeof pref[id] === 'boolean' ? pref[id] : games.some(g => g.source === id && g.installed !== false && g.type !== 'app');
  }
  return out;
}
async function warmStores() {
  if (!fpsScope.front) return; // un jeu est devant : pas maintenant
  const want = storesReady();
  for (const id of Object.keys(want)) if (want[id]) await startStoreSilently(id, { wait: false }).catch(() => false);
}
// Dernier lancement de chaque entrée : un second appui (ou un événement en double) ne relance pas le jeu
const recentLaunch = new Map();
const LAUNCH_GUARD = 30e3;

const run = launchLib.create();
const accounts = accountsLib.create(DATA, { run, root: ROOT,
  discover: async exe => {
    const result = await runPs('playnite.ps1', exe ? ['-Executable', exe] : []);
    if (result.code !== 0) throw new Error('Impossible de détecter Playnite');
    try { return JSON.parse(result.out.replace(/^\uFEFF/, '')); } catch { return {}; }
  },
  onChange: () => { version++; entriesCache.clear(); },
});

// ---------------------------------------------------------------- émulation
// Dossier d'émulation de l'utilisateur : Jeux (un dossier par console), BIOS, Sauvegardes et les
// émulateurs installés par KaneMode. Hors d'AppData : rien n'est perdu si KaneMode est désinstallé.
const emuHome = () => str(config().emuHome) || path.join(os.homedir(), 'KaneMode Émulation');
const emuDirs = () => { const h = emuHome(); return { home: h, games: path.join(h, 'Jeux'), bios: path.join(h, 'BIOS'), saves: path.join(h, 'Sauvegardes') }; };
const emuMount = require('./lib/emu-mount');
const emuSbi = require('./lib/emu-sbi').create({ cacheFile: path.join(DATA, 'emu-cache', 'sbi-misses.json') });
const emuArchive = require('./lib/emu-archive').create({ cacheDir: () => path.join(emuHome(), 'Cache') });
const emuMeta = emuMetaLib.create({ cacheDir: path.join(DATA, 'emu-cache'), artDir: ARTCACHE });
const nintendo = nintendoLib.create({ cacheDir: path.join(DATA, 'emu-cache') });
const isSwitchRom = e => e && e.source === 'rom' && (e.system === 'switch' || e.system === 'switch2');
const emuStore = emuStoreLib.create({
  home: emuHome,
  isAlly: async () => { try { return /^rog-ally/.test(((await device.info()) || {}).handheld?.id || ''); } catch { return false; } },
});
function ensureEmuHome() {
  const d = emuDirs();
  try {
    for (const s of emu.SYSTEMS) fs.mkdirSync(path.join(d.games, s.name), { recursive: true });
    for (const b of ['Switch', 'Switch 2']) fs.mkdirSync(path.join(d.bios, b), { recursive: true });
    fs.mkdirSync(d.saves, { recursive: true });
    emuSetup.unpackBios(d.bios);
    const readme = path.join(d.games, 'LISEZ-MOI.txt');
    const lines = ['Déposez vos jeux dans le dossier de leur console : ils apparaissent tout seuls dans KaneMode.', '',
      ...emu.SYSTEMS.map(s => `${s.name.padEnd(24)} ${s.exts.length ? '.' + s.exts.join(' .') : 'un dossier par jeu'}`), '',
      'Les BIOS et les clés de console vont dans le dossier BIOS, à côté de ce dossier.'];
    // Réécrit quand la liste des formats change (nouvelle version de KaneMode)
    const text = '﻿' + lines.join('\r\n');
    let old = '';
    try { old = fs.readFileSync(readme, 'utf8'); } catch { /* pas encore écrit */ }
    if (old !== text) fs.writeFileSync(readme, text);
  } catch (e) { console.error('Émulation : dossier', d.home, e.message); }
  return d;
}
/** Avant un lancement : BIOS présents, cœur RetroArch téléchargé, réglages de l'émulateur à jour. */
// Réglages de l'émulation choisis par l'utilisateur : par console, puis par jeu (le jeu l'emporte)
const EMU_SETTING_KEYS = { emulator: v => typeof v === 'string' && /^[\w-]+$/.test(v), core: v => typeof v === 'string' && /^[\w-]+$/.test(v),
  filter: v => ['none', 'crt', 'scanlines', 'lcd', 'smooth', 'sharp'].includes(v), aspect: v => ['auto', '4:3', '16:9', 'full'].includes(v),
  quality: v => ['auto', 'native'].includes(v), wide: v => ['on', 'off'].includes(v),
  // Jeux Switch et Switch 2 : réglages de KaneMode (auto), Preset IA, ou rien d'imposé (manual)
  preset: v => ['auto', 'ia', 'manual'].includes(v) };
const emuSettings = () => ({ systems: {}, games: {}, ...(config().emuSettings || {}) });
// Réglages par défaut d'une console : écran d'époque pour les consoles de salon 2D, écran LCD pour
// les portables, image agrandie à la taille de l'écran, écran large quand il est sans défaut (PS2)
const CRT_SYSTEMS = ['nes', 'snes', 'megadrive', 'mastersystem', 'pcengine', 'neogeo', 'arcade', 'atari2600', 'segacd'];
const LCD_SYSTEMS = ['gb', 'gbc', 'gba', 'gamegear'];
const emuDefaults = sys => ({ filter: CRT_SYSTEMS.includes(sys) ? 'crt' : LCD_SYSTEMS.includes(sys) ? 'lcd' : 'none', aspect: 'auto', quality: 'auto', wide: sys === 'ps2' ? 'on' : 'off', preset: 'auto' });
const emuEffective = (sys, id) => { const s = emuSettings(); return { ...emuDefaults(sys), ...(s.systems[sys] || {}), ...(s.games[id] || {}) }; };
// Écran et carte graphique : la résolution interne des émulateurs 3D en dépend (relevé au démarrage)
const emuDisplay = { screenH: 1080, tier: 'low' };
function detectDisplay() {
  const cache = path.join(DATA, 'emu-cache', 'display.json');
  Object.assign(emuDisplay, readJson(cache, {}));
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object Name, CurrentVerticalResolution | ConvertTo-Json -Compress'],
    { windowsHide: true, timeout: 20000 }, (err, out) => {
      if (err) return;
      try {
        const list = [].concat(JSON.parse(String(out)) || []);
        const h = Math.max(0, ...list.map(v => +v.CurrentVerticalResolution || 0));
        // Carte dédiée (GeForce, Radeon RX, Arc) : résolutions plus hautes ; sinon puce intégrée (ROG Ally)
        const high = list.some(v => /nvidia|geforce|rtx|radeon\s*(rx|pro)|\barc\b/i.test(v.Name || ''));
        Object.assign(emuDisplay, { screenH: h || 1080, tier: high ? 'high' : 'low', gpu: list.map(v => v.Name).join(', ') });
        writeJson(cache, emuDisplay);
        console.log(`Émulation : écran ${emuDisplay.screenH} lignes, carte ${emuDisplay.gpu} (${emuDisplay.tier === 'high' ? 'dédiée' : 'intégrée'})`);
      } catch { /* relevé illisible : valeurs précédentes */ }
    });
}
// Filtres et formats de RetroArch (préréglages slang livrés avec RetroArch, pilote Direct3D 11)
const RA_SHADERS = {
  crt: () => (emuDisplay.tier === 'high' ? 'crt/crt-guest-advanced-fast.slangp' : 'crt/crt-easymode.slangp'),
  scanlines: () => 'scanlines/res-independent-scanlines.slangp', lcd: () => 'handheld/lcd-grid-v2.slangp',
  sharp: () => 'pixel-art-scaling/sharp-shimmerless.slangp',
};
const RA_ASPECT = { auto: '22', '4:3': '0', '16:9': '1', full: '24' };
// fresh : « Recommencer du début », la sauvegarde automatique n'est pas rechargée cette fois
function retroarchLook(raDir, gameId, set, fresh = false) {
  const file = path.join(DATA, 'emu-ra', safeId(gameId) + '.cfg');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const shader = RA_SHADERS[set.filter] && RA_SHADERS[set.filter]();
  emuSetup.mergeCfg(file, {
    video_shader_enable: shader ? 'true' : 'false', video_smooth: set.filter === 'smooth' ? 'true' : 'false',
    video_scale_integer: 'false', aspect_ratio_index: RA_ASPECT[set.aspect] || '22',
    savestate_auto_load: fresh ? 'false' : 'true',
  });
  return ` --appendconfig "${file}"` + (shader ? ` --set-shader "${path.join(raDir, 'shaders', 'shaders_slang', shader)}"` : '');
}

/**
 * Dossier des mods d'un jeu Switch ou Switch 2 : celui de son émulateur (Eden, Lichii ; la version
 * modifiée de Lichii partage le dossier user de Lichii), sous user\load\<identifiant du jeu>.
 */
function modsTarget(id) {
  const e = findEntry(String(id || ''));
  if (!e || e.source !== 'rom' || !['switch', 'switch2'].includes(e.system)) return { error: 'Mods : jeu Switch ou Switch 2 seulement' };
  const tid = emuMods.titleIdOf(e.romPath);
  if (!tid) return { error: 'Identifiant du jeu introuvable (ni dans le nom du fichier, ni dans main.npdm)' };
  const sys = emu.SYSTEMS.find(s => s.id === e.system);
  const emuId = e.emulatorId || sys.emus[0];
  const m = emuStore.installed(emuId) || emuStore.installed(sys.emus[0]);
  const own = (readJson(FILES.roms, {}).emulators || {})[emuId];
  const exe = m ? m.exe : own && own.path;
  if (!exe) return { error: `Installez d’abord ${emuStore.CATALOG[sys.emus[0]].name} (lancez le jeu une fois)` };
  return { tid, dir: emuMods.modsDir(path.dirname(exe), tid), emulator: (m && m.label) || (emuStore.CATALOG[emuId] || {}).name || emuId };
}

/**
 * Avant un lancement : jeu décompressé s'il est dans une archive que l'émulateur ne lit pas, BIOS
 * présents, cœur RetroArch téléchargé, réglages de l'émulateur à jour. Renvoie { blocked } (réponse
 * à donner à l'interface) ou { launch } (commande, avec le fichier décompressé à la place de l'archive).
 */
async function prepareRom(e, { fresh = false } = {}) {
  let launch = e.launch, gameFile = e.romPath;
  const id = e.emulatorId;
  // Émulateur en cours de mise à jour (arrivée dans Émulation) : le jeu attend la nouvelle version
  const updating = id && emuStore.pending(id);
  if (updating) await updating.catch(() => {});
  const m = id && emuStore.installed(id);
  const d = emuDirs();
  // BIOS d'abord : pas de décompression (parfois longue) pour un jeu qui ne pourrait pas démarrer
  const need = m && emuSetup.biosStatus(d.bios, e.system, { region: e.region });
  if (need && !need.ok) return { blocked: { ok: false, needsBios: need.what, error: `Il manque : ${need.what}` } };
  if (e.archive === 'extract') {
    const sys = emu.SYSTEMS.find(s => s.id === e.system);
    const opts = { m3u: ['psx', 'saturn', 'segacd', 'dreamcast', 'pcengine'].includes(e.system) };
    const file = sys && emuArchive.ready(e.romPath, sys.exts, opts);
    if (!file) return { blocked: { ok: false, needsExtract: { id: e.id, name: e.name } } };
    launch = { ...launch, args: launch.args.split(e.romPath).join(file) };
    gameFile = file;
  }
  // Image .iso d'un jeu Switch décompressé : montée comme un lecteur, son exefs/main est lancé
  if (e.archive === 'mount') {
    const sys = emu.SYSTEMS.find(s => s.id === e.system);
    try {
      const file = await emuMount.gameFile(e.romPath, [].concat(sys.dirGames || []));
      launch = { ...launch, args: launch.args.split(e.romPath).join(file) };
      gameFile = file;
    } catch (err) { return { blocked: { ok: false, error: `Montage de l’image impossible : ${err.message}` } }; }
  }
  // Jeu PlayStation européen protégé (LibCrypt) : son .sbi est récupéré chez Redump s'il manque
  if (e.system === 'psx') await emuSbi.ensure(gameFile).catch(() => 0);
  if (!m) return { launch }; // émulateur installé par l'utilisateur : réglages laissés tels quels
  if (id === 'retroarch') {
    const core = (/-L "([^"]+)"/.exec(launch.args || '') || [])[1];
    if (core) {
      try { await emuStore.ensureCore(core); }
      catch (err) { return { blocked: { ok: false, error: `Cœur ${path.basename(core, '_libretro.dll')} : ${err.message}` } }; }
    }
  }
  const set = emuEffective(e.system, e.id);
  const padList = PAD_EMUS.includes(id) ? await xinputPads() : [];
  emuSetup.prepare(id, path.dirname(m.exe), { bios: d.bios, saves: d.saves, system: e.system, aspect: set.aspect || 'auto', quality: set.quality, wide: set.wide === 'on', preset: set.preset, titleId: emuMods.titleIdOf(gameFile), pads: padList, ...emuDisplay });
  if (id === 'retroarch') {
    staleResume(e, launch.args);
    launch = { ...launch, args: launch.args + retroarchLook(path.dirname(m.exe), e.id, set, fresh) };
  }
  return { launch };
}

/**
 * Reprise automatique de RetroArch faite avec une autre commande (autre cœur, autre fichier du zip) :
 * elle ne correspond plus au jeu lancé et le figerait. Avant la 4.16, un zip à plusieurs fichiers
 * (Sonic & Knuckles + sa puce « Lock-on ») lançait la puce seule : écran noir, enregistré en reprise
 * sous le même nom que le vrai jeu, puis rechargé à chaque lancement. La commande est retenue par jeu ;
 * quand elle change (ou la première fois pour un fichier pris dans un zip), l'ancienne reprise est mise
 * de côté en « .bak » (pas supprimée).
 */
function staleResume(e, args) {
  const file = path.join(DATA, 'emu-ra', safeId(e.id) + '.sig');
  let prev = null;
  try { prev = fs.readFileSync(file, 'utf8'); } catch { /* jamais lancé avec ce suivi */ }
  if (prev === args) return 0;
  const moved = prev !== null || /#[^"]+"/.test(args) ? forgetResume(e, { backup: true }) : 0;
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, args); } catch { /* sans suivi */ }
  return moved;
}
const emuAutoUpdate = { at: 0 };
/**
 * Supprime les sauvegardes d'état automatiques (« .state.auto ») d'un jeu RetroArch ; renvoie leur
 * nombre. backup : renommées en « .state.auto.bak » au lieu d'être supprimées.
 */
function forgetResume(e, { backup = false } = {}) {
  const names = new Set();
  const base = f => path.basename(f, path.extname(f)).toLowerCase();
  if (e.romPath) names.add(base(e.romPath));
  const inner = /#([^"]+)"/.exec((e.launch && e.launch.args) || '');
  if (inner) names.add(base(inner[1]));
  // Jeu décompressé : le fichier donné à RetroArch (.cue, .m3u…)
  const sys = emu.SYSTEMS.find(s => s.id === e.system);
  if (e.archive === 'extract' && sys) { const f = emuArchive.ready(e.romPath, sys.exts, { m3u: true }); if (f) names.add(base(f)); }
  if (e.discs && e.romPath) names.add(base(e.romPath));
  const dir = path.join(emuDirs().saves, 'RetroArch', 'states');
  let removed = 0;
  const walk = d => {
    let list = [];
    try { list = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const x of list) {
      const p = path.join(d, x.name);
      if (x.isDirectory()) { walk(p); continue; }
      const m = /^(.*)\.state\.auto(\.png)?$/i.exec(x.name);
      if (m && names.has(m[1].toLowerCase())) {
        try { if (backup) fs.renameSync(p, p.replace(/(\.png)?$/i, '.bak$1')); else fs.unlinkSync(p); removed++; } catch { /* encore ouvert */ }
      }
    }
  };
  walk(dir);
  if (removed || !backup) console.log(`Émulation : reprise de ${e.name} ${backup ? 'mise de côté (.bak, faite avec une autre commande)' : 'oubliée'} (${removed} fichier(s))`);
  return removed;
}
// Manettes XInput branchées (host/xinput.ps1), relues au plus toutes les 15 s : les émulateurs qui
// ne prennent pas la manette tout seuls la reçoivent avant le lancement (emu-pads.js)
const PAD_EMUS = ['eden', 'lichii', 'lichiimod', 'edenns2', 'azahar', 'rpcs3', 'cemu', 'melonds'];
// Consoles dont l'émulateur peut s'ouvrir seul depuis la page d'un jeu (bouton « Ouvrir … seul »)
const EMU_ONLY_SYSTEMS = ['switch', 'switch2'];
const padCache = { at: 0, list: [] };
async function xinputPads() {
  if (Date.now() - padCache.at < 15e3) return padCache.list;
  let list = [];
  try { const r = await runPs('xinput.ps1'); list = JSON.parse(r.out || '[]'); } catch { list = []; }
  Object.assign(padCache, { at: Date.now(), list: Array.isArray(list) ? list : [list] });
  return padCache.list;
}
// Jeux ajoutés ou retirés dans le dossier : la bibliothèque suit sans scan manuel
let emuWatch = null, emuWatchTimer = null;
function watchEmuGames() {
  const dir = emuDirs().games;
  if (emuWatch && emuWatch.dir === dir) return;
  emuWatch?.w.close(); emuWatch = null;
  try {
    const w = fs.watch(dir, { recursive: true }, (ev, f) => {
      if (/LISEZ-MOI/i.test(String(f || ''))) return;
      clearTimeout(emuWatchTimer);
      emuWatchTimer = setTimeout(() => { console.log('Émulation : dossier de jeux modifié'); scanEmulation(); }, 2500);
    });
    w.on('error', () => { w.close(); emuWatch = null; });
    emuWatch = { dir, w };
  } catch (e) { console.error('Émulation : surveillance du dossier', e.message); }
}
// Empreinte des dossiers de jeux (noms, tailles, dates, trois niveaux) : la surveillance peut rater
// un changement (KaneMode fermé, mise à jour, erreur du système de fichiers), l'empreinte non
function emuGamesSig() {
  const parts = [];
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 3) walk(p, depth + 1); continue; }
      if (/^LISEZ-MOI\.txt$/i.test(e.name)) continue;
      try { const st = fs.statSync(p); parts.push(`${p}|${st.size}|${Math.floor(st.mtimeMs)}`); } catch { /* fichier en cours de copie */ }
    }
  };
  for (const r of [emuDirs().games, ...config().romRoots]) walk(r, 0);
  return crypto.createHash('sha1').update(parts.sort().join('\n')).digest('hex');
}
/** Recherche les jeux si les dossiers ont changé depuis la dernière recherche. */
function checkEmuGames(reason) {
  watchEmuGames();
  const sig = emuGamesSig();
  if ((readJson(FILES.roms, {}) || {}).sig === sig) return false;
  console.log(`Émulation : jeux ajoutés ou retirés (${reason})`);
  scanEmulation();
  return true;
}
function scanEmulation() {
  const cfg = config();
  const d = ensureEmuHome();
  const extra = cfg.romRoots.flatMap(r => [path.dirname(r), path.join(path.dirname(r), 'emulators'), path.join(path.dirname(r), 'Emulators')]);
  // Choisis à la main > installés par KaneMode > trouvés sur le PC
  const found = emu.detectEmulators(cfg.emulatorPaths, extra);
  const emulators = { ...found };
  for (const [id, m] of Object.entries(emuStore.emulators())) if (!found[id] || found[id].source !== 'manual') emulators[id] = m;
  const settings = emuSettings();
  const roms = emu.scanRoms([d.games, ...cfg.romRoots], emulators, cfg.emulatorPrefs, { m3uDir: path.join(DATA, 'emu-m3u'), settings });
  // Pas encore d'émulateur : celui que KaneMode installera au premier lancement
  for (const r of roms) {
    // Émulateur choisi par l'utilisateur, pas encore installé : KaneMode l'installera au lancement
    const want = emuEffective(r.system, r.id).emulator;
    if (want && r.emulatorId !== want && emuStore.CATALOG[want] && !emulators[want]) {
      Object.assign(r, { launch: null, emulatorId: null, core: null, installEmu: want, installed: true, emulator: emuStore.CATALOG[want].name });
      continue;
    }
    if (r.launch) continue;
    const sys = emu.SYSTEMS.find(s => s.id === r.system);
    const id = sys && sys.emus.find(e => emuStore.CATALOG[e]);
    if (id) { r.installEmu = id; r.installed = true; r.emulator = emuStore.CATALOG[id].name; }
  }
  const data = { generated: new Date().toISOString(), sig: emuGamesSig(), emulators, roms };
  writeJson(FILES.roms, data);
  version++;
  return data;
}

// ---------------------------------------------------------------- navigateur de fichiers
function browse(p, mode) {
  const exts = mode === 'image' ? IMAGE_EXT : mode === 'video' ? VIDEO_EXT : mode === 'audio' ? AUDIO_EXT : mode === 'dir' ? [] : mode === 'zip' ? ['.zip', '.7z', '.rar'] : RUN_EXT;
  if (!p) {
    const home = os.homedir();
    const places = [
      ['Bureau', path.join(home, 'Desktop')], ['Bureau', path.join(home, 'OneDrive', 'Desktop')], ['Bureau', path.join(home, 'OneDrive', 'Bureau')],
      ['Téléchargements', path.join(home, 'Downloads')], ['Documents', path.join(home, 'Documents')],
      ['Images', path.join(home, 'Pictures')], ['Images', path.join(home, 'OneDrive', 'Images')],
      ['Program Files', process.env.ProgramFiles], ['Program Files (x86)', process.env['ProgramFiles(x86)']],
    ].filter(([, d]) => d && fs.existsSync(d)).map(([name, d]) => ({ name, path: d, kind: 'place' }));
    const drives = [];
    for (let c = 67; c <= 90; c++) { const d = String.fromCharCode(c) + ':\\'; if (fs.existsSync(d)) drives.push({ name: `Disque ${d.slice(0, 2)}`, path: d, kind: 'drive' }); }
    return { path: '', parent: null, entries: [...places, ...drives] };
  }
  const dir = path.resolve(p);
  const entries = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (/^[$.]|^System Volume Information$|^desktop\.ini$/i.test(d.name)) continue;
    const full = path.join(dir, d.name);
    if (d.isDirectory()) entries.push({ name: d.name, path: full, kind: 'dir' });
    else if (exts.includes(path.extname(d.name).toLowerCase())) {
      let size = 0; try { size = fs.statSync(full).size; } catch { /* ignoré */ }
      entries.push({ name: d.name, path: full, kind: 'file', size });
    }
    if (entries.length > 3000) break;
  }
  entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }) : a.kind === 'dir' ? -1 : 1));
  const parent = path.dirname(dir) === dir ? '' : path.dirname(dir);
  return { path: dir, parent, entries };
}

// ---------------------------------------------------------------- système
let lastCpu = os.cpus();
function cpuPercent() {
  const now = os.cpus();
  let idle = 0, total = 0;
  now.forEach((c, i) => {
    const p = lastCpu[i] ? lastCpu[i].times : { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 };
    const t = c.times;
    const dt = (t.user - p.user) + (t.nice - p.nice) + (t.sys - p.sys) + (t.idle - p.idle) + (t.irq - p.irq);
    total += dt; idle += t.idle - p.idle;
  });
  lastCpu = now;
  return total ? Math.round(100 * (1 - idle / total)) : 0;
}

// ---------------------------------------------------------------- HTTP
/**
 * Envoie un flux de fichier. Sans écouteur d'erreur, un fichier supprimé ou verrouillé pendant l'envoi
 * (capture effacée alors que sa vignette se charge) levait une exception non gérée et arrêtait l'hôte.
 */
function pipeFile(res, stream) {
  stream.on('error', () => res.destroy());
  res.on('close', () => stream.destroy());
  stream.pipe(res);
}
function sendFile(res, file, req) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end(); }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range && type.startsWith('video/') && (range[1] || range[2])) { // lecture vidéo avec avance rapide
      // « bytes=-N » : les N derniers octets ; une fin trop grande est ramenée à la taille du fichier
      const start = range[1] ? +range[1] : Math.max(0, st.size - +range[2]);
      const end = range[1] && range[2] ? Math.min(+range[2], st.size - 1) : st.size - 1;
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      return pipeFile(res, fs.createReadStream(file, { start, end }));
    }
    // Empreinte (taille + date) : le navigateur garde le fichier et demande seulement s'il a changé
    // (réponse 304 sans contenu). Sans elle, chaque jaquette était retéléchargée à chaque affichage.
    const etag = `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
    // Les URLs des visuels portent leur révision ; retour de fiche sans requête supplémentaire.
    const cacheControl = req && req.url.startsWith('/art/') && req.url.includes('?') ? 'private, max-age=300' : 'no-cache';
    if (req && req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': cacheControl });
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': cacheControl, ETag: etag, 'Accept-Ranges': 'bytes' });
    pipeFile(res, fs.createReadStream(file));
  });
}
function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) { reject(new Error('trop gros')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(e); } });
  });
}
const localHost = req => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '');
// L'API peut lancer des programmes : elle n'accepte que des requêtes locales portant l'en-tête
// X-KaneMode (un site web tiers ne peut pas l'ajouter sans pré-vérification CORS, refusée ici).
const trusted = req => localHost(req) && req.headers['x-kanemode'] === '1';

const routes = {
  'GET /api/accounts': async (req, res) => json(res, 200, await accounts.status()),
  'POST /api/accounts/config': async (req, res) => {
    try { json(res, 200, await accounts.configure(await readBody(req))); }
    catch (error) { json(res, 400, { error: error.message }); }
  },
  'POST /api/accounts/sync': async (req, res) => {
    try { const b = await readBody(req); json(res, 200, await accounts.sync({ start: b.start === true })); }
    catch (error) { json(res, 400, { error: error.message }); }
  },
  'POST /api/accounts/open': async (req, res) => {
    try { const b = await readBody(req); json(res, 200, b.provider ? await accounts.action(b.provider, 'settings') : await accounts.open()); }
    catch (error) { json(res, 400, { error: error.message }); }
  },
  'POST /api/accounts/download': async (req, res) => json(res, 200, await run({ kind: 'uri', target: 'https://playnite.link/' })),
  'GET /api/dolby': async (req, res, q) => json(res, 200, await dolby.state(q.get('refresh') === '1')),
  'POST /api/dolby': async (req, res) => {
    const b = await readBody(req);
    try { json(res, 200, await dolby.set(b.device, b.mode)); }
    catch (error) { json(res, 400, { error: error.message }); }
  },
  'POST /api/dolby/open': async (req, res) => {
    const b = await readBody(req);
    try { json(res, 200, await dolby.open(b.action)); }
    catch (error) { json(res, 400, { error: error.message }); }
  },
  'GET /api/library': (req, res, q) => {
    const st = state(), cfg = config();
    const all = allEntries(q.get('demo') === '1');
    enqueueMeta([...all.games, ...all.pending]);
    json(res, 200, {
      generated: all.generated, version, sources: accounts.sources(),
      stream: { engine: !!kp.exe, hosts: kp.hosts.map(h => ({ uuid: h.uuid, name: h.name, paired: h.paired })) },
      games: all.games.map(g => publicEntry(g, st, cfg)),
      collections: st.collections,
      launchers: all.launchers.map(l => ({
        id: l.id, name: l.name, sub: l.sub, installed: !!l.installed,
        icon: str(l.art && l.art.icon) ? `/art/${encodeURIComponent('launcher:' + l.id)}/icon` : null,
      })),
    });
  },
  'GET /api/status': (req, res) => json(res, 200, { version, pending: queue.length + (busy ? 1 : 0) }),

  'POST /api/scan': async (req, res) => {
    const before = new Set(allEntries(false).games.map(g => g.id));
    const r = await runPs('scan.ps1', ['-DataDir', DATA]);
    if (r.code !== 0) return json(res, 500, { ok: false, error: r.err || 'échec du scan' });
    libLast = Date.now();
    watchStores();
    scanEmulation();
    await refreshKanePlay();
    await accounts.sync().catch(() => {}); // uniquement si la passerelle est déjà ouverte
    const after = allEntries(false).games;
    json(res, 200, { ok: true, count: after.length, added: after.filter(g => !before.has(g.id) && g.installed).map(g => g.name) });
  },

  // --- Configuration (la clé SteamGridDB n'est jamais renvoyée en clair)
  'GET /api/config': (req, res) => {
    const c = config();
    json(res, 200, {
      sgdb: { configured: true, key: !!c.sgdbKey, hint: c.sgdbKey ? '…' + c.sgdbKey.slice(-4) : null, auto: c.sgdbAuto, preferSteam: c.sgdbPreferSteam, style: c.sgdbStyle },
      romRoots: c.romRoots, emulatorPaths: c.emulatorPaths, emulatorPrefs: c.emulatorPrefs,
      bootVideo: c.bootVideo ? path.basename(c.bootVideo) : null, bootSound: c.bootSound ? c.bootSoundName || path.basename(c.bootSound) : null, bootSoundAt: c.bootSoundAt || 0,
      // Boutiques prêtes en arrière-plan (valeur effective, et si elle vient d'un choix de l'utilisateur)
      storesReady: storesReady(), storesReadyChosen: c.storesReady || {},
      storesAvailable: Object.fromEntries(Object.entries(STORE_BG).map(([id, s]) => [id, !!s.exe()])),
    });
  },
  'POST /api/config': async (req, res) => {
    const b = await readBody(req);
    const c = config();
    if ('sgdbKey' in b) {
      const key = str(b.sgdbKey) && b.sgdbKey.trim();
      if (key) {
        try { await sgdb.search(key, 'portal'); }
        catch (e) { return json(res, 400, { error: e.message }); }
      }
      c.sgdbKey = key || null;
      sgdbCache = {}; writeJson(FILES.sgdb, sgdbCache);
      for (const f of fs.readdirSync(ARTCACHE)) if (f.startsWith('sgdb_')) fs.rmSync(path.join(ARTCACHE, f), { force: true });
    }
    if ('bootSound' in b) {
      // Le son choisi est copié dans les données de KaneMode : il reste disponible même si
      // l'original est déplacé (Bureau, OneDrive…)
      const src = str(b.bootSound) && AUDIO_EXT.includes(path.extname(b.bootSound).toLowerCase()) && isFile(b.bootSound) ? b.bootSound : null;
      for (const f of fs.readdirSync(DATA)) if (/^bootsound\./i.test(f) && (!src || path.join(DATA, f) !== path.resolve(src))) fs.rmSync(path.join(DATA, f), { force: true });
      if (src) {
        const dest = path.join(DATA, 'bootsound' + path.extname(src).toLowerCase());
        if (path.resolve(src) !== dest) fs.copyFileSync(src, dest);
        c.bootSound = dest;
        c.bootSoundName = path.basename(src);
        c.bootSoundAt = Date.now();
      } else { c.bootSound = null; c.bootSoundName = null; }
    }
    if ('bootVideo' in b) c.bootVideo = str(b.bootVideo) && VIDEO_EXT.includes(path.extname(b.bootVideo).toLowerCase()) && isFile(b.bootVideo) ? b.bootVideo : null;
    if ('sgdbAuto' in b) c.sgdbAuto = !!b.sgdbAuto;
    // Couleur d'accent de l'interface, reprise par KanePlay
    if ('accent' in b && /^#[0-9a-f]{6}$/i.test(String(b.accent))) { c.accent = b.accent; setTimeout(refreshKanePlay, 0); }
    if (['square', 'soft', 'round'].includes(b.corners)) c.corners = b.corners;
    // Langue de l'interface : reprise par les widgets Game Bar et le moteur de streaming
    if ('lang' in b && LANGS.includes(b.lang)) { c.lang = b.lang; setTimeout(refreshKanePlay, 0); }
    if (typeof b.sounds === 'boolean') c.sounds = b.sounds;
    if (typeof b.soundMoves === 'boolean') c.soundMoves = b.soundMoves;
    if (['round', 'retro', 'soft'].includes(b.soundTheme)) c.soundTheme = b.soundTheme;
    if (Number.isFinite(b.soundVolume)) c.soundVolume = Math.max(0, Math.min(100, b.soundVolume));
    if ('sgdbPreferSteam' in b) c.sgdbPreferSteam = !!b.sgdbPreferSteam;
    if ('sgdbStyle' in b) { c.sgdbStyle = ['', 'alternate', 'blurred', 'white_logo', 'material', 'no_logo'].includes(b.sgdbStyle) ? b.sgdbStyle : ''; version++; }
    if (Array.isArray(b.romRoots)) c.romRoots = [...new Set(b.romRoots.filter(r => str(r) && fs.existsSync(r)))];
    if (b.emulatorPaths && typeof b.emulatorPaths === 'object') {
      for (const [k, v] of Object.entries(b.emulatorPaths)) { if (str(v) && isFile(v)) c.emulatorPaths[k] = v; else delete c.emulatorPaths[k]; }
    }
    if (b.emulatorPrefs && typeof b.emulatorPrefs === 'object') Object.assign(c.emulatorPrefs, b.emulatorPrefs);
    // Boutiques prêtes en arrière-plan : { steam: true|false }, activée tout de suite si elle ne tourne pas
    if (b.storesReady && typeof b.storesReady === 'object') {
      c.storesReady = { ...(c.storesReady || {}) };
      for (const [id, on] of Object.entries(b.storesReady)) if (STORE_BG[id] && typeof on === 'boolean') {
        c.storesReady[id] = on;
        if (on) setTimeout(() => startStoreSilently(id, { wait: false }).catch(() => {}), 0);
      }
    }
    writeJson(FILES.config, c);
    if (b.romRoots || b.emulatorPaths || b.emulatorPrefs) scanEmulation();
    version++;
    json(res, 200, { ok: true });
  },

  // --- Émulation
  'GET /api/emulation': (req, res) => {
    const cfg = config();
    const data = readJson(FILES.roms, null) || scanEmulation();
    const counts = {};
    for (const r of data.roms || []) counts[r.system] = (counts[r.system] || 0) + 1;
    json(res, 200, {
      romRoots: cfg.romRoots, prefs: cfg.emulatorPrefs, scanned: data.generated,
      systems: emu.SYSTEMS.map(s => ({ id: s.id, name: s.name, maker: s.maker, folder: s.folders[0], exts: s.exts, emus: s.emus, count: counts[s.id] || 0 })),
      emulators: emu.EMULATORS.map(e => ({
        id: e.id, name: e.name, path: (data.emulators[e.id] || {}).path || null, source: (data.emulators[e.id] || {}).source || null,
        systems: emu.SYSTEMS.filter(s => s.emus.includes(e.id)).map(s => s.name),
      })),
    });
  },
  // Monde Émulation : consoles et leurs jeux, émulateurs gérés, dossiers
  'GET /api/emu/world': async (req, res, q) => {
    const d = ensureEmuHome();
    checkEmuGames('ouverture du monde Émulation');
    const data = readJson(FILES.roms, null) || scanEmulation();
    const counts = {};
    for (const r of data.roms || []) counts[r.system] = (counts[r.system] || 0) + 1;
    const emulators = await emuStore.list({ check: q.get('check') === '1' });
    json(res, 200, {
      dirs: d, romRoots: config().romRoots, scanned: data.generated,
      systems: emu.SYSTEMS.map(s => {
        const managed = s.emus.find(e => emuStore.CATALOG[e]) || null;
        const own = Object.entries(data.emulators || {}).find(([id]) => s.emus.includes(id));
        return {
          id: s.id, name: s.name, maker: s.maker, folder: path.join(d.games, s.name), exts: s.exts, count: counts[s.id] || 0,
          experimental: !!s.experimental, emulator: managed, emulatorName: managed ? emuStore.CATALOG[managed].name : null,
          ready: !!own, bios: emuSetup.biosStatus(d.bios, s.id),
          // Version modifiée (installée depuis un .zip) : proposée seulement une fois installée
          emus: s.emus.filter(e => (emuStore.CATALOG[e] && (!emuStore.CATALOG[e].local || emuStore.installed(e))) || (data.emulators || {})[e])
            .map(e => ({ id: e, name: (emuStore.installed(e) || {}).label || (emuStore.CATALOG[e] || emu.EMULATORS.find(x => x.id === e)).name })),
          cores: s.cores || [], settings: emuSettings().systems[s.id] || {},
        };
      }),
      emulators, jobs: emuStore.jobs(), cacheBytes: emuArchive.usage(),
    });
  },
  'GET /api/emu/jobs': (req, res) => json(res, 200, { jobs: [...emuStore.jobs(), ...emuArchive.jobs()] }),
  // Jeu dans une archive : décompressé dans le cache, l'interface suit /api/emu/jobs puis relance
  'POST /api/emu/extract': async (req, res) => {
    const b = await readBody(req);
    const e = findEntry(String(b.id || ''));
    if (!e || e.archive !== 'extract') return json(res, 400, { error: 'Ce jeu n’a pas besoin d’être décompressé' });
    const sys = emu.SYSTEMS.find(s => s.id === e.system);
    emuArchive.extract(e.id, e.name, e.romPath, sys.exts, { m3u: ['psx', 'saturn', 'segacd', 'dreamcast', 'pcengine'].includes(e.system) }).catch(() => { /* erreur gardée dans la tâche */ });
    json(res, 200, { ok: true });
  },
  // Réglages d'un jeu ou d'une console ; une valeur null revient au réglage de la console / par défaut
  'GET /api/emu/settings': (req, res, q) => {
    const s = emuSettings();
    // Jeu Switch : ce que le Preset IA choisit sur cette machine, pour l'afficher
    const e = q.get('id') ? findEntry(q.get('id')) : null;
    const ia = e && e.source === 'rom' && EMU_ONLY_SYSTEMS.includes(e.system)
      ? emuPresets.iaPreset({ variant: e.system === 'switch' ? 'eden' : e.emulatorId === 'edenns2' ? 'edenns2' : 'lichii', titleId: emuMods.titleIdOf(e.romPath), ...emuDisplay }) : null;
    json(res, 200, { system: s.systems[q.get('system')] || {}, game: s.games[q.get('id')] || {}, defaults: emuDefaults(q.get('system')), ia: ia && { summary: ia.summary, game: ia.game } });
  },
  'POST /api/emu/settings': async (req, res) => {
    const b = await readBody(req);
    const scope = b.scope === 'system' ? 'systems' : 'games';
    const key = String(b.id || '');
    if (!key || (scope === 'systems' && !emu.SYSTEMS.some(s => s.id === key)) || (scope === 'games' && !findEntry(key))) return json(res, 400, { error: 'Jeu ou console inconnu' });
    const c = readJson(FILES.config, {});
    const all = c.emuSettings = { systems: {}, games: {}, ...(c.emuSettings || {}) };
    const cur = { ...(all[scope][key] || {}) };
    for (const [k, v] of Object.entries(b.values || {})) {
      if (!EMU_SETTING_KEYS[k]) continue;
      if (v === null || v === undefined || v === '') delete cur[k];
      else if (EMU_SETTING_KEYS[k](v)) cur[k] = v;
    }
    if (Object.keys(cur).length) all[scope][key] = cur; else delete all[scope][key];
    writeJson(FILES.config, c);
    scanEmulation();
    json(res, 200, { ok: true, values: cur });
  },
  // Arrivée dans le monde Émulation : les émulateurs installés qui ont une nouvelle version se
  // mettent à jour en arrière-plan (sauf ceux qui sont ouverts), au plus toutes les 10 minutes
  'POST /api/emu/autoupdate': async (req, res) => {
    if (Date.now() - emuAutoUpdate.at < 10 * 60e3) return json(res, 200, { ok: true, updating: [], skipped: 'recent' });
    emuAutoUpdate.at = Date.now();
    let list = [];
    try { list = await emuStore.list({ check: true }); } catch { /* hors ligne */ }
    const todo = [];
    for (const e of list.filter(x => x.update)) {
      const m = emuStore.installed(e.id);
      if (m && await processOpen(path.basename(m.exe, '.exe'))) continue;
      todo.push(e);
    }
    (async () => {
      for (const e of todo) {
        try { await emuStore.install(e.id); scanEmulation(); console.log(`Émulation : ${e.name} mis à jour (${e.version} → ${e.latest})`); }
        catch { /* erreur gardée dans la tâche */ }
      }
    })();
    json(res, 200, { ok: true, updating: todo.map(e => ({ id: e.id, name: e.name, from: e.version, to: e.latest })) });
  },
  // Version modifiée d'un émulateur (Lichii-Frizti…) depuis une archive choisie par l'utilisateur
  'POST /api/emu/install-local': async (req, res) => {
    const b = await readBody(req);
    const c = emuStore.CATALOG[b.id];
    if (!c || !c.local) return json(res, 400, { error: 'Émulateur inconnu' });
    try { const m = await emuStore.installLocal(b.id, String(b.path || '')); scanEmulation(); json(res, 200, { ok: true, version: m.version, name: m.label }); }
    catch (err) { json(res, 400, { error: err.message }); }
  },
  // Mods d'un jeu Switch ou Switch 2 : <émulateur>\user\load\<identifiant du jeu>
  'GET /api/emu/mods': (req, res, q) => {
    const r = modsTarget(q.get('id'));
    if (r.error) return json(res, 400, r);
    json(res, 200, { titleId: r.tid, dir: r.dir, emulator: r.emulator, mods: emuMods.list(r.dir) });
  },
  'POST /api/emu/mods/add': async (req, res) => {
    const b = await readBody(req);
    const r = modsTarget(b.id);
    if (r.error) return json(res, 400, r);
    try { const added = await emuMods.add(r.dir, String(b.path || '')); json(res, 200, { ok: true, added, mods: emuMods.list(r.dir) }); }
    catch (err) { json(res, 400, { error: err.message }); }
  },
  'POST /api/emu/mods/remove': async (req, res) => {
    const b = await readBody(req);
    const r = modsTarget(b.id);
    if (r.error) return json(res, 400, r);
    try { emuMods.remove(r.dir, String(b.name || '')); json(res, 200, { ok: true, mods: emuMods.list(r.dir) }); }
    catch (err) { json(res, 400, { error: err.message }); }
  },
  'POST /api/emu/mods/open': async (req, res) => {
    const b = await readBody(req);
    const r = modsTarget(b.id);
    if (r.error) return json(res, 400, r);
    fs.mkdirSync(r.dir, { recursive: true });
    spawn('explorer.exe', [r.dir], { detached: true, stdio: 'ignore' }).unref();
    json(res, 200, { ok: true, dir: r.dir });
  },
  'POST /api/emu/cache/clear': (req, res) => json(res, 200, { ok: true, freed: emuArchive.clear() }),
  // Fiche d'un jeu rétro : développeur, éditeur, genre, année, joueurs, description
  'GET /api/emu/game': async (req, res, q) => {
    const e = findEntry(q.get('id') || '');
    if (!e || e.source !== 'rom') return json(res, 404, { error: 'Jeu inconnu' });
    json(res, 200, { meta: await emuMeta.meta(e).catch(() => null) });
  },
  'POST /api/emu/install': async (req, res) => {
    const b = await readBody(req);
    const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).filter(id => emuStore.CATALOG[id]);
    if (!ids.length) return json(res, 400, { error: 'Émulateur inconnu' });
    // Un à la fois (téléchargements lourds), la bibliothèque est refaite après chacun
    (async () => { for (const id of ids) { try { await emuStore.install(id); scanEmulation(); } catch { /* erreur gardée dans la tâche */ } } })();
    json(res, 200, { ok: true });
  },
  'POST /api/emu/open': async (req, res) => {
    const b = await readBody(req);
    const d = ensureEmuHome();
    const sys = emu.SYSTEMS.find(s => s.id === b.system);
    const dir = sys ? path.join(d.games, sys.name) : b.what === 'bios' ? d.bios : b.what === 'saves' ? d.saves : b.what === 'home' ? d.home : d.games;
    spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
    json(res, 200, { ok: true, dir });
  },
  'POST /api/roms/scan': (req, res) => {
    const r = scanEmulation();
    json(res, 200, { ok: true, count: r.roms.length, playable: r.roms.filter(x => x.installed).length, emulators: Object.keys(r.emulators).length });
  },

  // --- SteamGridDB
  'GET /api/sgdb/game': async (req, res, q) => {
    const c = config();
    const e = findEntry(q.get('id') || '');
    if (!e) return json(res, 404, { error: 'Entrée inconnue' });
    try { json(res, 200, { configured: true, game: await sgdbGameFor(e, c.sgdbKey) }); }
    catch (err) { json(res, 502, { error: err.message }); }
  },
  'GET /api/sgdb/search': async (req, res, q) => {
    try { json(res, 200, await sgdb.search(config().sgdbKey, q.get('term') || '')); }
    catch (err) { json(res, 502, { error: err.message }); }
  },
  'GET /api/sgdb/assets': async (req, res, q) => {
    try { json(res, 200, await sgdb.assets(config().sgdbKey, +q.get('game'), q.get('kind'), { style: q.get('style') || (q.get('kind') === 'portrait' ? config().sgdbStyle : ''), firstPage: q.get('first') === '1' })); }
    catch (err) { json(res, 502, { error: err.message }); }
  },
  'POST /api/sgdb/match': async (req, res) => {
    const b = await readBody(req);
    sgdbCache[b.id] = b.game && b.game.id ? { id: +b.game.id, name: String(b.game.name || '') } : null;
    writeJson(FILES.sgdb, sgdbCache);
    for (const f of fs.readdirSync(ARTCACHE)) if (f.startsWith(`sgdb_${safeId(b.id)}_`)) fs.rmSync(path.join(ARTCACHE, f), { force: true });
    version++;
    json(res, 200, { ok: true });
  },
  // --- Site de Nintendo (jeux Switch et Switch 2)
  'GET /api/nintendo/game': async (req, res, q) => {
    const e = findEntry(q.get('id') || '');
    if (!e) return json(res, 404, { error: 'Entrée inconnue' });
    try { json(res, 200, { game: await nintendo.gameFor(e) }); }
    catch (err) { json(res, 502, { error: err.message }); }
  },
  'GET /api/nintendo/search': async (req, res, q) => {
    const e = findEntry(q.get('id') || '');
    try { json(res, 200, await nintendoLib.search(q.get('term') || '', e && e.system)); }
    catch (err) { json(res, 502, { error: err.message }); }
  },
  'GET /api/nintendo/assets': async (req, res, q) => {
    const e = findEntry(q.get('id') || '');
    if (!e) return json(res, 404, { error: 'Entrée inconnue' });
    try { json(res, 200, await nintendo.assets(await nintendo.gameFor(e), q.get('kind'))); }
    catch (err) { json(res, 502, { error: err.message }); }
  },
  'POST /api/nintendo/match': async (req, res) => {
    const b = await readBody(req);
    if (!findEntry(String(b.id || ''))) return json(res, 404, { error: 'Entrée inconnue' });
    nintendo.setMatch(String(b.id), b.game || null);
    for (const f of fs.readdirSync(ARTCACHE)) if (f.startsWith(`nin_${safeId(b.id)}_`)) fs.rmSync(path.join(ARTCACHE, f), { force: true });
    version++;
    json(res, 200, { ok: true });
  },
  'POST /api/art/choose': async (req, res) => {
    const b = await readBody(req);
    if (!ART_KINDS.includes(b.kind) || !findEntry(String(b.id || ''))) return json(res, 400, { error: 'Requête invalide' });
    try {
      const url = String(b.url || '');
      const img = nintendoLib.isNintendoUrl(url) ? await nintendoLib.download(url) : await sgdb.download(url);
      const dir = path.join(ART, safeId(b.id));
      fs.mkdirSync(dir, { recursive: true });
      for (const f of fs.readdirSync(dir)) if (f.startsWith(b.kind + '.')) fs.rmSync(path.join(dir, f), { force: true });
      const file = path.join(dir, b.kind + img.ext);
      fs.writeFileSync(file, img.data);
      setArtOverride(b.id, b.kind, file);
      json(res, 200, { ok: true });
    } catch (err) { json(res, 502, { error: err.message }); }
  },
  'POST /api/art/local': async (req, res) => {
    const b = await readBody(req);
    if (!ART_KINDS.includes(b.kind) || !findEntry(String(b.id || '')) || !isImage(b.path)) return json(res, 400, { error: 'Image invalide' });
    setArtOverride(b.id, b.kind, b.path);
    json(res, 200, { ok: true });
  },
  'POST /api/art/reset': async (req, res) => {
    const b = await readBody(req);
    const id = String(b.id || '');
    // kind « all » : annule tous les choix de l'utilisateur pour ce jeu
    for (const k of b.kind === 'all' ? ART_KINDS : [b.kind]) setArtOverride(id, k, null);
    json(res, 200, { ok: true });
  },
  // Récupérer à nouveau : oublie les visuels automatiques en cache (Steam et SteamGridDB) et l'association
  'POST /api/art/refetch': async (req, res) => {
    const b = await readBody(req);
    const e = findEntry(String(b.id || ''));
    if (!e) return json(res, 404, { error: 'Entrée inconnue' });
    const steamId = e.steamAppId || (meta[e.id] || {}).steamId;
    const game = sgdbCache[e.id];
    if (game) sgdb.forget(game.id);
    if (!b.keepMatch) { delete sgdbCache[e.id]; writeJson(FILES.sgdb, sgdbCache); }
    const prefixes = [`sgdb_${safeId(e.id)}_`, `nin_${safeId(e.id)}_`, ...(steamId ? [`${steamId}_`] : [])];
    for (const f of fs.readdirSync(ARTCACHE)) if (prefixes.some(p => f.startsWith(p))) fs.rmSync(path.join(ARTCACHE, f), { force: true });
    const st = state();
    st.artRev = { ...(st.artRev || {}), [e.id]: ((st.artRev || {})[e.id] || 1) + 1 };
    writeJson(FILES.state, st);
    version++;
    json(res, 200, { ok: true });
  },

  // --- Programmes, fichiers, ajouts perso
  'GET /api/programs': async (req, res, q) => {
    if (q.get('refresh') === '1' || !isFile(FILES.programs)) await runPs('programs.ps1', ['-DataDir', DATA]);
    const custom = readJson(FILES.custom, []);
    const targets = new Set(custom.map(c => c.launch && c.launch.target));
    const names = new Set(allEntries(false).games.map(g => normName(g.name)));
    json(res, 200, readJson(FILES.programs, []).map(p => ({
      name: p.name, target: p.target, store: !!p.store,
      icon: str(p.icon) ? '/icons/' + path.basename(p.icon) : null,
      inLibrary: targets.has(p.target) || names.has(normName(p.name)),
    })));
  },
  'GET /api/browse': (req, res, q) => {
    try { json(res, 200, browse(q.get('path') || '', q.get('mode') || 'exe')); }
    catch { json(res, 400, { error: 'Dossier inaccessible' }); }
  },
  'POST /api/custom': async (req, res) => {
    const b = await readBody(req);
    const target = str(b.launch && b.launch.target);
    if (!str(b.name) || !target) return json(res, 400, { error: 'Nom et cible requis' });
    const custom = readJson(FILES.custom, []);
    const id = str(b.id) && b.id.startsWith('custom:') ? b.id : 'custom:' + crypto.randomUUID().slice(0, 8);
    const prev = custom.find(c => c.id === id) || {};
    const ext = path.extname(target).toLowerCase();
    const kind = isUri(target) ? 'uri' : ext === '.exe' ? 'exe' : 'file';
    const art = { ...(prev.art || {}) };
    for (const k of ['portrait', 'hero']) if (b.art && k in b.art) art[k] = isImage(b.art[k]) ? b.art[k] : null;
    const givenIcon = str(b.icon) && b.icon.startsWith('/icons/') ? path.join(ICONS, path.basename(b.icon)) : null;
    if (givenIcon && isFile(givenIcon)) art.icon = givenIcon;
    else if (!art.icon || (prev.launch && prev.launch.target !== target)) {
      art.icon = kind !== 'uri' || target.startsWith('shell:') ? (await runPs('icon.ps1', ['-Path', target, '-OutDir', ICONS])).out.split(/\r?\n/).pop() || null : null;
      if (art.icon && !isFile(art.icon)) art.icon = null;
    }
    const entry = {
      id, source: 'custom', name: b.name.trim().slice(0, 120), type: b.type === 'app' ? 'app' : 'game',
      lastPlayed: prev.lastPlayed || 0, sizeOnDisk: 0, addedAt: prev.addedAt || Date.now(),
      installDir: kind === 'uri' ? null : path.dirname(target),
      launch: { kind, target, args: str(b.launch.args) || '' }, art,
    };
    writeJson(FILES.custom, [...custom.filter(c => c.id !== id), entry]);
    delete meta[id];
    version++;
    json(res, 200, publicEntry({ ...entry, installed: true }, state(), config()));
  },
  'DELETE /api/custom': (req, res, q) => {
    const id = q.get('id');
    writeJson(FILES.custom, readJson(FILES.custom, []).filter(c => c.id !== id));
    version++;
    json(res, 200, { ok: true });
  },
  'POST /api/library/remove': async (req, res) => {
    const b = await readBody(req), entry = findEntry(String(b.id || ''));
    try {
      writeJson(FILES.state, libraryRemoval.update(state(), entry, b.removed));
      version++;
      json(res, 200, { ok: true });
    } catch (error) { json(res, 400, { ok: false, error: error.message }); }
  },
  'POST /api/override': async (req, res) => {
    const b = await readBody(req);
    const st = state();
    const o = st.overrides[b.id] = { ...(st.overrides[b.id] || {}) };
    if ('type' in b) o.type = b.type === 'app' ? 'app' : b.type === 'game' ? 'game' : undefined;
    if ('hidden' in b) o.hidden = !!b.hidden;
    writeJson(FILES.state, st);
    json(res, 200, { ok: true });
  },

  // --- Collections
  'POST /api/collections': async (req, res) => {
    const b = await readBody(req);
    const st = state();
    let c = st.collections.find(x => x.id === b.collection);
    if (b.action === 'create') {
      c = { id: crypto.randomUUID().slice(0, 8), name: String(b.name || 'Collection').slice(0, 40), ids: b.entryId ? [b.entryId] : [] };
      st.collections.push(c);
    } else if (!c) return json(res, 404, { error: 'Collection inconnue' });
    else if (b.action === 'rename') c.name = String(b.name || c.name).slice(0, 40);
    else if (b.action === 'delete') st.collections = st.collections.filter(x => x !== c);
    else if (b.action === 'toggle') c.ids = c.ids.includes(b.entryId) ? c.ids.filter(i => i !== b.entryId) : [...c.ids, b.entryId];
    writeJson(FILES.state, st);
    version++;
    json(res, 200, { ok: true, collections: st.collections, id: c && c.id });
  },

  // --- Lancement
  'POST /api/launch': async (req, res) => {
    const b = await readBody(req);
    const id = String(b.id || '');
    let e = findEntry(id);
    if (!e) return json(res, 404, { ok: false, error: 'Entrée inconnue' });
    if (e.demo) return json(res, 200, { ok: false, demo: true, error: 'Entrée de démonstration' });
    if (e.source === 'rom' && !e.launch) {
      // Premier jeu de cette console : l'interface installe l'émulateur puis relance
      const c = e.installEmu && emuStore.CATALOG[e.installEmu];
      if (c) return json(res, 200, { ok: false, needsEmulator: { id: e.installEmu, name: c.name, size: c.size } });
      return json(res, 200, { ok: false, error: `Aucun émulateur trouvé pour ${e.systemName}` });
    }
    // emuOnly : l'émulateur du jeu (Eden, Lichii…) ouvert seul, pour régler ou lancer à la main
    // (File → Load folder). Mêmes réglages et manette, suivi par KaneMode, pas de temps de jeu compté.
    const emuOnly = !!b.emuOnly && e.source === 'rom' && EMU_ONLY_SYSTEMS.includes(e.system);
    if (e.source === 'rom' && !b.dry) {
      const prep = await prepareRom(e, { fresh: !!b.fresh });
      if (prep.blocked) return json(res, 200, prep.blocked);
      e = { ...e, launch: emuOnly ? { ...prep.launch, args: '' } : prep.launch };
    }
    if (!b.dry && e.installed !== false && !id.startsWith('launcher:')) {
      const last = recentLaunch.get(emuOnly ? id + ':emu' : id);
      if (last && Date.now() - last < LAUNCH_GUARD) {
        console.log(`Lancement ignoré, déjà demandé il y a ${Math.round((Date.now() - last) / 1000)} s : ${e.name}`);
        return json(res, 200, { ok: true, already: true });
      }
      if (e.steamAppId && await steamRunningApp() === +e.steamAppId) {
        console.log(`Lancement ignoré, le jeu tourne déjà : ${e.name}`);
        return json(res, 200, { ok: true, running: true });
      }
    }
    console.log(emuOnly ? `Lancement : ${e.emulator || 'émulateur'} seul (depuis ${e.name})` : `Lancement : ${e.name} (${id})`);
    // Jeu Steam et Steam fermé : il démarre d'abord sans sa fenêtre (en mode Xbox, elle passait devant le jeu)
    if (!b.dry && /^steam:\/\/rungameid\//i.test(str(e.launch && e.launch.target))) await startSteamSilently();
    // Jeu d'un PC hôte : le lancement ne dure qu'un instant (la commande passe à l'écran de streaming)
    const r = e.launch?.kind === 'account'
      ? b.dry ? { ok: true, dry: true, mode: e.installed === false ? 'install' : 'start' }
        : await accounts.action(e.bridge.id, e.installed === false ? 'install' : 'start')
      : await run(e.launch, { dry: !!b.dry, onExit: m => !emuOnly && e.source !== 'kaneplay' && m > 0.2 && addMinutes(id, m) });
    if (r.ok && !b.dry && e.installed !== false) { if (!emuOnly) recordPlay(id); if (!id.startsWith('launcher:')) recentLaunch.set(emuOnly ? id + ':emu' : id, Date.now()); }
    if (r.ok && !b.dry && e.installed !== false) Promise.resolve(autoHdr.started({ ...e, type: hdrType(e) })).catch(err => console.error('HDR automatique :', err.message));
    // Mode de performance propre au jeu (menu du jeu) : appliqué au lancement, il devient le mode en cours
    const gm = (config().gameModes || {})[id];
    if (r.ok && !b.dry && PERF_MODES.includes(gm) && config().perfMode !== gm) {
      try {
        keeperQuiet();
        const res2 = await sysctl.apply(await expandProfile({ mode: gm }));
        if (!res2.errors.length || res2.done.length) { setPerfMode(gm); console.log(`Mode ${gm} appliqué pour ${e.name}`); }
        keeperQuiet();
      } catch (err) { console.error('Mode du jeu :', err.message); }
    }
    // Armoury Crate SE applique ses profils par jeu au lancement : le mode choisi est remis ensuite
    if (r.ok && !b.dry) for (const t of [8000, 25000]) setTimeout(() => keepPerf('jeu lancé'), t);
    json(res, 200, r);
  },
  // Widget Game Bar : version de KaneMode et Lossless Scaling (installé par Steam, lancé ou non)
  'GET /api/widget': async (req, res) => {
    const version = (() => { try { return fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8').trim(); } catch { return null; } })();
    const ls = allEntries(false).byId.get('steam:993090');
    // Lossless Scaling ouvert ? Seulement s'il est installé, et gardé 15 s (tasklist est un programme
    // à lancer, coûteux par-dessus un jeu)
    if (ls && (!losslessCheck.p || Date.now() - losslessCheck.t > 15000)) {
      losslessCheck.t = Date.now();
      losslessCheck.p = new Promise(resolve => execFile('tasklist.exe', ['/FI', 'IMAGENAME eq LosslessScaling.exe', '/NH'], { windowsHide: true, timeout: 4000 },
        (err, out) => resolve(!err && /LosslessScaling\.exe/i.test(out))));
    }
    const running = ls ? await losslessCheck.p : false;
    json(res, 200, { version, accent: config().accent || null, lang: config().lang || null, lossless: ls || running ? { installed: !!ls, running, id: ls ? ls.id : null } : null });
  },
  // Retour sur KaneMode (après un jeu, Steam, le bureau) : nouvelle analyse, au plus une par minute
  'POST /api/library/refresh': (req, res) => {
    // Même un retour très rapide après installation doit entraîner une analyse, éventuellement différée.
    rescanSoon('retour sur KaneMode', Math.max(500, 10000 - (Date.now() - libLast)));
    // Une installation par un connecteur doit passer à « Jouer » au retour, sans attendre 15 min.
    accounts.sync().catch(() => {});
    // PC de streaming appairés (retour de KanePlay) : relus ici plutôt que chaque minute
    if (Date.now() - kpLast > 30e3) refreshKanePlay();
    json(res, 200, { ok: true });
  },
  // Le jeu s'est fermé (KaneMode l'a vu) : on peut le relancer tout de suite
  // Jeu quitté « complètement » (Select + Start maintenus 3 s) : la reprise automatique de RetroArch
  // est effacée, le jeu repart du début au prochain lancement (ses propres sauvegardes restent)
  'POST /api/emu/forget-resume': async (req, res) => {
    const b = await readBody(req);
    const e = findEntry(String(b.id || ''));
    if (!e || e.source !== 'rom') return json(res, 404, { ok: false, error: 'Jeu inconnu' });
    json(res, 200, { ok: true, removed: forgetResume(e) });
  },
  'POST /api/launch/ended': async (req, res) => {
    const b = await readBody(req);
    recentLaunch.delete(String(b.id || ''));
    Promise.resolve(autoHdr.ended(String(b.id || ''))).catch(err => console.error('HDR automatique :', err.message));
    json(res, 200, { ok: true });
  },
  // Fond d'écran du lancement : une image « hero » du jeu tirée au hasard sur SteamGridDB
  'GET /api/launch/wallpaper': async (req, res, q) => {
    const e = findEntry(q.get('id') || '');
    if (!e) return json(res, 404, { url: null });
    try {
      const cfg = config();
      const game = await sgdbGameFor(e, cfg.sgdbKey);
      const list = game ? (await sgdb.assets(cfg.sgdbKey, game.id, 'hero')).slice(0, 24) : [];
      json(res, 200, { url: list.length ? list[Math.floor(Math.random() * list.length)].url : null });
    } catch { json(res, 200, { url: null }); } // hors ligne : le fond local suffit
  },
  'POST /api/open': async (req, res) => {
    const b = await readBody(req);
    const e = findEntry(String(b.id || ''));
    if (!e) return json(res, 404, { ok: false });
    const steamId = e.steamAppId || (meta[e.id] || {}).steamId;
    let target = null;
    if (b.what === 'folder') target = str(e.installDir);
    else if (b.what === 'store' && steamId) target = `steam://store/${steamId}`;
    else if (b.what === 'details' && e.steamAppId) target = `steam://nav/games/details/${e.steamAppId}`;
    else if (b.what === 'uninstall' && e.steamAppId && e.installed !== false) target = `steam://uninstall/${e.steamAppId}`;
    if (!target || (b.what === 'folder' && !fs.existsSync(target))) return json(res, 400, { ok: false, error: 'Rien à ouvrir' });
    json(res, 200, await run({ kind: b.what === 'folder' ? 'folder' : 'uri', target }, { dry: !!b.dry }));
  },

  // --- Système
  // Pages des Paramètres Windows utiles à KaneMode (liste fermée).
  'POST /api/open-settings': async (req, res) => {
    const b = await readBody(req);
    const uri = {
      xbox: 'ms-settings:gaming-fullscreen', startup: 'ms-settings:startupapps', gaming: 'ms-settings:gaming-gamebar',
      power: 'ms-settings:powersleep', battery: 'ms-settings:batterysaver', update: 'ms-settings:windowsupdate',
      'optional-updates': 'ms-settings:windowsupdate-optionalupdates', bluetooth: 'ms-settings:bluetooth', display: 'ms-settings:display',
      location: 'ms-settings:privacy-location', wifi: 'ms-settings:network-wifi',
    }[b.page];
    if (!uri) return json(res, 400, { error: 'Page inconnue' });
    json(res, 200, await run({ kind: 'uri', target: uri }));
  },
  // Veille, redémarrage, extinction : volontairement simulés dans le prototype.
  'POST /api/action': async (req, res) => { const b = await readBody(req); json(res, 200, { ok: true, simulated: true, action: b.action }); },
  'POST /api/exit': async (req, res) => {
    const b = await readBody(req);
    const steps = await sys.toDesktop(EDGE_PROFILE, !!b.dry);
    // Limite d'images des jeux remise dans le pilote avant l'arrêt (levée tant que KaneMode était devant)
    if (!b.dry) { fpsScope.front = false; await Promise.race([applyFpsScope().catch(() => {}), new Promise(r => setTimeout(r, 1500))]); }
    json(res, 200, { ok: true, steps, dry: !!b.dry });
    if (!b.dry) setTimeout(() => process.exit(0), 700);
  },
  'GET /api/system': (req, res) => json(res, 200, {
    cpu: cpuPercent(), memUsed: os.totalmem() - os.freemem(), memTotal: os.totalmem(),
    uptime: os.uptime(), os: `Windows ${os.release()}`, cpuName: (os.cpus()[0] || {}).model || '', cores: os.cpus().length,
    node: process.version, dataDir: DATA,
  }),
  'GET /api/xboxmode': async (req, res) => json(res, 200, await sys.xboxMode()),

  // --- Appareil : console portable, écran, batterie, pilotes
  'GET /api/device': async (req, res, q) => json(res, 200, await device.info({ simulate: q.get('simulate') || '', force: q.get('refresh') === '1' })),
  'POST /api/device/open': async (req, res) => {
    const b = await readBody(req);
    const target = String(b.target || '');
    // Uniquement les logiciels détectés et les pages officielles connues
    if (!(await device.allowedTargets(b.simulate)).has(target) && !oemUpdates.allowed(target) && !gpuDrivers.allowed(target)) return json(res, 400, { error: 'Cible non autorisée' });
    json(res, 200, await run({ kind: 'uri', target }));
  },
  'GET /api/drivers': (req, res) => json(res, 200, driverJobs.status()),
  // Pilotes graphiques des fabricants, et résumé des pilotes disponibles (notifications)
  'GET /api/gpu-drivers': (req, res) => json(res, 200, gpuDrivers.status()),
  'POST /api/gpu-drivers/check': async (req, res) => {
    const dev = await device.info().catch(() => null);
    if (!dev || !dev.ok) return json(res, 500, { error: 'Impossible de décrire cet appareil' });
    json(res, 200, await gpuDrivers.check(dev));
  },
  'GET /api/drivers/summary': (req, res) => json(res, 200, driverNews()),
  'GET /api/oem': async (req, res, q) => {
    const d = await device.info({ simulate: q.get('simulate') || '' });
    json(res, 200, { supported: !!d.ok && oemUpdates.supported(d.handheld), maker: d.handheld ? d.handheld.maker : null, ...oemUpdates.status() });
  },
  'POST /api/oem/check': async (req, res) => {
    const b = await readBody(req);
    const d = await device.info({ simulate: String(b.simulate || '') });
    if (!d.ok || !oemUpdates.supported(d.handheld)) return json(res, 400, { error: 'Pas de canal officiel pris en charge pour cet appareil' });
    json(res, 200, await oemUpdates.check(d));
  },

  // --- Streaming : PC hôtes (en ligne, appairés), appairage, qualité, arrêt du jeu
  // --- Mises à jour (Releases GitHub)
  'GET /api/update': (req, res) => {
    const c = config();
    json(res, 200, {
      current: update.current(ROOT), channel: c.updateChannel, auto: c.updateAuto, packaged: PACKAGED,
      last: updateState.last, job: updateJob.state, page: update.PAGE,
    });
  },
  // Canal stable seulement : le canal bêta a été retiré en 2.0.0
  'POST /api/update/check': async (req, res) => {
    try { updateState.last = await update.check(ROOT, 'stable'); json(res, 200, updateState.last); }
    catch (e) { json(res, 502, { error: e.message }); }
  },
  'POST /api/update/download': async (req, res) => {
    const l = updateState.last;
    if (!l || !l.available) return json(res, 400, { error: 'Aucune mise à jour à télécharger' });
    updateJob.download(l.latest).catch(() => { /* état dans updateJob.state */ });
    json(res, 200, { ok: true });
  },
  'POST /api/update/apply': async (req, res) => {
    if (!PACKAGED) return json(res, 400, { error: 'Version de développement : mettez à jour avec l’installateur de la page GitHub' });
    if (updateJob.state.phase !== 'ready') return json(res, 400, { error: 'Mise à jour pas encore téléchargée' });
    try { json(res, 200, await update.apply(updateJob.state.file, __dirname)); }
    catch (e) { json(res, 500, { error: e.message }); }
  },
  'POST /api/update/prefs': async (req, res) => {
    const b = await readBody(req);
    const c = config();
    if (b.channel === 'stable') { c.updateChannel = b.channel; updateState.last = null; }
    if (typeof b.auto === 'boolean') c.updateAuto = b.auto;
    writeJson(FILES.config, c);
    json(res, 200, { ok: true });
  },
  'POST /api/update/page': async (req, res) => json(res, 200, await run({ kind: 'uri', target: update.PAGE })),

  // --- Réglages système (accès rapide) et profils d'énergie (voir lib/syscontrol.js)
  'GET /api/sys': async (req, res, q) => {
    try {
      const hh = (await device.info().catch(() => ({}))).handheld;
      json(res, 200, { ...(await sysctl.state(q.get('refresh') === '1')), mode: config().perfMode || null, handheld: hh ? hh.id : null, modeConflict: keeperConflict(), customTdp: config().customTdp ?? null });
    }
    catch (e) { json(res, 500, { error: e.message }); }
  },
  // Mesures en direct (accès rapide ouvert) : fréquence réelle du processeur, charge, watts sur batterie
  'GET /api/sys/live': async (req, res) => {
    try { json(res, 200, await sysctl.live()); }
    catch (e) { json(res, 500, { error: e.message }); }
  },
  // Bons plans et nouveautés des boutiques (rangée de l'accueil, voir lib/deals.js) : la liste en
  // cache est rendue tout de suite ; relue en arrière-plan au-delà de 4 h, jamais avec un jeu devant
  'GET /api/deals': async (req, res) => json(res, 200, deals.get({ allowRefresh: fpsScope.front })),
  'POST /api/deals/open': async (req, res) => {
    const b = await readBody(req);
    const lib = readJson(FILES.library, { launchers: [] });
    const installed = Object.fromEntries((lib.launchers || []).map(l => [l.id, !!l.installed]));
    const target = dealsLib.target(deals.find(String(b.id || '')), installed);
    if (!target) return json(res, 404, { error: 'Offre introuvable : la liste a peut-être changé' });
    json(res, 200, { ...(await run({ kind: 'uri', target })), app: /^(steam|com\.epicgames)/.test(target) });
  },
  // Connexion réseau (icône de la barre du haut) : filaire, Wi-Fi (avec le signal) ou aucune
  'GET /api/net': async (req, res) => {
    if (!netState.p || Date.now() - netState.t > 5000) {
      netState.t = Date.now();
      // Service pas encore prêt (démarrage) : réponse « inconnue », pas gardée
      netState.p = sysctl.call('net').catch(() => { netState.p = null; return { kind: 'unknown' }; });
    }
    json(res, 200, await netState.p);
  },
  'POST /api/sys': async (req, res) => {
    const b = await readBody(req);
    const cmd = String(b.cmd || '');
    try {
      const perf = ['powermode', 'vendor', 'tdp', 'cpumax', 'boost'].includes(cmd);
      if (perf) keeperQuiet();
      const execute = () => sysctl.call(cmd, { value: b.value, kind: b.kind });
      const r = perf ? await powerController.adjust({ powermode: 'powerMode', vendor: 'vendor', tdp: 'tdp', cpumax: 'cpuMax', boost: 'boost' }[cmd], b.value, execute) : await execute();
      json(res, 200, r);
    } catch (e) { json(res, 400, { error: e.message }); }
  },
  // Mode de performance d'un jeu, appliqué à son lancement (mode null : pas de mode propre)
  'POST /api/game-mode': async (req, res) => {
    const b = await readBody(req);
    if (typeof b.id !== 'string' || !b.id) return json(res, 400, { error: 'Jeu inconnu' });
    if (b.mode != null && !PERF_MODES.includes(b.mode)) return json(res, 400, { error: 'Mode inconnu' });
    const c = config();
    const m = { ...(c.gameModes || {}) };
    if (b.mode == null) delete m[b.id]; else m[b.id] = b.mode;
    c.gameModes = m;
    writeJson(FILES.config, c);
    json(res, 200, { id: b.id, mode: b.mode ?? null });
  },
  'GET /api/game-mode': (req, res) => json(res, 200, config().gameModes || {}),
  // HDR automatique : réglages, état, choix par jeu (toujours / jamais)
  'GET /api/hdr/auto': async (req, res) => {
    const st = await sysctl.call('hdrstate').catch(() => ({ hdr: -1 }));
    json(res, 200, { ...autoHdr.prefs(), screen: st.hdr, ...autoHdr.state() });
  },
  'POST /api/hdr/auto': async (req, res) => {
    const b = await readBody(req);
    const c = config(), p = autoHdr.prefs();
    for (const k of Object.keys(autoHdrLib.DEFAULTS)) if (typeof b[k] === 'boolean') p[k] = b[k];
    c.autoHdr = p; writeJson(FILES.config, c);
    json(res, 200, p);
  },
  'GET /api/game-hdr': (req, res) => json(res, 200, config().gameHdr || {}),
  'POST /api/game-hdr': async (req, res) => {
    const b = await readBody(req);
    if (typeof b.id !== 'string' || !b.id) return json(res, 400, { error: 'Jeu inconnu' });
    if (b.mode != null && !autoHdrLib.GAME_MODES.includes(b.mode)) return json(res, 400, { error: 'Choix inconnu' });
    const c = config(), m = { ...(c.gameHdr || {}) };
    if (b.mode == null) delete m[b.id]; else m[b.id] = b.mode;
    c.gameHdr = m; writeJson(FILES.config, c);
    json(res, 200, { id: b.id, mode: b.mode ?? null });
  },
  // Mode de performance (Économie, Équilibré, Performance) : tout est appliqué d'un coup
  'POST /api/power/mode': async (req, res) => {
    const b = await readBody(req);
    if (!PERF_MODES.includes(b.mode)) return json(res, 400, { error: 'Mode inconnu' });
    keeperQuiet();
    keeper.fixes = []; keeper.pausedUntil = 0; // choix de l'utilisateur : KaneMode reprend la main
    const r = await powerController.select(b.mode);
    keeperQuiet();
    const st = await sysctl.state(true).catch(() => null);
    const hh = (await device.info().catch(() => ({}))).handheld;
    json(res, 200, { mode: b.mode, ...r, state: st && { ...st, mode: config().perfMode || null, handheld: hh ? hh.id : null, modeConflict: keeperConflict(), customTdp: config().customTdp ?? null } });
  },
  // --- Graphismes du pilote (AMD, NVIDIA, Intel) : limite d'images par seconde, faible latence,
  // netteté, RSR et AFMF (AMD), synchronisation verticale (NVIDIA), mesures du GPU (voir lib/gpuctl.js)
  'GET /api/graphics': async (req, res, q) => {
    try { json(res, 200, withFps(await gfx.state(q.get('refresh') === '1'))); }
    catch (e) { json(res, 200, { available: false, reason: e.message }); }
  },
  // KaneMode passe au premier plan ou le quitte (app native) : la limite d'images suit
  'POST /api/graphics/front': async (req, res) => {
    const b = await readBody(req);
    fpsScope.front = !!b.front;
    try { json(res, 200, withFps(await applyFpsScope())); }
    catch (e) { json(res, 200, { error: e.message }); }
  },
  'GET /api/graphics/live': async (req, res) => {
    try { json(res, 200, await gfx.live()); }
    catch (e) { json(res, 500, { error: e.message }); }
  },
  // Widgets Game Bar : toutes les mesures en direct en une requête (processeur, batterie, GPU), gardées
  // un court instant : le widget et le moniteur ouverts ensemble ne les demandent qu'une fois
  'GET /api/hud/live': async (req, res) => {
    if (!hudLive.p || Date.now() - hudLive.t > 700) {
      hudLive.t = Date.now();
      hudLive.p = Promise.all([
        sysctl.live().catch(() => null),
        gfx.state().then(s => (s && s.available ? gfx.live() : null)).catch(() => null),
      ]).then(([live, gpu]) => ({ live, gpu }));
    }
    json(res, 200, await hudLive.p);
  },
  'POST /api/graphics': async (req, res) => {
    const b = await readBody(req);
    const feature = String(b.feature || '');
    try {
      if (feature === 'fps') {
        // Limite des jeux : gardée, appliquée au pilote seulement hors de KaneMode
        const n = Math.max(0, Math.round(Number(b.value) || 0));
        const c = config();
        c.fpsLimit = n;
        writeJson(FILES.config, c);
        return json(res, 200, withFps(await applyFpsScope()));
      }
      json(res, 200, withFps(await gfx.set(feature, b.value)));
    } catch (e) { json(res, 400, { error: e.message }); }
  },
  'GET /api/power/profiles': (req, res) => json(res, 200, powerProfiles()),
  // Icône de batterie de la barre d'état : secteur, économiseur d'énergie, mode de performance
  'GET /api/power/badge': async (req, res, q) => {
    const pol = await sysctl.policy().catch(() => ({}));
    const out = { ac: pol.ac ?? null, saver: !!pol.saver, mode: config().perfMode || null, vendor: pol.vendor || null };
    // Panneau Batterie : puissance de chaque mode sur la source actuelle (ROG Ally)
    if (q.get('full') === '1') {
      const st = await sysctl.state().catch(() => null);
      const hh = (await device.info().catch(() => ({}))).handheld;
      out.watts = Object.fromEntries(PERF_MODES.map(m => [m, perfPreset(m, { ...st, ac: pol.ac ?? (st && st.ac) }, hh && hh.id).tdp ?? null]));
      out.handheld = hh ? hh.id : null;
    }
    json(res, 200, out);
  },
  // --- Wi-Fi (panneau Réseau de la barre d'état, voir lib/wifi.js)
  'GET /api/wifi': async (req, res) => {
    try { json(res, 200, await wifi.scan()); } catch (e) { json(res, 500, { error: e.message }); }
  },
  'POST /api/wifi/connect': async (req, res) => {
    const b = await readBody(req);
    try { json(res, 200, await wifi.connect(b.ssid, typeof b.password === 'string' ? b.password : undefined)); netState.p = null; }
    catch (e) { json(res, 400, { error: e.message }); }
  },
  'POST /api/wifi/disconnect': async (req, res) => { json(res, 200, await wifi.disconnect()); netState.p = null; },
  'POST /api/wifi/forget': async (req, res) => {
    const b = await readBody(req);
    try { json(res, 200, await wifi.forget(String(b.ssid || ''))); } catch (e) { json(res, 400, { error: e.message }); }
  },
  // --- Météo (panneau Heure, voir lib/weather.js)
  'GET /api/weather': async (req, res, q) => {
    try { json(res, 200, await weather.get(q.get('refresh') === '1')); } catch (e) { json(res, 502, { error: e.message }); }
  },
  'GET /api/weather/search': async (req, res, q) => {
    try { json(res, 200, await weather.search(q.get('q'), config().lang || 'fr')); } catch (e) { json(res, 502, { error: e.message }); }
  },
  'POST /api/weather/place': async (req, res) => {
    const b = await readBody(req);
    const p = b.place;
    if (p && !(Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && p.name)) return json(res, 400, { error: 'Lieu invalide' });
    weather.setPlace(p || null);
    json(res, 200, { ok: true });
  },
  'POST /api/power/profiles': async (req, res) => {
    const b = await readBody(req);
    const c = config();
    const p = powerProfiles();
    if (typeof b.auto === 'boolean') p.auto = b.auto;
    if (typeof b.plugTurbo === 'boolean') p.plugTurbo = b.plugTurbo;
    if (typeof b.saverEco === 'boolean') p.saverEco = b.saverEco;
    for (const src of ['battery', 'ac']) {
      if (!b[src] || typeof b[src] !== 'object') continue;
      const v = b[src], out = { ...p[src] };
      for (const [k, test] of Object.entries(PROFILE_FIELDS)) if (k in v) { if (v[k] === null) delete out[k]; else if (test(v[k])) out[k] = v[k]; }
      p[src] = out;
    }
    c.powerProfiles = p;
    writeJson(FILES.config, c);
    json(res, 200, p);
  },
  // Branchement ou débranchement du chargeur : le profil de la source d'alimentation s'applique
  'POST /api/power/apply': async (req, res) => {
    const b = await readBody(req);
    const r = await powerController.sync({ force: b.force === true, requested: b.source });
    json(res, 200, r);
  },
  // --- Streaming : l'application KanePlay intégrée (voir lib/kaneplay.js)
  'GET /api/stream': async (req, res, q) => {
    if (q.get('refresh') === '1') await refreshKanePlay();
    json(res, 200, {
      engine: !!kp.exe, bundled: kp.exe === KANEPLAY_BUNDLED, dev: kp.exe === KANEPLAY_DEV,
      hosts: kp.hosts.map(h => ({ uuid: h.uuid, name: h.name, paired: h.paired, apps: h.apps.filter(a => !a.hidden).length })),
    });
  },
  // Complément PC hôte : mise à l'échelle de l'écran de ce PC quand on y joue en streaming
  'GET /api/stream/hostscale': (req, res) => json(res, 200, hostScale.status()),
  'POST /api/stream/hostscale': async (req, res) => {
    const b = await readBody(req);
    try { json(res, 200, await (b.remove === true ? hostScale.remove() : hostScale.install())); }
    catch (e) { json(res, 400, { error: e.message }); }
  },
  // Ouvre l'écran de streaming (ou le ramène devant, là où il en était)
  'POST /api/stream/open': async (req, res) => {
    if (!kp.exe) return json(res, 404, { error: 'Moteur de streaming absent' });
    const r = await run({ kind: 'exe', target: kp.exe, args: '', env: kaneplay.env('show', engineLook()) });
    if (r.ok) recordPlay('kaneplay');
    json(res, 200, r);
  },
  'POST /api/drivers/search': async (req, res) => { await driverJobs.search(); json(res, 200, driverJobs.status()); },
  'POST /api/drivers/install': async (req, res) => {
    const b = await readBody(req);
    const ids = (Array.isArray(b.ids) ? b.ids : []).filter(id => /^[0-9a-f-]{36}$/i.test(id));
    if (!ids.length) return json(res, 400, { error: 'Aucune mise à jour choisie' });
    if (!driverJobs.install(ids)) return json(res, 409, { error: 'Installation déjà en cours' });
    json(res, 200, { ok: true });
  },
  'GET /api/storage': (req, res) => {
    const games = allEntries(false).games.filter(g => g.installed !== false && g.sizeOnDisk > 0 && str(g.installDir));
    json(res, 200, sys.storage().map(d => ({
      ...d,
      games: games.filter(g => g.installDir.toUpperCase().startsWith(d.letter)).sort((a, b) => b.sizeOnDisk - a.sizeOnDisk)
        .map(g => ({ id: g.id, name: g.name, size: g.sizeOnDisk })),
    })));
  },
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);
  try {
    if (p.startsWith('/api/')) {
      if (!trusted(req)) return json(res, 403, { error: 'Requête refusée' });
      const h = routes[`${req.method} ${p}`];
      return h ? await h(req, res, url.searchParams) : json(res, 404, { error: 'Route inconnue' });
    }
    if (!localHost(req)) { res.writeHead(403); return res.end(); }
    if (p.startsWith('/art/')) {
      const [, , id, kind] = p.split('/');
      const e = findEntry(id);
      if (!e || !ART_KINDS.includes(kind)) { res.writeHead(404); return res.end(); }
      const file = id.startsWith('launcher:') ? str(e.art && e.art.icon) : await resolveArt(e, kind);
      if (file) return sendFile(res, file, req);
      res.writeHead(404); return res.end();
    }
    if (p.startsWith('/icons/')) return sendFile(res, path.join(ICONS, path.basename(p)), req);
    // Aperçu d'une image choisie sur le disque (formulaires) : images uniquement.
    if (p === '/preview') {
      const f = url.searchParams.get('path') || '';
      if (!isImage(f)) { res.writeHead(404); return res.end(); }
      return sendFile(res, f, req);
    }
    // Vidéo et son de démarrage personnalisés (par défaut : logo animé et carillon synthétisé)
    if (p === '/bootvideo' || p === '/bootsound') {
      const v = str(config()[p === '/bootvideo' ? 'bootVideo' : 'bootSound']);
      if (!v || !isFile(v)) { res.writeHead(404); return res.end(); }
      return sendFile(res, v, req);
    }
    const file = path.join(UI, p === '/' ? 'index.html' : p);
    if (!file.startsWith(UI)) { res.writeHead(403); return res.end(); }
    sendFile(res, file, req);
  } catch (e) {
    json(res, 500, { error: e.message });
  }
}).listen(PORT, '127.0.0.1', () => console.log(`KaneMode : http://localhost:${PORT}`));

// Mises à jour : état de la dernière vérification et du téléchargement
const PACKAGED = process.env.KANEMODE_PACKAGED === '1';
const updateJob = update.job();
const updateState = { last: null };

// ---------------------------------------------------------------- bibliothèque à jour toute seule
// Un jeu installé, désinstallé ou ajouté apparaît sans passer par Paramètres : les dossiers des
// boutiques (Steam, Epic, Xbox, raccourcis non-Steam) sont surveillés, et l'analyse complète
// (registre : GOG, Ubisoft, EA…) est refaite au démarrage, au retour et au plus toutes les 2 minutes.
const libSig = () => {
  const l = readJson(FILES.library, {});
  return JSON.stringify([(l.games || []).map(g => [g.id, g.installDir, g.sizeOnDisk]), (l.launchers || []).map(x => [x.id, x.installed])]);
};
let libScan = null, libAgain = false, libLast = 0, libTimer = null;
function rescanLibrary(reason) {
  if (libScan) { libAgain = true; return libScan; }
  libScan = (async () => {
    const before = libSig();
    const r = await runPs('scan.ps1', ['-DataDir', DATA]);
    libLast = Date.now();
    if (r.code === 0 && libSig() !== before) { version++; console.log(`Bibliothèque mise à jour (${reason})`); }
    watchStores();
  })().finally(() => {
    libScan = null;
    if (libAgain) { libAgain = false; rescanSoon('changements pendant l’analyse'); }
  });
  return libScan;
}
function rescanSoon(reason, delay = 3000) {
  clearTimeout(libTimer);
  libTimer = setTimeout(() => rescanLibrary(reason), delay);
}

const watches = new Map();
let epicWatch = null;
function watchDir(dir, onChange) {
  const key = dir.toLowerCase();
  if (watches.has(key) || !fs.existsSync(dir)) return;
  try {
    const w = fs.watch(dir, (ev, f) => { try { onChange(String(f || '')); } catch { /* fichier en cours d'écriture */ } });
    w.on('error', () => { w.close(); watches.delete(key); });
    watches.set(key, w);
  } catch { /* dossier inaccessible */ }
}
// Steam réécrit le manifeste d'un jeu pendant tout son téléchargement : on ne réagit qu'au
// changement d'état « installé » (bit 4 de StateFlags), à l'ajout et à la suppression
const acfState = new Map();
function acfInstalled(file) {
  try { const m = /"StateFlags"\s+"(\d+)"/i.exec(fs.readFileSync(file, 'utf8')); return !!m && (+m[1] & 4) !== 0; }
  catch { return false; }
}
function watchStores() {
  const ud = str(readJson(FILES.library, {}).steamUserdata);
  if (ud) {
    const root = path.dirname(ud);
    let libs = [root];
    try {
      const vdf = fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8');
      libs = [...new Set([...vdf.matchAll(/"path"\s+"([^"]+)"/g)].map(m => m[1].replace(/\\\\/g, '\\')))];
    } catch { /* une seule bibliothèque */ }
    for (const l of libs) {
      const dir = path.join(l, 'steamapps');
      if (watches.has(dir.toLowerCase())) continue;
      try { for (const f of fs.readdirSync(dir)) if (/^appmanifest_\d+\.acf$/i.test(f)) acfState.set(path.join(dir, f).toLowerCase(), acfInstalled(path.join(dir, f))); }
      catch { continue; }
      watchDir(dir, f => {
        if (/^libraryfolders\.vdf$/i.test(f)) { rescanSoon('nouvelle bibliothèque Steam'); return; }
        if (!/^appmanifest_\d+\.acf$/i.test(f)) return;
        const file = path.join(dir, f), key = file.toLowerCase();
        const now = isFile(file) && acfInstalled(file);
        if (acfState.has(key) && acfState.get(key) === now) return;
        acfState.set(key, now);
        rescanSoon(`Steam, ${f}`);
      });
    }
    // Jeux non-Steam : lus à chaque demande, il suffit que l'interface relise
    try { for (const u of fs.readdirSync(ud)) watchDir(path.join(ud, u, 'config'), f => { if (/^shortcuts\.vdf$/i.test(f)) version++; }); }
    catch { /* pas de compte Steam */ }
  }
  if (!epicWatch) epicWatch = createPathWatch(path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests'), () => rescanSoon('Epic'));
  else epicWatch.refresh();
  for (const d of 'CDEFGHIJKLMNOPQRSTUVWXYZ') watchDir(`${d}:\\XboxGames`, () => rescanSoon('Xbox', 8000));
}

// Premier lancement (PC neuf) : la bibliothèque n'existe pas encore, on la construit tout de suite
ensureEmuHome();
watchEmuGames();
// Jeux ajoutés pendant que KaneMode était fermé, puis contrôle léger toutes les 30 s
setTimeout(() => { try { if (isFile(FILES.library)) checkEmuGames('démarrage'); } catch (e) { console.error('Émulation :', e.message); } }, 3000);
setTimeout(detectDisplay, 4000);
setInterval(() => { try { checkEmuGames('contrôle du dossier'); } catch (e) { console.error('Émulation :', e.message); } }, 30e3).unref();
if (!isFile(FILES.library)) {
  console.log('Premier lancement : analyse de la bibliothèque');
  runPs('scan.ps1', ['-DataDir', DATA]).then(() => { scanEmulation(); version++; watchStores(); });
} else {
  watchStores();
  setTimeout(() => rescanLibrary('démarrage'), 8000); // jeux installés pendant que KaneMode était fermé
}
// Filet de sécurité (la surveillance des dossiers et le retour sur KaneMode suffisent d'habitude) :
// toutes les 2 min, et jamais pendant qu'un jeu est devant (l'analyse lance PowerShell, ~1 s de
// processeur qui pouvait faire saccader le jeu sur une console portable)
setInterval(() => {
  epicWatch?.refresh();
  if (fpsScope.front && Date.now() - libLast >= 2 * 60e3) rescanLibrary('nouvelles boutiques et installations');
}, 30000);
refreshKanePlay();
setInterval(() => { if (fpsScope.front) refreshKanePlay(); }, 5 * 60e3);
// Steam (et Epic) prêts en arrière-plan : le premier jeu démarre sans attendre que la boutique s'ouvre.
// Un peu après le démarrage, pour ne pas ralentir l'ouverture de KaneMode.
// Seulement dans l'app (pas en développement dans un navigateur)
if (process.env.KANEMODE_NATIVE === '1') setTimeout(() => warmStores().catch(() => {}), 12000);
// Pilotes (carte graphique, constructeur de la console) : une fois par jour, une minute après le démarrage
setTimeout(() => checkDriversDaily().catch(() => {}), 60e3);
setInterval(() => checkDriversDaily().catch(() => {}), 3 * 3600e3);
// Bons plans : préparés peu après le démarrage, puis relus au-delà de 4 h (jamais avec un jeu devant)
setTimeout(() => { if (fpsScope.front) deals.get(); }, 15000);
setInterval(() => { if (fpsScope.front) deals.get(); }, 3600e3);
// Bibliothèques de comptes : cache immédiat ; aucune ouverture de Playnite pendant un jeu.
setTimeout(() => { if (fpsScope.front) accounts.sync().catch(() => {}); }, 20000);
setInterval(() => { if (fpsScope.front) accounts.sync().catch(() => {}); }, 15 * 60e3);
// Préchauffage : appareil et réglages système prêts avant que l'accès rapide ne les demande
setTimeout(() => { device.info().then(() => sysctl.state()).catch(() => {}); }, 1500); // nouveaux PC appairés, nouvelles applis sur l'hôte
