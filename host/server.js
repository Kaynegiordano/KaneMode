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
const sys = require('./lib/system');
const device = require('./lib/device');
const kaneplay = require('./lib/kaneplay');
const update = require('./lib/update');
const syscontrol = require('./lib/syscontrol');
const oem = require('./lib/oem');

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
const config = () => Object.assign({ updateChannel: 'stable', updateAuto: true, bootVideo: null, bootSound: null, sgdbKey: null, sgdbAuto: true, sgdbPreferSteam: true, sgdbStyle: '', romRoots: [], emulatorPaths: {}, emulatorPrefs: {} }, readJson(FILES.config, {}));
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

function splitArgs(s) {
  const out = [];
  let cur = '', quoted = false, has = false;
  for (const ch of s || '') {
    if (ch === '"') { quoted = !quoted; has = true; continue; }
    if (/\s/.test(ch) && !quoted) { if (cur || has) out.push(cur); cur = ''; has = false; continue; }
    cur += ch;
  }
  if (cur || has) out.push(cur);
  return out;
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

async function steamJson(url) {
  const r = await fetch(url, { headers: { 'Accept-Language': 'fr-FR' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function fetchMeta(entry) {
  let steamId = entry.steamAppId || null;
  if (!steamId) {
    const s = await steamJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(entry.name)}&l=french&cc=FR`);
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
  const d = await steamJson(`https://store.steampowered.com/api/appdetails?appids=${steamId}&l=french&cc=FR`);
  // Steam renvoie parfois la réponse sous une autre clé que l'appid demandé : on prend la première.
  const first = d[steamId] || Object.values(d)[0];
  const info = first && first.success ? first.data : null;
  if (!info) return { steamId, fetched: Date.now() };
  // Recherche par nom : on refuse un DLC, une bande-son ou une démo pris pour le jeu.
  if (!entry.steamAppId && info.type !== 'game') return { steamId: null, fetched: Date.now() };
  const genres = (info.genres || []).map(g => ({ id: String(g.id), name: g.description }));
  const software = info.type !== 'game' && info.type !== 'dlc' || (genres.length && genres.every(g => SOFTWARE_GENRES.has(g.id) || ['Indépendant', 'Occasionnel', 'Accès anticipé'].includes(g.name)) && genres.some(g => SOFTWARE_GENRES.has(g.id)));
  const cats = info.categories || [];
  return {
    steamId, fetched: Date.now(), name: info.name, kind: info.type,
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
    if (e.source === 'rom' || (!e.steamAppId && e.type === 'app')) continue; // rien à chercher sur Steam
    const m = meta[e.id];
    const stale = m && m.steamId && (!m.type || (e.steamAppId && !m.name)) && Date.now() - m.fetched > 3600e3; // données incomplètes
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

function allEntries(withDemo) {
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
    games: [...games, ...(ud ? steam.shortcuts(ud) : []), ...custom, ...roms, ...kp.entries, ...(withDemo ? DEMO : [])],
    launchers: lib.launchers || [],
  };
}
function findEntry(id) {
  const all = allEntries(true);
  if (id.startsWith('launcher:')) return all.launchers.find(l => l.id === id.slice(9));
  return all.games.find(g => g.id === id);
}

// Pas de recherche SteamGridDB pour le bureau à distance de KanePlay (aucun jeu de ce nom)
const noSgdb = e => e.source === 'kaneplay';

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
    if (local || (steamId && k !== 'icon') || (sgdbOn && !g.demo && !noSgdb(g))) {
      art[k] = `/art/${encodeURIComponent(g.id)}/${k}` + (artOv[k] ? `?v=${artOv._v || 1}` : local ? '' : '?r=' + ((st.artRev || {})[g.id] || 1));
    }
  }
  return {
    id: g.id, source: g.source, name: g.name, demo: !!g.demo, shortcut: !!g.shortcut,
    type: ov.type || (g.source === 'custom' || g.source === 'rom' ? g.type : m.type || g.type || 'game'),
    hidden: !!ov.hidden, installed: g.installed !== false,
    lastPlayed: Math.max(g.lastPlayed || 0, played.last || 0), playCount: played.count || 0,
    playtime: (g.playtime || 0) + Math.round(played.minutes || 0),
    sizeOnDisk: g.sizeOnDisk || 0, installDir: str(g.installDir), steamAppId: g.steamAppId || null,
    streamHost: g.streamHost || null, system: g.system || null, systemName: g.systemName || null, region: g.region || null,
    emulator: g.emulator || null, core: g.core || null, romPath: g.romPath || null,
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
const PERF_MODES = ['eco', 'balanced', 'performance'];
/**
 * Modes de performance KaneMode : chacun règle ensemble le mode d'alimentation de Windows, la limite
 * et le turbo du processeur et, sur une console reconnue, le profil du constructeur (qui fixe aussi
 * sa puissance et ses ventilateurs, comme Armoury Crate ou Legion Space).
 */
function perfPreset(mode, st) {
  const v = st && st.vendor;
  const pick = (...names) => (v && v.modes ? names.find(n => v.modes.includes(n)) : undefined);
  if (mode === 'eco') return { powerMode: 'efficiency', cpuMax: 70, boost: false, vendor: pick('silent', 'quiet') };
  if (mode === 'balanced') return { powerMode: 'balanced', cpuMax: 100, boost: true, vendor: pick('performance', 'balanced') };
  if (mode === 'performance') return { powerMode: 'performance', cpuMax: 100, boost: true, vendor: pick('turbo', 'performance') };
  return {};
}
/** Profil complet : le mode choisi, puis les réglages précisés un par un (qui l'emportent). */
async function expandProfile(profile) {
  const { mode, ...rest } = profile || {};
  if (!PERF_MODES.includes(mode)) return rest;
  const st = await sysctl.state().catch(() => null);
  const base = perfPreset(mode, st);
  for (const k of Object.keys(base)) if (base[k] === undefined) delete base[k];
  return { ...base, ...rest };
}
const setPerfMode = mode => { const c = config(); if (c.perfMode !== mode) { c.perfMode = mode; writeJson(FILES.config, c); } };
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
  const p = config().powerProfiles || {};
  // Par défaut rien n'est changé : l'utilisateur choisit ce que chaque profil règle
  return { auto: p.auto !== false, battery: p.battery || {}, ac: p.ac || {} };
};
// ---------------------------------------------------------------- pilotes (Windows Update)
const driverJobs = device.drivers(DATA);
// Mises à jour officielles du constructeur de la console (BIOS, pilotes du modèle)
const oemUpdates = oem.tracker(DATA);

// ---------------------------------------------------------------- streaming (moteur KanePlay)
// Copie embarquée dans l'app native (dossier kaneplay\ à côté de app\, voir native\build.ps1)
const KANEPLAY_BUNDLED = path.join(ROOT, '..', 'kaneplay', 'KanePlay.exe');
// Développement : moteur compilé depuis le sous-module (engine\build-engine.ps1)
const KANEPLAY_DEV = path.join(ROOT, 'engine', 'out', 'KanePlay.exe');
// Icône de KaneMode pour la fenêtre du streaming (paquet : app\kanemode.ico)
const KANEMODE_ICON = [path.join(ROOT, 'kanemode.ico'), path.join(ROOT, 'setup', 'kanemode.ico')].find(isFile) || null;
const KANEPLAY_COVER = path.join(UI, 'media', 'kaneplay.png');
const kp = { exe: null, entries: [], hosts: [] };
async function refreshKanePlay() {
  try {
    const exe = await kaneplay.findExe(KANEPLAY_BUNDLED, KANEPLAY_DEV);
    const hosts = exe ? await kaneplay.hosts() : [];
    const one = kaneplay.entry(exe, KANEPLAY_COVER, { icon: KANEMODE_ICON, accent: config().accent });
    const entries = one ? [one] : [];
    const sig = (x, h, list) => JSON.stringify([x, h.map(y => y.uuid + y.paired), list.map(e => e.id + e.name + !!e.art.portrait)]);
    const changed = sig(exe, hosts, entries) !== sig(kp.exe, kp.hosts, kp.entries);
    Object.assign(kp, { exe, hosts, entries });
    if (changed) version++;
  } catch (e) { console.error('Streaming :', e.message); }
}

// ---------------------------------------------------------------- visuels : surcharges, Steam, SteamGridDB
let sgdbCache = readJson(FILES.sgdb, {});
async function sgdbGameFor(e, key) {
  if (e.id in sgdbCache) return sgdbCache[e.id];
  const g = await sgdb.gameFor(key, e);
  sgdbCache[e.id] = g ? { id: g.id, name: g.name } : null;
  writeJson(FILES.sgdb, sgdbCache);
  return sgdbCache[e.id];
}
const cached = base => { for (const ext of ['.png', '.jpg', '.webp', '.ico']) if (isFile(base + ext)) return base + ext; return null; };

// Pas plus de 3 recherches SteamGridDB à la fois quand une grille entière se charge
let sgdbRunning = 0;
const sgdbWaiting = [];
async function sgdbSlot(fn) {
  if (sgdbRunning >= 3) await new Promise(r => sgdbWaiting.push(r));
  sgdbRunning++;
  try { return await fn(); }
  finally { sgdbRunning--; const next = sgdbWaiting.shift(); if (next) next(); }
}

async function sgdbAuto(e, kind, cfg) {
  const base = path.join(ARTCACHE, `sgdb_${safeId(e.id)}_${kind}`);
  const hit = cached(base);
  if (hit) return hit;
  if (isFile(base + '.miss')) return null;
  return sgdbSlot(() => sgdbFetch(e, kind, cfg, base));
}
async function sgdbFetch(e, kind, cfg, base) {
  const again = cached(base);
  if (again) return again;
  try {
    const game = await sgdbGameFor(e, cfg.sgdbKey);
    const list = game ? await sgdb.assets(cfg.sgdbKey, game.id, kind, { style: kind === 'portrait' ? cfg.sgdbStyle : '' }) : [];
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
  if (isFile(base + '.miss')) return null;
  const urls = [];
  for (const f of REMOTE[kind] || []) for (const h of HOSTS) urls.push(`${h}/${steamId}/${f}`);
  const m = Object.values(meta).find(x => x.steamId === steamId && x.headerUrl);
  if (kind === 'header' && m) urls.push(m.headerUrl);
  for (const u of urls) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
      if (!r.ok || !(r.headers.get('content-type') || '').startsWith('image/')) continue;
      const file = base + (u.includes('.png') ? '.png' : '.jpg');
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      return file;
    } catch { /* essai suivant */ }
  }
  fs.writeFileSync(base + '.miss', '');
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
  const cfg = config();
  const steamId = e.steamAppId || (meta[e.id] || {}).steamId;
  const sgdbOn = cfg.sgdbAuto;
  if (sgdbOn && (!steamId || !cfg.sgdbPreferSteam)) { const f = await sgdbAuto(e, kind, cfg); if (f) return f; }
  if (steamId && kind !== 'icon') { const f = await steamCdn(steamId, kind); if (f) return f; }
  if (sgdbOn && steamId && cfg.sgdbPreferSteam) return sgdbAuto(e, kind, cfg);
  return null;
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

// Jeu Steam en cours (0 si aucun) : Steam le note dans le registre de l'utilisateur
function steamRunningApp() {
  return new Promise(resolve => {
    execFile('reg.exe', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'RunningAppID'], { windowsHide: true, timeout: 3000 }, (err, out) => {
      const m = !err && /RunningAppID\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(out);
      resolve(m ? parseInt(m[1], 16) : 0);
    });
  });
}
// Dernier lancement de chaque entrée : un second appui (ou un événement en double) ne relance pas le jeu
const recentLaunch = new Map();
const LAUNCH_GUARD = 30e3;

function run(launch, { dry, onExit } = {}) {
  if (!launch || !launch.target) return Promise.resolve({ ok: false, error: 'Aucune cible de lancement' });
  let cmd, args, cwd;
  if (launch.kind === 'exe' && /\.exe$/i.test(launch.target)) {
    cmd = launch.target; args = splitArgs(launch.args); cwd = launch.cwd && fs.existsSync(launch.cwd) ? launch.cwd : path.dirname(launch.target);
  } else {
    cmd = 'explorer.exe'; args = [launch.target]; // URI, shell:AppsFolder, .lnk, .url, .bat…
  }
  if (dry) return Promise.resolve({ ok: true, dry: true, cmd, args, cwd });
  return new Promise(resolve => {
    const started = Date.now();
    const env = launch.env && cmd !== 'explorer.exe' ? { ...process.env, ...launch.env } : undefined;
    const child = spawn(cmd, args, { cwd, env, detached: true, stdio: 'ignore' });
    child.on('spawn', () => { child.unref(); resolve({ ok: true }); });
    // Pour un exécutable lancé directement, on mesure la durée de la session.
    if (cmd !== 'explorer.exe' && onExit) child.on('exit', () => onExit((Date.now() - started) / 60000));
    child.on('error', err => {
      if (cmd === 'explorer.exe') return resolve({ ok: false, error: err.message });
      // ex. programme qui exige une élévation : on laisse Windows gérer via l'Explorateur
      spawn('explorer.exe', [launch.target], { detached: true, stdio: 'ignore' }).unref();
      resolve({ ok: true, fallback: true });
    });
  });
}

// ---------------------------------------------------------------- émulation
function scanEmulation() {
  const cfg = config();
  const extra = cfg.romRoots.flatMap(r => [path.dirname(r), path.join(path.dirname(r), 'emulators'), path.join(path.dirname(r), 'Emulators')]);
  const emulators = emu.detectEmulators(cfg.emulatorPaths, extra);
  const roms = emu.scanRoms(cfg.romRoots, emulators, cfg.emulatorPrefs);
  const data = { generated: new Date().toISOString(), emulators, roms };
  writeJson(FILES.roms, data);
  version++;
  return data;
}

// ---------------------------------------------------------------- navigateur de fichiers
function browse(p, mode) {
  const exts = mode === 'image' ? IMAGE_EXT : mode === 'video' ? VIDEO_EXT : mode === 'audio' ? AUDIO_EXT : mode === 'dir' ? [] : RUN_EXT;
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
function sendFile(res, file, req) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end(); }
    const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req && /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range && type.startsWith('video/')) { // lecture vidéo avec avance rapide
      const start = +range[1] || 0, end = range[2] ? +range[2] : st.size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-cache', 'Accept-Ranges': 'bytes' });
    fs.createReadStream(file).pipe(res);
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
  'GET /api/library': (req, res, q) => {
    const st = state(), cfg = config();
    const all = allEntries(q.get('demo') === '1');
    enqueueMeta([...all.games, ...all.pending]);
    json(res, 200, {
      generated: all.generated, version,
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
    scanEmulation();
    await refreshKanePlay();
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
    if ('sgdbPreferSteam' in b) c.sgdbPreferSteam = !!b.sgdbPreferSteam;
    if ('sgdbStyle' in b) c.sgdbStyle = ['', 'alternate', 'blurred', 'white_logo', 'material', 'no_logo'].includes(b.sgdbStyle) ? b.sgdbStyle : '';
    if (Array.isArray(b.romRoots)) c.romRoots = [...new Set(b.romRoots.filter(r => str(r) && fs.existsSync(r)))];
    if (b.emulatorPaths && typeof b.emulatorPaths === 'object') {
      for (const [k, v] of Object.entries(b.emulatorPaths)) { if (str(v) && isFile(v)) c.emulatorPaths[k] = v; else delete c.emulatorPaths[k]; }
    }
    if (b.emulatorPrefs && typeof b.emulatorPrefs === 'object') Object.assign(c.emulatorPrefs, b.emulatorPrefs);
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
    try { json(res, 200, await sgdb.assets(config().sgdbKey, +q.get('game'), q.get('kind'), { style: q.get('style') || '' })); }
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
  'POST /api/art/choose': async (req, res) => {
    const b = await readBody(req);
    if (!ART_KINDS.includes(b.kind) || !findEntry(String(b.id || ''))) return json(res, 400, { error: 'Requête invalide' });
    try {
      const img = await sgdb.download(String(b.url || ''));
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
    const prefixes = [`sgdb_${safeId(e.id)}_`, ...(steamId ? [`${steamId}_`] : [])];
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
    json(res, 200, publicEntry({ ...entry, installed: true }, state(), config()));
  },
  'DELETE /api/custom': (req, res, q) => {
    const id = q.get('id');
    writeJson(FILES.custom, readJson(FILES.custom, []).filter(c => c.id !== id));
    json(res, 200, { ok: true });
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
    const e = findEntry(id);
    if (!e) return json(res, 404, { ok: false, error: 'Entrée inconnue' });
    if (e.demo) return json(res, 200, { ok: false, demo: true, error: 'Entrée de démonstration' });
    if (e.source === 'rom' && !e.launch) return json(res, 200, { ok: false, error: `Aucun émulateur trouvé pour ${e.systemName}` });
    if (!b.dry && e.installed !== false && !id.startsWith('launcher:')) {
      const last = recentLaunch.get(id);
      if (last && Date.now() - last < LAUNCH_GUARD) {
        console.log(`Lancement ignoré, déjà demandé il y a ${Math.round((Date.now() - last) / 1000)} s : ${e.name}`);
        return json(res, 200, { ok: true, already: true });
      }
      if (e.steamAppId && await steamRunningApp() === +e.steamAppId) {
        console.log(`Lancement ignoré, le jeu tourne déjà : ${e.name}`);
        return json(res, 200, { ok: true, running: true });
      }
    }
    console.log(`Lancement : ${e.name} (${id})`);
    // Jeu d'un PC hôte : le lancement ne dure qu'un instant (la commande passe à l'écran de streaming)
    const r = await run(e.launch, { dry: !!b.dry, onExit: m => e.source !== 'kaneplay' && m > 0.2 && addMinutes(id, m) });
    if (r.ok && !b.dry && e.installed !== false) { recordPlay(id); if (!id.startsWith('launcher:')) recentLaunch.set(id, Date.now()); }
    json(res, 200, r);
  },
  // Le jeu s'est fermé (KaneMode l'a vu) : on peut le relancer tout de suite
  'POST /api/launch/ended': async (req, res) => {
    const b = await readBody(req);
    recentLaunch.delete(String(b.id || ''));
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
    json(res, 200, await run({ kind: 'uri', target }, { dry: !!b.dry }));
  },

  // --- Système
  // Pages des Paramètres Windows utiles à KaneMode (liste fermée).
  'POST /api/open-settings': async (req, res) => {
    const b = await readBody(req);
    const uri = {
      xbox: 'ms-settings:gaming-fullscreen', startup: 'ms-settings:startupapps', gaming: 'ms-settings:gaming-gamebar',
      power: 'ms-settings:powersleep', battery: 'ms-settings:batterysaver', update: 'ms-settings:windowsupdate',
      'optional-updates': 'ms-settings:windowsupdate-optionalupdates', bluetooth: 'ms-settings:bluetooth', display: 'ms-settings:display',
    }[b.page];
    if (!uri) return json(res, 400, { error: 'Page inconnue' });
    json(res, 200, await run({ kind: 'uri', target: uri }));
  },
  // Veille, redémarrage, extinction : volontairement simulés dans le prototype.
  'POST /api/action': async (req, res) => { const b = await readBody(req); json(res, 200, { ok: true, simulated: true, action: b.action }); },
  'POST /api/exit': async (req, res) => {
    const b = await readBody(req);
    const steps = await sys.toDesktop(EDGE_PROFILE, !!b.dry);
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
    if (!(await device.allowedTargets(b.simulate)).has(target) && !oemUpdates.allowed(target)) return json(res, 400, { error: 'Cible non autorisée' });
    json(res, 200, await run({ kind: 'uri', target }));
  },
  'GET /api/drivers': (req, res) => json(res, 200, driverJobs.status()),
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
  'POST /api/update/check': async (req, res) => {
    try { updateState.last = await update.check(ROOT, config().updateChannel); json(res, 200, updateState.last); }
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
    if (['stable', 'beta'].includes(b.channel)) { c.updateChannel = b.channel; updateState.last = null; }
    if (typeof b.auto === 'boolean') c.updateAuto = b.auto;
    writeJson(FILES.config, c);
    json(res, 200, { ok: true });
  },
  'POST /api/update/page': async (req, res) => json(res, 200, await run({ kind: 'uri', target: update.PAGE })),

  // --- Réglages système (accès rapide) et profils d'énergie (voir lib/syscontrol.js)
  'GET /api/sys': async (req, res, q) => {
    try {
      const hh = (await device.info().catch(() => ({}))).handheld;
      json(res, 200, { ...(await sysctl.state(q.get('refresh') === '1')), mode: config().perfMode || null, handheld: hh ? hh.id : null });
    }
    catch (e) { json(res, 500, { error: e.message }); }
  },
  // Mesures en direct (accès rapide ouvert) : fréquence réelle du processeur, charge, watts sur batterie
  'GET /api/sys/live': async (req, res) => {
    try { json(res, 200, await sysctl.live()); }
    catch (e) { json(res, 500, { error: e.message }); }
  },
  'POST /api/sys': async (req, res) => {
    const b = await readBody(req);
    const cmd = String(b.cmd || '');
    try {
      const r = await sysctl.call(cmd, { value: b.value, kind: b.kind });
      // Un réglage de performance changé à la main : le mode devient « personnalisé »
      if (['powermode', 'vendor', 'tdp', 'cpumax', 'boost'].includes(cmd)) setPerfMode('custom');
      json(res, 200, r);
    } catch (e) { json(res, 400, { error: e.message }); }
  },
  // Mode de performance (Économie, Équilibré, Performance) : tout est appliqué d'un coup
  'POST /api/power/mode': async (req, res) => {
    const b = await readBody(req);
    if (!PERF_MODES.includes(b.mode)) return json(res, 400, { error: 'Mode inconnu' });
    const profile = await expandProfile({ mode: b.mode });
    const r = await sysctl.apply(profile);
    if (!r.errors.length || r.done.length) setPerfMode(b.mode);
    const st = await sysctl.state(true).catch(() => null);
    const hh = (await device.info().catch(() => ({}))).handheld;
    json(res, 200, { mode: b.mode, applied: profile, ...r, state: st && { ...st, mode: config().perfMode || null, handheld: hh ? hh.id : null } });
  },
  'GET /api/power/profiles': (req, res) => json(res, 200, powerProfiles()),
  'POST /api/power/profiles': async (req, res) => {
    const b = await readBody(req);
    const c = config();
    const p = powerProfiles();
    if (typeof b.auto === 'boolean') p.auto = b.auto;
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
    const p = powerProfiles();
    const src = b.source === 'battery' ? 'battery' : 'ac';
    if (!p.auto && !b.force) return json(res, 200, { skipped: true });
    const prof = p[src] || {};
    const r = await sysctl.apply(await expandProfile(prof));
    if (prof.mode) setPerfMode(Object.keys(prof).length === 1 ? prof.mode : 'custom');
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
  // Ouvre l'écran de streaming (ou le ramène devant, là où il en était)
  'POST /api/stream/open': async (req, res) => {
    if (!kp.exe) return json(res, 404, { error: 'Moteur de streaming absent' });
    const r = await run({ kind: 'exe', target: kp.exe, args: '', env: kaneplay.env('show', { icon: KANEMODE_ICON, accent: config().accent }) });
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
  'GET /api/media': (req, res) => {
    const all = allEntries(false);
    const names = new Map(all.games.filter(g => g.steamAppId).map(g => [String(g.steamAppId), g.name]));
    json(res, 200, sys.listMedia(all.steamUserdata).map(m => ({
      url: '/mediafile?path=' + encodeURIComponent(m.path), kind: m.kind, date: m.date, size: m.size,
      source: m.label, game: m.appid ? names.get(m.appid) || null : null, name: m.name,
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
    if (p === '/mediafile') {
      const f = url.searchParams.get('path') || '';
      if (!sys.isMediaPath(f, allEntries(false).steamUserdata)) { res.writeHead(404); return res.end(); }
      return sendFile(res, f, req);
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

// Premier lancement (PC neuf) : la bibliothèque n'existe pas encore, on la construit tout de suite
if (!isFile(FILES.library)) {
  console.log('Premier lancement : analyse de la bibliothèque');
  runPs('scan.ps1', ['-DataDir', DATA]).then(() => { scanEmulation(); version++; });
}
refreshKanePlay();
setInterval(refreshKanePlay, 60e3);
// Préchauffage : appareil et réglages système prêts avant que l'accès rapide ne les demande
setTimeout(() => { device.info().then(() => sysctl.state()).catch(() => {}); }, 1500); // nouveaux PC appairés, nouvelles applis sur l'hôte
