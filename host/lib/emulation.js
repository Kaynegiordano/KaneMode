// Émulation : consoles, émulateurs (détection automatique ou chemin choisi), scan des ROMs.
// Convention des dossiers de ROMs compatible EmulationStation-DE / RetroBat :
//   <dossier ROMs>/<console>/<jeu>.<ext>   (ex. D:\ROMs\snes\Super Mario World.sfc)
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// ---------- Consoles ----------
// folders : noms de dossiers reconnus ; cores : cœurs RetroArch par ordre de préférence
const SYSTEMS = [
  { id: 'nes', name: 'Nintendo NES', maker: 'Nintendo', folders: ['nes', 'famicom', 'fds'], exts: ['nes', 'fds', 'unf', 'unif'], emus: ['mesen', 'retroarch'], cores: ['mesen', 'nestopia', 'fceumm'] },
  { id: 'snes', name: 'Super Nintendo', maker: 'Nintendo', folders: ['snes', 'sfc', 'superfamicom', 'snesna'], exts: ['sfc', 'smc', 'fig', 'swc', 'bs'], emus: ['retroarch', 'snes9x', 'bsnes'], cores: ['snes9x', 'bsnes', 'mesen-s'] },
  { id: 'n64', name: 'Nintendo 64', maker: 'Nintendo', folders: ['n64'], exts: ['n64', 'z64', 'v64'], emus: ['retroarch', 'project64', 'ares'], cores: ['mupen64plus_next', 'parallel_n64'] },
  { id: 'gb', name: 'Game Boy', maker: 'Nintendo', folders: ['gb', 'gameboy'], exts: ['gb'], emus: ['retroarch', 'mgba'], cores: ['gambatte', 'sameboy', 'mgba'] },
  { id: 'gbc', name: 'Game Boy Color', maker: 'Nintendo', folders: ['gbc', 'gameboycolor'], exts: ['gbc'], emus: ['retroarch', 'mgba'], cores: ['gambatte', 'sameboy', 'mgba'] },
  { id: 'gba', name: 'Game Boy Advance', maker: 'Nintendo', folders: ['gba', 'gameboyadvance'], exts: ['gba'], emus: ['mgba', 'retroarch'], cores: ['mgba', 'vba_next'] },
  { id: 'nds', name: 'Nintendo DS', maker: 'Nintendo', folders: ['nds', 'ds'], exts: ['nds'], emus: ['melonds', 'retroarch'], cores: ['melonds', 'desmume'] },
  { id: 'n3ds', name: 'Nintendo 3DS', maker: 'Nintendo', folders: ['n3ds', '3ds'], exts: ['3ds', 'cci', 'cxi', 'app'], emus: ['azahar', 'lime3ds', 'citra'] },
  { id: 'gc', name: 'GameCube', maker: 'Nintendo', folders: ['gc', 'gamecube', 'ngc'], exts: ['iso', 'gcm', 'rvz', 'gcz', 'ciso'], emus: ['dolphin', 'retroarch'], cores: ['dolphin'] },
  { id: 'wii', name: 'Wii', maker: 'Nintendo', folders: ['wii'], exts: ['wbfs', 'iso', 'rvz', 'gcz', 'wad'], emus: ['dolphin', 'retroarch'], cores: ['dolphin'] },
  { id: 'wiiu', name: 'Wii U', maker: 'Nintendo', folders: ['wiiu'], exts: ['wua', 'wux', 'wud', 'rpx'], emus: ['cemu'] },
  { id: 'switch', name: 'Nintendo Switch', maker: 'Nintendo', folders: ['switch', 'nsw'], exts: ['nsp', 'xci', 'nca'], emus: ['ryujinx', 'eden', 'citron'] },
  { id: 'psx', name: 'PlayStation', maker: 'Sony', folders: ['psx', 'ps1', 'playstation'], exts: ['m3u', 'chd', 'cue', 'pbp', 'ecm', 'iso', 'bin'], emus: ['duckstation', 'retroarch'], cores: ['swanstation', 'mednafen_psx_hw', 'pcsx_rearmed'] },
  { id: 'ps2', name: 'PlayStation 2', maker: 'Sony', folders: ['ps2', 'playstation2'], exts: ['chd', 'iso', 'cso', 'gz', 'bin'], emus: ['pcsx2'] },
  { id: 'ps3', name: 'PlayStation 3', maker: 'Sony', folders: ['ps3', 'playstation3'], exts: ['iso'], dirGames: 'PS3_GAME/USRDIR/EBOOT.BIN', emus: ['rpcs3'] },
  { id: 'psp', name: 'PlayStation Portable', maker: 'Sony', folders: ['psp'], exts: ['iso', 'cso', 'pbp', 'chd'], emus: ['ppsspp', 'retroarch'], cores: ['ppsspp'] },
  { id: 'megadrive', name: 'Mega Drive', maker: 'Sega', folders: ['megadrive', 'genesis', 'md'], exts: ['md', 'gen', 'smd', 'bin'], emus: ['retroarch'], cores: ['genesis_plus_gx', 'picodrive'] },
  { id: 'mastersystem', name: 'Master System', maker: 'Sega', folders: ['mastersystem', 'sms'], exts: ['sms'], emus: ['retroarch'], cores: ['genesis_plus_gx', 'picodrive'] },
  { id: 'gamegear', name: 'Game Gear', maker: 'Sega', folders: ['gamegear', 'gg'], exts: ['gg'], emus: ['retroarch'], cores: ['genesis_plus_gx'] },
  { id: 'segacd', name: 'Mega-CD', maker: 'Sega', folders: ['segacd', 'megacd'], exts: ['chd', 'cue', 'iso'], emus: ['retroarch'], cores: ['genesis_plus_gx', 'picodrive'] },
  { id: 'saturn', name: 'Saturn', maker: 'Sega', folders: ['saturn'], exts: ['chd', 'cue', 'm3u'], emus: ['retroarch'], cores: ['mednafen_saturn', 'yabasanshiro'] },
  { id: 'dreamcast', name: 'Dreamcast', maker: 'Sega', folders: ['dreamcast', 'dc'], exts: ['chd', 'gdi', 'cdi', 'm3u'], emus: ['flycast', 'retroarch'], cores: ['flycast'] },
  { id: 'pcengine', name: 'PC Engine', maker: 'NEC', folders: ['pcengine', 'tg16', 'pce'], exts: ['pce', 'chd', 'cue'], emus: ['retroarch'], cores: ['mednafen_pce_fast', 'mednafen_pce'] },
  { id: 'neogeo', name: 'Neo Geo', maker: 'SNK', folders: ['neogeo'], exts: ['zip', '7z'], emus: ['retroarch'], cores: ['fbneo'] },
  { id: 'arcade', name: 'Arcade', maker: 'Arcade', folders: ['arcade', 'mame', 'fbneo', 'fba'], exts: ['zip', '7z'], emus: ['retroarch'], cores: ['fbneo', 'mame'] },
  { id: 'atari2600', name: 'Atari 2600', maker: 'Atari', folders: ['atari2600', 'a2600'], exts: ['a26', 'bin'], emus: ['retroarch'], cores: ['stella', 'stella2014'] },
  { id: 'xbox', name: 'Xbox', maker: 'Microsoft', folders: ['xbox'], exts: ['iso', 'xiso'], emus: ['xemu'] },
  { id: 'xbox360', name: 'Xbox 360', maker: 'Microsoft', folders: ['xbox360', 'x360'], exts: ['iso', 'xex', 'zar'], emus: ['xenia'] },
];
const SYSTEM_BY_FOLDER = new Map();
for (const s of SYSTEMS) for (const f of s.folders) SYSTEM_BY_FOLDER.set(f, s);

// ---------- Émulateurs ----------
// exes : exécutables reconnus ; dirs : noms de dossiers d'installation probables ; args : {rom}, {core}
const EMULATORS = [
  { id: 'retroarch', name: 'RetroArch', exes: ['retroarch.exe'], dirs: ['RetroArch', 'RetroArch-Win64'], args: '-f -L "{core}" "{rom}"' },
  { id: 'dolphin', name: 'Dolphin', exes: ['Dolphin.exe'], dirs: ['Dolphin', 'Dolphin-x64', 'Dolphin Emulator'], args: '-b -e "{rom}"' },
  { id: 'pcsx2', name: 'PCSX2', exes: ['pcsx2-qt.exe', 'pcsx2.exe', 'pcsx2x64.exe'], dirs: ['PCSX2'], args: '-batch -fullscreen "{rom}"' },
  { id: 'duckstation', name: 'DuckStation', exes: ['duckstation-qt-x64-ReleaseLTCG.exe', 'duckstation-qt.exe'], dirs: ['DuckStation', 'duckstation'], args: '-batch -fullscreen "{rom}"' },
  { id: 'rpcs3', name: 'RPCS3', exes: ['rpcs3.exe'], dirs: ['RPCS3', 'rpcs3'], args: '--no-gui "{rom}"' },
  { id: 'ppsspp', name: 'PPSSPP', exes: ['PPSSPPWindows64.exe', 'PPSSPPWindows.exe'], dirs: ['PPSSPP'], args: '--fullscreen "{rom}"' },
  { id: 'cemu', name: 'Cemu', exes: ['Cemu.exe'], dirs: ['Cemu'], args: '-f -g "{rom}"' },
  { id: 'ryujinx', name: 'Ryujinx / Ryubing', exes: ['Ryujinx.exe'], dirs: ['Ryujinx', 'Ryubing', 'publish'], args: '--fullscreen "{rom}"' },
  { id: 'eden', name: 'Eden', exes: ['eden.exe'], dirs: ['Eden', 'eden'], args: '-f -g "{rom}"' },
  { id: 'citron', name: 'Citron', exes: ['citron.exe'], dirs: ['Citron', 'citron'], args: '-f -g "{rom}"' },
  { id: 'azahar', name: 'Azahar', exes: ['azahar.exe'], dirs: ['Azahar', 'azahar'], args: '-f "{rom}"' },
  { id: 'lime3ds', name: 'Lime3DS', exes: ['lime3ds.exe', 'lime3ds-gui.exe'], dirs: ['Lime3DS', 'lime3ds'], args: '-f "{rom}"' },
  { id: 'citra', name: 'Citra', exes: ['citra-qt.exe'], dirs: ['Citra', 'citra', 'nightly'], args: '-f "{rom}"' },
  { id: 'melonds', name: 'melonDS', exes: ['melonDS.exe'], dirs: ['melonDS'], args: '-f "{rom}"' },
  { id: 'mgba', name: 'mGBA', exes: ['mGBA.exe'], dirs: ['mGBA'], args: '-f "{rom}"' },
  { id: 'mesen', name: 'Mesen', exes: ['Mesen.exe'], dirs: ['Mesen', 'Mesen2'], args: '--fullscreen "{rom}"' },
  { id: 'snes9x', name: 'Snes9x', exes: ['snes9x-x64.exe', 'snes9x.exe'], dirs: ['Snes9x', 'snes9x'], args: '-fullscreen "{rom}"' },
  { id: 'bsnes', name: 'bsnes', exes: ['bsnes.exe'], dirs: ['bsnes'], args: '--fullscreen "{rom}"' },
  { id: 'project64', name: 'Project64', exes: ['Project64.exe'], dirs: ['Project64 3.0', 'Project64'], args: '"{rom}"' },
  { id: 'ares', name: 'ares', exes: ['ares.exe'], dirs: ['ares'], args: '--fullscreen "{rom}"' },
  { id: 'flycast', name: 'Flycast', exes: ['flycast.exe'], dirs: ['Flycast', 'flycast'], args: '"{rom}"' },
  { id: 'xemu', name: 'xemu', exes: ['xemu.exe'], dirs: ['xemu'], args: '-full-screen -dvd_path "{rom}"' },
  { id: 'xenia', name: 'Xenia', exes: ['xenia_canary.exe', 'xenia.exe'], dirs: ['Xenia', 'xenia', 'xenia_canary'], args: '--fullscreen=true "{rom}"' },
];
const EMU_BY_ID = new Map(EMULATORS.map(e => [e.id, e]));

/** Dossiers où chercher les émulateurs (installations classiques, portables, Scoop, Steam). */
function searchRoots(extra = []) {
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const roots = [
    process.env.ProgramFiles, process.env['ProgramFiles(x86)'], path.join(local, 'Programs'), local, roaming,
    path.join(home, 'scoop', 'apps'), path.join(home, 'Emulators'), path.join(home, 'Documents', 'Emulators'),
    path.join(home, 'Desktop'), path.join(home, 'Downloads'),
  ];
  for (let c = 67; c <= 90; c++) {
    const d = String.fromCharCode(c) + ':\\';
    if (!fs.existsSync(d)) continue;
    roots.push(d, path.join(d, 'Emulators'), path.join(d, 'Emulation'), path.join(d, 'Emulation', 'emulators'), path.join(d, 'Emu'), path.join(d, 'RetroBat', 'emulators'), path.join(d, 'Games', 'Emulators'));
  }
  return [...new Set([...roots, ...extra].filter(r => r && isDir(r)))];
}

/** Cherche chaque émulateur jusqu'à deux niveaux sous les dossiers probables. */
function detectEmulators(configured = {}, extraRoots = []) {
  const found = {};
  for (const [id, p] of Object.entries(configured)) if (EMU_BY_ID.has(id) && isFile(p)) found[id] = { path: p, source: 'manual' };
  const wanted = EMULATORS.filter(e => !found[e.id]);
  const exeIndex = new Map();
  for (const e of wanted) for (const x of e.exes) exeIndex.set(x.toLowerCase(), e);
  const check = dir => {
    let names;
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const n of names) {
      const e = exeIndex.get(n.toLowerCase());
      if (e && !found[e.id]) found[e.id] = { path: path.join(dir, n), source: 'auto' };
    }
    return names;
  };
  const dirNames = new Set(EMULATORS.flatMap(e => e.dirs.map(d => d.toLowerCase())));
  for (const root of searchRoots(extraRoots)) {
    const names = check(root) || [];
    for (const n of names) {
      const sub = path.join(root, n);
      if (!dirNames.has(n.toLowerCase()) && !/emu|retro|dolphin|pcsx|duck|ppsspp|rpcs|cemu|ryu|xemu|xenia|melon|mgba|citra|azahar|lime|flycast|mesen|snes|project64|ares|eden|citron/i.test(n)) continue;
      if (!isDir(sub)) continue;
      const inner = check(sub) || [];
      for (const m of inner) { const d2 = path.join(sub, m); if (/^(bin|app|current|x64|release)$/i.test(m) && isDir(d2)) check(d2); }
    }
    if (wanted.every(e => found[e.id])) break;
  }
  return found;
}

/** Cœur RetroArch disponible pour une console. */
function retroarchCore(exe, sys) {
  const dir = path.join(path.dirname(exe), 'cores');
  for (const c of sys.cores || []) {
    const f = path.join(dir, `${c}_libretro.dll`);
    if (isFile(f)) return f;
  }
  return null;
}

/** Choisit l'émulateur et construit la ligne de commande pour une ROM. */
function launchFor(sys, rom, emulators, prefs = {}) {
  const order = prefs[sys.id] ? [prefs[sys.id], ...sys.emus] : sys.emus;
  for (const id of order) {
    const found = emulators[id];
    if (!found) continue;
    const def = EMU_BY_ID.get(id);
    let core = null;
    if (id === 'retroarch') { core = retroarchCore(found.path, sys); if (!core) continue; }
    const args = def.args.replace('{rom}', rom).replace('{core}', core || '');
    return { emulator: def.name, emulatorId: id, core: core ? path.basename(core, '_libretro.dll') : null, launch: { kind: 'exe', target: found.path, args, cwd: path.dirname(found.path) } };
  }
  return null;
}

// ---------- Scan des ROMs ----------
const cleanName = file => path.basename(file, path.extname(file))
  .replace(/\s*[[(][^\])]*[\])]/g, '').replace(/_/g, ' ').replace(/\s{2,}/g, ' ').trim();
const regionOf = file => { const m = /\((USA|Europe|Japan|World|France|Germany|Spain|Italy|Korea|En[^)]*|Fr[^)]*)\)/i.exec(file); return m ? m[1] : null; };

function scanSystemDir(sys, dir, out, depth = 0) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  const files = entries.filter(e => e.isFile()).map(e => e.name);
  const lower = new Set(files.map(f => f.toLowerCase()));
  // Jeux multi-disques : un .m3u masque ses .cue/.chd ; un .cue masque ses .bin
  const hidden = new Set();
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    if (ext === '.m3u') {
      try { fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/).forEach(l => l.trim() && hidden.add(path.basename(l.trim()).toLowerCase())); } catch { /* ignoré */ }
    }
    if (ext === '.cue' || ext === '.gdi') {
      try { for (const m of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/"([^"]+)"|\s(\S+\.(?:bin|raw|img))/gi)) hidden.add(path.basename(m[1] || m[2]).toLowerCase()); } catch { /* ignoré */ }
    }
  }
  for (const f of files) {
    const ext = path.extname(f).slice(1).toLowerCase();
    if (!sys.exts.includes(ext) || hidden.has(f.toLowerCase())) continue;
    if (ext === 'bin' && [...lower].some(x => x.endsWith('.cue'))) continue;
    const full = path.join(dir, f);
    let size = 0; try { size = fs.statSync(full).size; } catch { /* ignoré */ }
    out.push({ sys, path: full, name: cleanName(f), region: regionOf(f), size });
  }
  for (const e of entries) {
    if (!e.isDirectory() || /^(media|images|videos|manuals|downloaded_media|\.)/i.test(e.name)) continue;
    const sub = path.join(dir, e.name);
    if (sys.dirGames && isFile(path.join(sub, sys.dirGames))) {
      out.push({ sys, path: path.join(sub, sys.dirGames), name: cleanName(e.name), region: regionOf(e.name), size: 0 });
    } else if (depth < 2) scanSystemDir(sys, sub, out, depth + 1);
  }
}

function scanRoms(roots, emulators, prefs) {
  const found = [];
  for (const root of roots) {
    if (!isDir(root)) continue;
    const own = SYSTEM_BY_FOLDER.get(path.basename(root).toLowerCase());
    if (own) { scanSystemDir(own, root, found); continue; }
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      const sys = e.isDirectory() && SYSTEM_BY_FOLDER.get(e.name.toLowerCase());
      if (sys) scanSystemDir(sys, path.join(root, e.name), found);
    }
  }
  return found.map(r => {
    const how = launchFor(r.sys, r.path, emulators, prefs);
    const id = 'rom:' + crypto.createHash('sha1').update(r.path.toLowerCase()).digest('hex').slice(0, 12);
    return {
      id, source: 'rom', name: r.name, type: 'game', system: r.sys.id, systemName: r.sys.name, region: r.region,
      romPath: r.path, installed: !!how, installDir: path.dirname(r.path), sizeOnDisk: r.size, lastPlayed: 0,
      emulator: how ? how.emulator : null, core: how ? how.core : null, launch: how ? how.launch : null, art: {},
    };
  });
}

module.exports = { SYSTEMS, EMULATORS, detectEmulators, scanRoms, launchFor };
