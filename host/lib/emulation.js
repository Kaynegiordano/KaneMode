// Émulation : consoles, émulateurs (détection automatique ou chemin choisi), scan des ROMs.
// Convention des dossiers de ROMs compatible EmulationStation-DE / RetroBat :
//   <dossier ROMs>/<console>/<jeu>.<ext>   (ex. D:\ROMs\snes\Super Mario World.sfc)
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };
// Date d'arrivée du jeu dans le dossier (création du fichier sous Windows) : rangée « Ajoutés récemment »
const addedAt = p => { try { const st = fs.statSync(p); return Math.floor(st.birthtimeMs || st.mtimeMs); } catch { return 0; } };
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// ---------- Consoles ----------
// folders : noms de dossiers reconnus ; exts : formats du jeu lui-même, par ordre de préférence
// (un .cue passe avant ses .bin) ; cores : cœurs RetroArch par ordre de préférence.
// Les archives .zip, .7z et .rar sont acceptées partout (voir archiveMode)
const SYSTEMS = [
  { id: 'nes', name: 'Nintendo NES', maker: 'Nintendo', folders: ['nes', 'famicom', 'fds'], exts: ['nes', 'fds', 'unf', 'unif'], emus: ['mesen', 'retroarch'], cores: ['mesen', 'nestopia', 'fceumm'] },
  { id: 'snes', name: 'Super Nintendo', maker: 'Nintendo', folders: ['snes', 'sfc', 'superfamicom', 'snesna'], exts: ['sfc', 'smc', 'fig', 'swc', 'bs', 'st'], emus: ['retroarch', 'snes9x', 'bsnes'], cores: ['snes9x', 'bsnes', 'mesen-s'] },
  { id: 'n64', name: 'Nintendo 64', maker: 'Nintendo', folders: ['n64'], exts: ['z64', 'n64', 'v64', 'ndd'], emus: ['retroarch', 'project64', 'ares'], cores: ['mupen64plus_next', 'parallel_n64'] },
  { id: 'gb', name: 'Game Boy', maker: 'Nintendo', folders: ['gb', 'gameboy'], exts: ['gb', 'sgb', 'dmg'], emus: ['retroarch', 'mgba'], cores: ['gambatte', 'sameboy', 'mgba'] },
  { id: 'gbc', name: 'Game Boy Color', maker: 'Nintendo', folders: ['gbc', 'gameboycolor'], exts: ['gbc', 'gb'], emus: ['retroarch', 'mgba'], cores: ['gambatte', 'sameboy', 'mgba'] },
  { id: 'gba', name: 'Game Boy Advance', maker: 'Nintendo', folders: ['gba', 'gameboyadvance'], exts: ['gba', 'agb'], emus: ['retroarch', 'mgba'], cores: ['mgba', 'vba_next'] },
  { id: 'nds', name: 'Nintendo DS', maker: 'Nintendo', folders: ['nds', 'ds'], exts: ['nds', 'srl', 'dsi'], emus: ['retroarch', 'melonds'], cores: ['melondsds', 'melonds', 'desmume'] },
  { id: 'n3ds', name: 'Nintendo 3DS', maker: 'Nintendo', folders: ['n3ds', '3ds'], exts: ['3ds', 'cci', 'cxi', 'zcci', 'zcxi', 'app', '3dsx', 'elf'], emus: ['azahar', 'lime3ds', 'citra'] },
  { id: 'gc', name: 'GameCube', maker: 'Nintendo', folders: ['gc', 'gamecube', 'ngc'], exts: ['rvz', 'iso', 'gcm', 'gcz', 'ciso', 'tgc', 'dol', 'elf'], emus: ['dolphin', 'retroarch'], cores: ['dolphin'] },
  { id: 'wii', name: 'Wii', maker: 'Nintendo', folders: ['wii'], exts: ['rvz', 'wbfs', 'iso', 'wia', 'gcz', 'ciso', 'wad', 'dol', 'elf'], emus: ['dolphin', 'retroarch'], cores: ['dolphin'] },
  { id: 'wiiu', name: 'Wii U', maker: 'Nintendo', folders: ['wiiu'], exts: ['wua', 'wux', 'wud', 'wuhb', 'rpx'], emus: ['cemu'] },
  // Switch : aussi un jeu décompressé (dossier avec exefs/main et romfs, ou base/…) et l'image .iso
  // d'un tel dossier, montée par Windows au lancement (mount) plutôt que copiée
  { id: 'switch', name: 'Nintendo Switch', maker: 'Nintendo', folders: ['switch', 'nsw'], exts: ['xci', 'nsp', 'nca', 'nro', 'nso', 'iso'], mount: ['iso'], dirGames: ['exefs/main', 'base/exefs/main'], emus: ['eden', 'ryujinx', 'citron'] },
  { id: 'switch2', name: 'Nintendo Switch 2', maker: 'Nintendo', folders: ['switch2', 'ns2'], exts: ['xci', 'nsp', 'nca', 'iso'], mount: ['iso'], dirGames: ['exefs/main', 'base/exefs/main'], emus: ['lichii'], experimental: true },
  { id: 'psx', name: 'PlayStation', maker: 'Sony', folders: ['psx', 'ps1', 'playstation'], exts: ['m3u', 'chd', 'cue', 'ccd', 'mds', 'pbp', 'ecm', 'iso', 'img', 'bin', 'exe'], emus: ['duckstation', 'retroarch'], cores: ['swanstation', 'mednafen_psx_hw', 'pcsx_rearmed'] },
  { id: 'ps2', name: 'PlayStation 2', maker: 'Sony', folders: ['ps2', 'playstation2'], exts: ['chd', 'iso', 'cso', 'zso', 'gz', 'mdf', 'nrg', 'img', 'bin', 'elf'], emus: ['pcsx2'] },
  { id: 'ps3', name: 'PlayStation 3', maker: 'Sony', folders: ['ps3', 'playstation3'], exts: ['iso'], dirGames: 'PS3_GAME/USRDIR/EBOOT.BIN', emus: ['rpcs3'] },
  { id: 'ps4', name: 'PlayStation 4', maker: 'Sony', folders: ['ps4', 'playstation4'], exts: [], dirGames: 'eboot.bin', emus: ['shadps4'], experimental: true },
  { id: 'psvita', name: 'PlayStation Vita', maker: 'Sony', folders: ['psvita', 'vita'], exts: ['vpk'], emus: ['vita3k'], experimental: true },
  { id: 'psp', name: 'PlayStation Portable', maker: 'Sony', folders: ['psp'], exts: ['iso', 'cso', 'zso', 'pbp', 'chd', 'elf', 'prx'], emus: ['ppsspp', 'retroarch'], cores: ['ppsspp'] },
  { id: 'megadrive', name: 'Mega Drive', maker: 'Sega', folders: ['megadrive', 'genesis', 'md'], exts: ['md', 'gen', 'smd', 'bin', '68k', 'sgd'], emus: ['retroarch'], cores: ['genesis_plus_gx', 'picodrive'] },
  { id: 'mastersystem', name: 'Master System', maker: 'Sega', folders: ['mastersystem', 'sms'], exts: ['sms', 'sg', 'bin'], emus: ['retroarch'], cores: ['genesis_plus_gx', 'picodrive'] },
  { id: 'gamegear', name: 'Game Gear', maker: 'Sega', folders: ['gamegear', 'gg'], exts: ['gg', 'bin'], emus: ['retroarch'], cores: ['genesis_plus_gx'] },
  { id: 'segacd', name: 'Mega-CD', maker: 'Sega', folders: ['segacd', 'megacd'], exts: ['m3u', 'chd', 'cue', 'iso'], emus: ['retroarch'], cores: ['genesis_plus_gx', 'picodrive'] },
  { id: 'saturn', name: 'Saturn', maker: 'Sega', folders: ['saturn'], exts: ['m3u', 'chd', 'cue', 'ccd', 'mds', 'iso'], emus: ['retroarch'], cores: ['mednafen_saturn', 'yabasanshiro'] },
  { id: 'dreamcast', name: 'Dreamcast', maker: 'Sega', folders: ['dreamcast', 'dc'], exts: ['m3u', 'chd', 'gdi', 'cdi', 'cue'], emus: ['retroarch', 'flycast'], cores: ['flycast'] },
  { id: 'pcengine', name: 'PC Engine', maker: 'NEC', folders: ['pcengine', 'tg16', 'pce'], exts: ['pce', 'sgx', 'm3u', 'chd', 'cue', 'ccd'], emus: ['retroarch'], cores: ['mednafen_pce_fast', 'mednafen_pce'] },
  { id: 'neogeo', name: 'Neo Geo', maker: 'SNK', folders: ['neogeo'], exts: ['zip', '7z'], emus: ['retroarch'], cores: ['fbneo'] },
  { id: 'arcade', name: 'Arcade', maker: 'Arcade', folders: ['arcade', 'mame', 'fbneo', 'fba'], exts: ['zip', '7z'], emus: ['retroarch'], cores: ['fbneo', 'mame'] },
  { id: 'atari2600', name: 'Atari 2600', maker: 'Atari', folders: ['atari2600', 'a2600'], exts: ['a26', 'bin'], emus: ['retroarch'], cores: ['stella', 'stella2014'] },
  { id: 'xbox', name: 'Xbox', maker: 'Microsoft', folders: ['xbox'], exts: ['iso', 'xiso'], emus: ['xemu'] },
  { id: 'xbox360', name: 'Xbox 360', maker: 'Microsoft', folders: ['xbox360', 'x360'], exts: ['iso', 'xex', 'zar'], emus: ['xenia'] },
];
const ARCHIVES = ['zip', '7z', 'rar'];
// Archive d'un jeu : « game » (l'archive est le jeu : arcade), « direct » (RetroArch ouvre lui-même
// les .zip et .7z des cartouches), sinon KaneMode la décompresse au lancement (emu-archive.js)
const DIRECT = ['nes', 'snes', 'n64', 'gb', 'gbc', 'gba', 'nds', 'megadrive', 'mastersystem', 'gamegear', 'pcengine', 'atari2600'];
function archiveMode(sys, ext) {
  if ((sys.mount || []).includes(ext)) return 'mount';
  if (sys.exts.includes(ext)) return 'game';
  if (DIRECT.includes(sys.id) && ext !== 'rar') return 'direct';
  return 'extract';
}

// ---------- Contenu des archives ----------
// RetroArch ouvre le premier fichier reconnu d'une archive : la puce « Lock-on » de Sonic &
// Knuckles (.bin) au lieu du jeu (.md), une piste de Sonic CD comme une cartouche… KaneMode
// regarde donc ce qu'il y a dedans : le bon fichier est nommé à RetroArch (« jeu.zip#jeu.md »),
// et un jeu CD rangé avec les cartouches part vers sa console (Mega Drive → Mega-CD).
const DISC_EXTS = ['cue', 'chd', 'iso', 'gdi', 'ccd', 'mds', 'cdi', 'm3u'];
const CD_OF = { megadrive: 'segacd' };
const extOf = n => path.extname(n).slice(1).toLowerCase();

/** Fichiers d'un .zip lus dans son répertoire central (rien n'est décompressé), ou null. */
function zipEntries(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) return null;
    let cdSize = tail.readUInt32LE(eocd + 12), cdOff = tail.readUInt32LE(eocd + 16);
    // Zip64 (archive de plus de 4 Go) : le vrai répertoire est décrit juste avant
    if ((cdOff === 0xffffffff || cdSize === 0xffffffff) && eocd >= 20 && tail.readUInt32LE(eocd - 20) === 0x07064b50) {
      const z = Buffer.alloc(56);
      fs.readSync(fd, z, 0, 56, Number(tail.readBigUInt64LE(eocd - 12)));
      if (z.readUInt32LE(0) !== 0x06064b50) return null;
      cdSize = Number(z.readBigUInt64LE(40)); cdOff = Number(z.readBigUInt64LE(48));
    }
    if (cdSize > 32 << 20) return null;
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOff);
    const out = [];
    for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50;) {
      const utf8 = cd.readUInt16LE(p + 8) & 0x800;
      let usize = cd.readUInt32LE(p + 24);
      const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
      const name = cd.toString(utf8 ? 'utf8' : 'latin1', p + 46, p + 46 + nl);
      if (usize === 0xffffffff) {
        for (let x = p + 46 + nl; x + 4 <= p + 46 + nl + xl;) {
          const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2);
          if (id === 1 && len >= 8) { usize = Number(cd.readBigUInt64LE(x + 4)); break; }
          x += 4 + len;
        }
      }
      if (!name.endsWith('/')) out.push({ name, size: usize });
      p += 46 + nl + xl + cl;
    }
    return out;
  } catch { return null; } finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* déjà fermé */ } }
}

// .7z : listé par le tar de Windows (libarchive), une fois par version du fichier
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
const listed = new Map();
function sevenEntries(file) {
  let key;
  try { const st = fs.statSync(file); key = `${file}|${st.size}|${Math.floor(st.mtimeMs)}`; } catch { return null; }
  if (listed.has(key)) return listed.get(key);
  let out = null;
  try {
    const text = require('child_process').execFileSync(TAR, ['-tvf', file], { windowsHide: true, timeout: 15000, encoding: 'utf8', maxBuffer: 8 << 20 });
    out = text.split(/\r?\n/).map(l => /^[-d]\S*\s+\d+\s+\S+\s+\S+\s+(\d+)\s+\S+\s+\d+\s+\S+\s+(.+)$/.exec(l)).filter(Boolean)
      .filter(m => !m[2].endsWith('/')).map(m => ({ name: m[2], size: +m[1] }));
  } catch { out = null; }
  listed.set(key, out);
  return out;
}

/**
 * Archive d'une console à cartouches : { sys, extract } pour un jeu CD (sa console, décompressé au
 * lancement), { inner } quand plusieurs fichiers pourraient être le jeu, sinon null (rien à changer).
 */
function inspectArchive(sys, file, ext) {
  if (!DIRECT.includes(sys.id) || !['zip', '7z'].includes(ext)) return null;
  const list = ext === 'zip' ? zipEntries(file) : sevenEntries(file);
  if (!list || !list.length) return null;
  if (list.some(e => DISC_EXTS.includes(extOf(e.name)))) {
    const cd = CD_OF[sys.id] && SYSTEMS.find(s => s.id === CD_OF[sys.id]);
    return { sys: cd || sys, extract: true };
  }
  const games = list.filter(e => sys.exts.includes(extOf(e.name)));
  if (games.length < 2) return null;
  // Le format propre à la console d'abord (.md avant .bin), puis le plus gros fichier
  games.sort((a, b) => sys.exts.indexOf(extOf(a.name)) - sys.exts.indexOf(extOf(b.name)) || b.size - a.size);
  return { inner: games[0].name };
}
const SYSTEM_BY_FOLDER = new Map();
// Le dossier de jeux préparé par KaneMode porte le nom de la console (« Super Nintendo »)
for (const s of SYSTEMS) for (const f of [...s.folders, s.name.toLowerCase()]) SYSTEM_BY_FOLDER.set(f, s);

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
  { id: 'lichii', name: 'Lichii', exes: ['lichii.exe'], dirs: ['Lichii', 'lichii'], args: '-f -g "{rom}"' },
  { id: 'shadps4', name: 'shadPS4', exes: ['shadPS4.exe'], dirs: ['shadPS4', 'shadps4'], args: '--fullscreen true --game "{rom}"' },
  { id: 'vita3k', name: 'Vita3K', exes: ['Vita3K.exe'], dirs: ['Vita3K', 'vita3k'], args: '-F "{rom}"' },
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
function retroarchCore(exe, sys, wanted) {
  const dir = path.join(path.dirname(exe), 'cores');
  for (const c of wanted ? [wanted] : sys.cores || []) {
    const f = path.join(dir, `${c}_libretro.dll`);
    if (isFile(f)) return f;
  }
  return null;
}

/** Choisit l'émulateur et construit la ligne de commande pour une ROM. */
/** Choisit l'émulateur (et le cœur RetroArch voulu, s'il y en a un) et construit la commande. */
function launchFor(sys, rom, emulators, prefs = {}, wantedCore = null) {
  const order = prefs[sys.id] ? [prefs[sys.id], ...sys.emus] : sys.emus;
  for (const id of order) {
    const found = emulators[id];
    if (!found) continue;
    const def = EMU_BY_ID.get(id);
    let core = null;
    if (id === 'retroarch') {
      const want = wantedCore && (sys.cores || []).includes(wantedCore) ? wantedCore : null;
      core = retroarchCore(found.path, sys, want) || (want ? null : retroarchCore(found.path, sys));
      // RetroArch installé par KaneMode : le cœur manquant est téléchargé au lancement
      if (!core && found.source === 'kanemode' && (sys.cores || []).length) core = path.join(path.dirname(found.path), 'cores', `${want || sys.cores[0]}_libretro.dll`);
      if (!core) continue;
    }
    const args = def.args.replace('{rom}', rom).replace('{core}', core || '');
    return { emulator: def.name, emulatorId: id, core: core ? path.basename(core, '_libretro.dll') : null, launch: { kind: 'exe', target: found.path, args, cwd: path.dirname(found.path) } };
  }
  return null;
}

// ---------- Scan des ROMs ----------
// Nom affiché : sans les étiquettes (région, version) ; un nom de « release » (« FINAL.FANTASY_(EU)_SuperXCI-NX »)
// perd aussi ses points, son groupe et ses majuscules
function cleanName(file) {
  let n = path.basename(file, path.extname(file));
  const release = !/\s/.test(n) && /[._]/.test(n);
  n = n.replace(/_/g, ' ');
  if (release) n = n.replace(/\.(?=\S)/g, ' ');
  n = n.replace(/\s*[[(][^\])]*[\])]/g, '');
  if (release) n = n.replace(/\s+(Super)?(XCI|XCZ|NSP|NSZ)(-\w+)?$/i, '').replace(/\s+-\s*\w+$/, '');
  n = n.replace(/\s{2,}/g, ' ').trim();
  if (release && n === n.toUpperCase()) n = n.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase());
  return n || path.basename(file, path.extname(file));
}
const regionOf = file => { const m = /\((USA|Europe|Japan|World|France|Germany|Spain|Italy|Korea|En[^)]*|Fr[^)]*)\)/i.exec(file); return m ? m[1] : null; };

// Format préféré quand un jeu est là deux fois : celui de la console, puis l'archive
const rank = (sys, ext) => (sys.exts.includes(ext) ? sys.exts.indexOf(ext) : 100 + ARCHIVES.indexOf(ext));

// Consoles dont l'émulateur choisi lit une liste .m3u de disques
const M3U_SYSTEMS = ['psx', 'saturn', 'segacd', 'dreamcast', 'pcengine'];

function scanSystemDir(sys, dir, out, depth = 0, m3uDir = null) {
  const startAt = out.length;
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
  // Même jeu en deux formats (« Sonic.zip » et « Sonic.sms ») : le format natif, premier de exts
  const games = new Map();
  // Jeu CD rangé avec les cartouches (Sonic CD en .cue dans « Mega Drive ») : compté pour sa console
  const cdSys = CD_OF[sys.id] && SYSTEMS.find(s => s.id === CD_OF[sys.id]);
  const sysFor = ext => (!sys.exts.includes(ext) && cdSys && cdSys.exts.includes(ext) ? cdSys : sys);
  for (const f of files) {
    const ext = path.extname(f).slice(1).toLowerCase();
    if ((!sysFor(ext).exts.includes(ext) && !ARCHIVES.includes(ext)) || hidden.has(f.toLowerCase())) continue;
    const base = path.basename(f, path.extname(f)).toLowerCase();
    const prev = games.get(base);
    if (!prev || rank(sys, ext) < rank(sys, path.extname(prev).slice(1).toLowerCase())) games.set(base, f);
  }
  // Disques d'un même jeu sans .m3u : une seule entrée, une liste .m3u écrite par KaneMode pour
  // changer de disque en jeu (consoles dont l'émulateur la lit), sinon le disque 1
  const DISC = /\s*\((?:disc|disque|cd)\s*(\d+)(?:\s*of\s*\d+)?\)/i;
  const discs = new Map();
  for (const f of games.values()) {
    const m = DISC.exec(f);
    if (!m) continue;
    const k = f.replace(DISC, '').toLowerCase();
    if (!discs.has(k)) discs.set(k, []);
    discs.get(k).push({ f, n: +m[1] });
  }
  for (const set of discs.values()) {
    if (set.length < 2) continue;
    set.sort((a, b) => a.n - b.n);
    for (const d of set.slice(1)) games.delete(path.basename(d.f, path.extname(d.f)).toLowerCase());
    const first = set[0].f;
    const title = first.replace(DISC, '');
    if (M3U_SYSTEMS.includes(sys.id) && m3uDir) {
      try {
        fs.mkdirSync(m3uDir, { recursive: true });
        const list = path.join(m3uDir, path.basename(title, path.extname(title)) + '.m3u');
        fs.writeFileSync(list, set.map(d => path.join(dir, d.f)).join('\r\n') + '\r\n');
        games.set(path.basename(first, path.extname(first)).toLowerCase(), { list, title, discs: set.length });
      } catch { /* le disque 1 reste jouable */ }
    }
  }
  for (const f of games.values()) {
    if (typeof f === 'object') {
      out.push({ sys, path: f.list, name: cleanName(f.title), region: regionOf(f.title), size: 0, discs: f.discs, romFile: path.join(dir, f.title) });
      continue;
    }
    const full = path.join(dir, f);
    let size = 0; try { size = fs.statSync(full).size; } catch { /* ignoré */ }
    const ext = path.extname(f).slice(1).toLowerCase();
    const look = ARCHIVES.includes(ext) ? inspectArchive(sys, full, ext) : null;
    const own = (look && look.sys) || sysFor(ext);
    const mode = look && look.extract ? 'extract' : archiveMode(own, ext);
    out.push({ sys: own, path: full, name: cleanName(f.replace(DISC, '')), region: regionOf(f), size, archive: mode === 'extract' || mode === 'mount' ? mode : null, inner: (look && look.inner) || null });
  }
  const dirsFrom = out.length;
  for (const e of entries) {
    if (!e.isDirectory() || /^(media|images|videos|manuals|downloaded_media|\.)/i.test(e.name)) continue;
    const sub = path.join(dir, e.name);
    const inner = [].concat(sys.dirGames || []).find(g => isFile(path.join(sub, g)));
    if (inner) {
      out.push({ sys, path: path.join(sub, inner), name: cleanName(e.name), region: regionOf(e.name), size: 0, dirGame: true });
    } else if (depth < 2) scanSystemDir(sys, sub, out, depth + 1, m3uDir);
  }
  // Même jeu en dossier décompressé et en image (.iso) : le dossier, qui démarre sans montage
  const folders = new Set(out.slice(dirsFrom).filter(r => r.dirGame && r.sys === sys).map(r => r.name.toLowerCase()));
  if (folders.size) for (let i = dirsFrom - 1; i >= startAt; i--) if (!out[i].dirGame && folders.has(out[i].name.toLowerCase())) out.splice(i, 1);
}

/**
 * settings : réglages choisis par console et par jeu ({ systems: { snes: {…} }, games: { 'rom:…': {…} } }),
 * le jeu l'emporte ; emulator et core changent la commande de lancement.
 */
function scanRoms(roots, emulators, prefs, { m3uDir = null, settings = {} } = {}) {
  const found = [];
  for (const root of roots) {
    if (!isDir(root)) continue;
    const own = SYSTEM_BY_FOLDER.get(path.basename(root).toLowerCase());
    if (own) { scanSystemDir(own, root, found, 0, m3uDir); continue; }
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      const sys = e.isDirectory() && SYSTEM_BY_FOLDER.get(e.name.toLowerCase());
      if (sys) scanSystemDir(sys, path.join(root, e.name), found, 0, m3uDir);
    }
  }
  return found.map(r => {
    const id = 'rom:' + crypto.createHash('sha1').update(r.path.toLowerCase()).digest('hex').slice(0, 12);
    const set = { ...((settings.systems || {})[r.sys.id] || {}), ...((settings.games || {})[id] || {}) };
    const how = launchFor(r.sys, r.path, emulators, set.emulator ? { ...prefs, [r.sys.id]: set.emulator } : prefs, set.core || null);
    // Archive à plusieurs fichiers : RetroArch reçoit le jeu lui-même (« archive.zip#jeu.md »)
    if (how && r.inner && how.emulatorId === 'retroarch') how.launch.args = how.launch.args.split(`"${r.path}"`).join(`"${r.path}#${r.inner}"`);
    return {
      id, source: 'rom', name: r.name, type: 'game', system: r.sys.id, systemName: r.sys.name, region: r.region,
      romPath: r.path, discs: r.discs || null, archive: r.archive || null, installed: !!how, installDir: path.dirname(r.romFile || r.path), sizeOnDisk: r.size, lastPlayed: 0, added: addedAt(r.romFile || r.path),
      emulator: how ? how.emulator : null, emulatorId: how ? how.emulatorId : null, core: how ? how.core : null, launch: how ? how.launch : null, art: {},
    };
  });
}

module.exports = { SYSTEMS, EMULATORS, ARCHIVES, detectEmulators, scanRoms, launchFor, archiveMode, zipEntries, inspectArchive };
