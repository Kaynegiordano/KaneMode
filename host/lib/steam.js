// Données Steam lues sur le disque : temps de jeu, jeux possédés non installés,
// visuels personnalisés (dossier grid), cache de la bibliothèque, jeux non-Steam.
'use strict';
const fs = require('fs');
const path = require('path');

const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp'];

// ---------- VDF texte (localconfig.vdf, libraryfolders.vdf…) ----------
function parseVdf(text) {
  let i = 0;
  const n = text.length;
  const skip = () => {
    while (i < n) {
      if (text[i] === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; }
      else if (/\s/.test(text[i])) i++;
      else break;
    }
  };
  const str = () => {
    let s = '';
    if (text[i] === '"') {
      i++;
      while (i < n && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < n) { const c = text[i + 1]; s += c === 'n' ? '\n' : c === 't' ? '\t' : c; i += 2; }
        else s += text[i++];
      }
      i++;
      return s;
    }
    while (i < n && !/[\s{}"]/.test(text[i])) s += text[i++];
    return s;
  };
  const obj = () => {
    const o = {};
    for (;;) {
      skip();
      if (i >= n) return o;
      if (text[i] === '}') { i++; return o; }
      const k = str();
      skip();
      if (text[i] === '{') { i++; o[k] = obj(); } else o[k] = str();
    }
  };
  return obj();
}
// Accès insensible à la casse (Steam mélange « Software » et « software »…)
function ci(o, ...keys) {
  for (const k of keys) {
    if (!o || typeof o !== 'object') return undefined;
    const hit = Object.keys(o).find(x => x.toLowerCase() === k.toLowerCase());
    o = hit === undefined ? undefined : o[hit];
  }
  return o;
}

// ---------- VDF binaire (shortcuts.vdf) ----------
function parseBinaryVdf(buf) {
  let i = 0;
  const readStr = () => { const end = buf.indexOf(0, i); const s = buf.toString('utf8', i, end); i = end + 1; return s; };
  const readMap = () => {
    const obj = {};
    while (i < buf.length) {
      const type = buf[i++];
      if (type === 0x08) return obj;
      const key = readStr();
      if (type === 0x00) obj[key] = readMap();
      else if (type === 0x01) obj[key] = readStr();
      else if (type === 0x02) { obj[key] = buf.readUInt32LE(i); i += 4; }
      else if (type === 0x07) { obj[key] = Number(buf.readBigUInt64LE(i)); i += 8; }
      else return obj;
    }
    return obj;
  };
  return readMap();
}

// ---------- Utilisateur actif ----------
function users(userdata) {
  if (!userdata || !fs.existsSync(userdata)) return [];
  return fs.readdirSync(userdata).filter(u => /^\d+$/.test(u) && u !== '0')
    .map(u => { let m = 0; try { m = fs.statSync(path.join(userdata, u, 'config', 'localconfig.vdf')).mtimeMs; } catch { /* absent */ } return { uid: u, mtime: m }; })
    .sort((a, b) => b.mtime - a.mtime);
}

// Temps de jeu et dernière session de tous les jeux lancés un jour (installés ou non).
let localCache = { file: null, mtime: 0, apps: {} };
function localApps(userdata) {
  const u = users(userdata)[0];
  if (!u) return {};
  const file = path.join(userdata, u.uid, 'config', 'localconfig.vdf');
  if (localCache.file === file && localCache.mtime === u.mtime) return localCache.apps;
  const apps = {};
  try {
    const root = parseVdf(fs.readFileSync(file, 'utf8'));
    const list = ci(root, 'UserLocalConfigStore', 'Software', 'Valve', 'Steam', 'apps') || {};
    for (const [id, a] of Object.entries(list)) {
      if (!/^\d+$/.test(id)) continue;
      apps[id] = { playtime: +(ci(a, 'Playtime') || 0), lastPlayed: +(ci(a, 'LastPlayed') || 0) };
    }
  } catch { /* fichier verrouillé ou illisible : on garde le cache */ }
  localCache = { file, mtime: u.mtime, apps };
  return apps;
}

// Visuels personnalisés de Steam (ceux posés par SteamGridDB / SGDBoop / Steam ROM Manager).
function gridDir(userdata) {
  const u = users(userdata)[0];
  return u ? path.join(userdata, u.uid, 'config', 'grid') : null;
}
// Contenu du dossier grid, relu seulement quand il change : une recherche par jeu et par visuel
// y coûtait sinon une vingtaine d'accès disque par jeu
const gridMemo = { dir: null, mtime: 0, at: 0, files: new Map() };
function gridFiles(dir) {
  if (gridMemo.dir === dir && Date.now() - gridMemo.at < 2000) return gridMemo.files;
  let mtime = 0;
  try { mtime = fs.statSync(dir).mtimeMs; } catch { /* pas de dossier grid */ }
  if (gridMemo.dir !== dir || gridMemo.mtime !== mtime) {
    const files = new Map();
    try { for (const f of fs.readdirSync(dir)) files.set(f.toLowerCase(), f); } catch { /* absent */ }
    Object.assign(gridMemo, { dir, mtime, files });
  }
  gridMemo.at = Date.now();
  return gridMemo.files;
}
function gridArt(dir, appid) {
  const art = {};
  if (!dir) return art;
  const files = gridFiles(dir);
  const find = suffix => {
    for (const ext of IMAGE_EXT) { const f = files.get((appid + suffix + ext).toLowerCase()); if (f) return path.join(dir, f); }
    return null;
  };
  art.portrait = find('p'); art.hero = find('_hero'); art.logo = find('_logo'); art.header = find(''); art.icon = find('_icon');
  return art;
}

// Cache de la bibliothèque Steam (jaquettes officielles déjà téléchargées par Steam).
const cacheMemo = new Map();
function cacheArt(steamRoot, appid) {
  const key = steamRoot + '|' + appid;
  const memo = cacheMemo.get(key);
  if (memo && Date.now() - memo.at < 120e3) return memo.art;
  const dir = path.join(steamRoot, 'appcache', 'librarycache', String(appid));
  const files = [];
  const walk = d => { try { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else files.push(f); } } catch { /* absent */ } };
  walk(dir);
  const pick = names => { for (const n of names) { const f = files.find(x => path.basename(x).toLowerCase() === n); if (f) return f; } return null; };
  const art = {
    portrait: pick(['library_600x900.jpg', 'library_capsule.jpg']), hero: pick(['library_hero.jpg']),
    logo: pick(['logo.png']), header: pick(['library_header.jpg', 'header.jpg']),
  };
  cacheMemo.set(key, { at: Date.now(), art });
  return art;
}

// ---------- Jeux non-Steam ajoutés dans Steam ----------
function shortcuts(userdata) {
  const out = [];
  for (const { uid } of users(userdata)) {
    const cfg = path.join(userdata, uid, 'config');
    const file = path.join(cfg, 'shortcuts.vdf');
    if (!isFile(file)) continue;
    let root;
    try { root = parseBinaryVdf(fs.readFileSync(file)); } catch { continue; }
    const grid = path.join(cfg, 'grid');
    for (const sc of Object.values(root.shortcuts || root.Shortcuts || {})) {
      const name = sc.AppName || sc.appname;
      const exe = String(sc.Exe || sc.exe || '').replace(/^"|"$/g, '');
      if (!name || !exe || sc.IsHidden) continue;
      const appid = (sc.appid >>> 0);
      const gameId = ((BigInt(appid) << 32n) | 0x02000000n).toString();
      const icon = String(sc.icon || '').replace(/^"|"$/g, '');
      const art = gridArt(grid, appid);
      if (!art.icon && isFile(icon) && IMAGE_EXT.includes(path.extname(icon).toLowerCase())) art.icon = icon;
      out.push({
        id: `steamsc:${uid}:${appid}`, source: 'steam', shortcut: true, name, type: 'game',
        installed: isFile(exe), lastPlayed: sc.LastPlayTime || 0, sizeOnDisk: 0,
        installDir: String(sc.StartDir || '').replace(/^"|"$/g, '') || path.dirname(exe),
        launch: { kind: 'uri', target: `steam://rungameid/${gameId}` }, art,
      });
    }
  }
  return out;
}

module.exports = { parseVdf, ci, localApps, gridDir, gridArt, cacheArt, shortcuts, users };
