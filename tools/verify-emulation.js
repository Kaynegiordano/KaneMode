'use strict';
// Émulation 4.13 : dossiers nommés comme la console, cœur RetroArch à télécharger, réglages
// fusionnés sans perdre ceux de l'utilisateur, BIOS et clés reconnus.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const emu = require('../host/lib/emulation');
const setup = require('../host/lib/emu-setup');
const store = require('../host/lib/emu-store');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kanemode-emu-'));

test('Un dossier « Super Nintendo » est reconnu et RetroArch de KaneMode y prend son cœur au lancement', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'Super Nintendo'));
  fs.writeFileSync(path.join(root, 'Super Nintendo', 'Mon Jeu (Europe).sfc'), 'x');
  fs.mkdirSync(path.join(root, 'PlayStation 4', 'CUSA00001'), { recursive: true });
  fs.writeFileSync(path.join(root, 'PlayStation 4', 'CUSA00001', 'eboot.bin'), 'x');
  const ra = path.join(root, 'ra', 'retroarch.exe');
  fs.mkdirSync(path.dirname(ra));
  fs.writeFileSync(ra, '');
  const roms = emu.scanRoms([root], { retroarch: { path: ra, source: 'kanemode' } }, {});
  const snes = roms.find(r => r.system === 'snes');
  assert.equal(snes.name, 'Mon Jeu');
  assert.equal(snes.emulatorId, 'retroarch');
  assert.match(snes.launch.args, /cores\\snes9x_libretro\.dll/);
  const ps4 = roms.find(r => r.system === 'ps4');
  assert.ok(ps4 && !ps4.launch, 'jeu PS4 trouvé, émulateur pas encore installé');
});

test('Un RetroArch installé par l\'utilisateur sans le cœur n\'est pas choisi', () => {
  const sys = emu.SYSTEMS.find(s => s.id === 'snes');
  const ra = path.join(tmp(), 'retroarch.exe');
  fs.writeFileSync(ra, '');
  assert.equal(emu.launchFor(sys, 'x.sfc', { retroarch: { path: ra, source: 'auto' } }), null);
});

test('Les réglages écrits gardent ceux de l\'utilisateur', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'settings.ini'), '[Main]\r\nTheme = darkfusion\r\n[Display]\r\nScale = 4\r\n');
  setup.prepare('duckstation', dir, { bios: 'C:\\B', saves: dir });
  const ini = fs.readFileSync(path.join(dir, 'settings.ini'), 'utf8');
  assert.match(ini, /Theme = darkfusion/);
  assert.match(ini, /Scale = 4/);
  assert.match(ini, /StartFullscreen = true/);
  assert.match(ini, /PowerOff = SDL-0\/Back & SDL-0\/Start/);
  assert.match(ini, /\[BIOS\]\r\nSearchDirectory = C:\\B/);
  fs.writeFileSync(path.join(dir, 'retroarch.cfg'), 'video_shader_enable = "true"\nvideo_fullscreen = "false"\n');
  setup.prepare('retroarch', dir, { bios: 'C:\\B', saves: dir });
  const cfg = fs.readFileSync(path.join(dir, 'retroarch.cfg'), 'utf8');
  assert.match(cfg, /video_shader_enable = "true"/);
  assert.match(cfg, /video_fullscreen = "true"/);
  assert.doesNotMatch(cfg, /video_fullscreen = "false"/);
});

test('BIOS PS2 de 4 Mo et clés de la Switch 2 copiées dans l\'émulateur', () => {
  const bios = tmp();
  assert.equal(setup.biosStatus(bios, 'ps2').ok, false);
  fs.writeFileSync(path.join(bios, 'scph39001.bin'), Buffer.alloc(4194304));
  assert.equal(setup.biosStatus(bios, 'ps2').ok, true);
  assert.equal(setup.biosStatus(bios, 'snes'), null);
  fs.mkdirSync(path.join(bios, 'Switch 2'));
  fs.writeFileSync(path.join(bios, 'Switch 2', 'prod.keys'), 'k');
  assert.equal(setup.biosStatus(bios, 'switch2').ok, true);
  const dir = tmp();
  setup.prepare('lichii', dir, { bios, saves: dir });
  assert.ok(fs.existsSync(path.join(dir, 'user', 'keys', 'prod.keys')));
  setup.prepare('pcsx2', dir, { bios, saves: dir });
  assert.match(fs.readFileSync(path.join(dir, 'inis', 'PCSX2.ini'), 'utf8'), /BIOS = scph39001\.bin/);
});

test('Chaque console a un émulateur que KaneMode sait installer', () => {
  for (const s of emu.SYSTEMS) assert.ok(s.emus.some(e => store.CATALOG[e]), s.id);
});

test('Un jeu Master System en .zip est reconnu', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'Master System'));
  fs.writeFileSync(path.join(root, 'Master System', 'Sonic The Hedgehog (USA, Europe).zip'), 'x');
  const roms = emu.scanRoms([root], {}, {});
  assert.equal(roms.length, 1);
  assert.equal(roms[0].system, 'mastersystem');
  assert.equal(roms[0].name, 'Sonic The Hedgehog');
});

test('Même jeu en .zip et .sms : une seule entrée, le format natif', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'Master System'));
  for (const e of ['zip', 'sms']) fs.writeFileSync(path.join(root, 'Master System', `Sonic (Europe).${e}`), 'x');
  const roms = emu.scanRoms([root], {}, {});
  assert.equal(roms.length, 1);
  assert.match(roms[0].romPath, /\.sms$/);
});

test('Disques d\'un jeu PlayStation : une entrée et une liste .m3u', () => {
  const root = tmp(), m3uDir = tmp();
  fs.mkdirSync(path.join(root, 'PlayStation'));
  for (const n of [1, 2, 3]) fs.writeFileSync(path.join(root, 'PlayStation', `Final Fantasy VII (Europe) (Disc ${n}).chd`), 'x');
  const roms = emu.scanRoms([root], {}, {}, { m3uDir });
  assert.equal(roms.length, 1);
  assert.equal(roms[0].name, 'Final Fantasy VII');
  assert.equal(roms[0].discs, 3);
  const list = fs.readFileSync(roms[0].romPath, 'utf8').trim().split(/\r?\n/);
  assert.equal(list.length, 3);
  assert.match(list[2], /Disc 3\)\.chd$/);
});

test('Jaquette libretro : même jeu, région voulue, jamais une bêta', () => {
  const { bestMatch } = require('../host/lib/emu-meta');
  const names = ['Sonic The Hedgehog (USA, Europe, Brazil) (En)', 'Sonic The Hedgehog (Japan) (Beta)', 'Sonic Chaos (Europe, Brazil) (En)'];
  assert.equal(bestMatch('Sonic The Hedgehog (USA, Europe, Brazil) (En)', names), names[0]);
  assert.equal(bestMatch('Sonic The Hedgehog (Europe)', names), names[0]);
  assert.equal(bestMatch('Legend of Zelda, The - A Link to the Past (Europe)', ['Legend of Zelda, The - A Link to the Past (Europe)']), 'Legend of Zelda, The - A Link to the Past (Europe)');
  assert.equal(bestMatch('Ratchet & Clank (Europe)', ['Ratchet _ Clank (Europe)']), 'Ratchet _ Clank (Europe)');
  assert.equal(bestMatch('Inconnu (Europe)', names), null);
});

test('Archives partout : RetroArch ouvre les .zip de cartouche, KaneMode décompresse le reste', () => {
  const root = tmp();
  for (const [dir, file] of [['PlayStation', 'Crash (Europe).zip'], ['PlayStation 2', 'Okami (Europe).7z'], ['Super Nintendo', 'F-Zero (Europe).zip'], ['Super Nintendo', 'Pilotwings (Europe).rar'], ['Arcade', 'sf2.zip']]) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    fs.writeFileSync(path.join(root, dir, file), 'x');
  }
  const roms = emu.scanRoms([root], {}, {});
  const by = n => roms.find(r => r.name === n);
  assert.equal(by('Crash').archive, 'extract');
  assert.equal(by('Okami').archive, 'extract');
  assert.equal(by('F-Zero').archive, null);
  assert.equal(by('Pilotwings').archive, 'extract');
  assert.equal(by('sf2').archive, null);
});

test('Jeu décompressé : le .cue avant ses .bin, plusieurs disques dans une liste', () => {
  const { pick } = require('../host/lib/emu-archive');
  const exts = emu.SYSTEMS.find(s => s.id === 'psx').exts;
  const one = tmp();
  fs.writeFileSync(path.join(one, 'Jeu.bin'), Buffer.alloc(10));
  fs.writeFileSync(path.join(one, 'Jeu.cue'), 'FILE "Jeu.bin" BINARY');
  assert.equal(path.basename(pick(one, exts)), 'Jeu.cue');
  const two = tmp();
  for (const n of [2, 1]) fs.writeFileSync(path.join(two, `Jeu (Disc ${n}).chd`), 'x');
  const list = pick(two, exts, { m3u: true });
  assert.match(list, /Jeu\.m3u$/);
  assert.deepEqual(fs.readFileSync(list, 'utf8').trim().split(/\r?\n/), ['Jeu (Disc 1).chd', 'Jeu (Disc 2).chd']);
});

test('BIOS rangé dans un .zip : décompressé une fois, reconnu à sa taille', () => {
  const bios = tmp(), src = tmp();
  fs.writeFileSync(path.join(src, 'Sony PlayStation SCPH-7502 BIOS v4.1 (EU).bin'), Buffer.alloc(524288));
  require('child_process').execFileSync(path.join(process.env.SystemRoot, 'System32', 'tar.exe'), ['-a', '-cf', path.join(bios, 'bios.zip'), '-C', src, '.']);
  assert.equal(setup.biosStatus(bios, 'psx').ok, false);
  assert.equal(setup.unpackBios(bios), 1);
  assert.equal(setup.biosStatus(bios, 'psx').ok, true);
  assert.equal(setup.unpackBios(bios), 0);
});

test('Fichier .sbi cherché seulement pour un disque PlayStation européen', () => {
  const { PAL } = require('../host/lib/emu-sbi');
  assert.ok(PAL.test('Wip3out (Europe) (En,Fr,De,Es,It)'));
  assert.ok(PAL.test('Medievil (France)'));
  assert.ok(!PAL.test('Crash Bandicoot (USA)'));
  assert.ok(!PAL.test('Tekken 3 (Japan)'));
});

test('Jeu Switch décompressé (base/exefs/main) reconnu, son .iso en double masqué, noms de release nettoyés', () => {
  const root = tmp();
  const game = path.join(root, 'Nintendo Switch 2', 'Donkey Kong Bananza (dump-458752) (2)', 'base', 'exefs');
  fs.mkdirSync(game, { recursive: true });
  fs.writeFileSync(path.join(game, 'main'), 'x');
  fs.writeFileSync(path.join(root, 'Nintendo Switch 2', 'Donkey Kong Bananza (dump-458752).iso'), 'x');
  fs.mkdirSync(path.join(root, 'Nintendo Switch'));
  fs.writeFileSync(path.join(root, 'Nintendo Switch', 'FINAL.FANTASY.RESONANCE_(v1.0.1)_(EU)_SuperXCI-NX.xci'), 'x');
  fs.writeFileSync(path.join(root, 'Nintendo Switch', 'Zelda Totk (Europe).iso'), 'x');
  const roms = emu.scanRoms([root], {}, {});
  const s2 = roms.filter(r => r.system === 'switch2');
  assert.equal(s2.length, 1);
  assert.equal(s2[0].name, 'Donkey Kong Bananza');
  assert.match(s2[0].romPath, /base[\\/]exefs[\\/]main$/);
  const s1 = roms.filter(r => r.system === 'switch').map(r => [r.name, r.archive]);
  assert.deepEqual(s1.sort(), [['Final Fantasy Resonance', null], ['Zelda Totk', 'mount']]);
});

test('Image adaptée à l’écran : résolution interne selon l’écran et la carte, écran large, démarrage rapide', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-quality-'));
  const ini = f => fs.readFileSync(path.join(dir, f), 'utf8');
  setup.prepare('duckstation', dir, { bios: 'C:\B', saves: dir, screenH: 1080, tier: 'low', quality: 'auto' });
  assert.match(ini('settings.ini'), /ResolutionScale = 4/);
  assert.match(ini('settings.ini'), /PatchFastBoot = true/);
  setup.prepare('duckstation', dir, { bios: 'C:\B', saves: dir, screenH: 2160, tier: 'high', quality: 'auto', wide: true });
  assert.match(ini('settings.ini'), /ResolutionScale = 8/);
  assert.match(ini('settings.ini'), /WidescreenHack = true/);
  assert.match(ini('settings.ini'), /AspectRatio = 16:9/);
  setup.prepare('duckstation', dir, { bios: 'C:\B', saves: dir, screenH: 1080, tier: 'low', quality: 'native' });
  assert.match(ini('settings.ini'), /ResolutionScale = 1/);
  setup.prepare('pcsx2', dir, { bios: 'C:\B', saves: dir, screenH: 1440, tier: 'high', quality: 'auto', wide: true });
  assert.match(ini('inis/PCSX2.ini'), /upscale_multiplier = 3/);
  assert.match(ini('inis/PCSX2.ini'), /EnableWideScreenPatches = true/);
  setup.prepare('retroarch', dir, { bios: 'C:\B', saves: dir, system: 'n64', screenH: 1080, tier: 'low' });
  assert.match(fs.readFileSync(path.join(dir, 'retroarch.cfg'), 'utf8'), /video_font_enable = "false"/);
  assert.match(fs.readFileSync(path.join(dir, 'config', 'Mupen64Plus-Next', 'Mupen64Plus-Next.opt'), 'utf8'), /1440x1080/);
  setup.prepare('lichii', dir, { bios: dir, saves: dir });
  const qt = ini('user/config/qt-config.ini');
  assert.ok(qt.includes("confirmStop" + String.fromCharCode(92) + "default=false"));
  assert.match(qt, /use_asynchronous_shaders=true/);
});

// Petit .zip « stocké » (sans compression), assez pour lire son répertoire central
function makeZip(file, entries) {
  const local = [], central = [];
  let off = 0;
  for (const [name, size] of entries) {
    const n = Buffer.from(name, 'utf8');
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(0x800, 6); h.writeUInt32LE(size, 18); h.writeUInt32LE(size, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(0x800, 8); c.writeUInt32LE(size, 20); c.writeUInt32LE(size, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    local.push(h, n, Buffer.alloc(size)); central.push(c, n);
    off += 30 + n.length + size;
  }
  const cd = Buffer.concat(central);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  fs.writeFileSync(file, Buffer.concat([...local, cd, e]));
}

test('Archive à plusieurs fichiers : le jeu lui-même est donné à RetroArch, un jeu CD part vers sa console', () => {
  const root = tmp();
  const md = path.join(root, 'Mega Drive');
  fs.mkdirSync(md);
  // Sonic & Knuckles : la puce « Lock-on » (.bin) passe en premier dans l'archive, le jeu est le .md
  makeZip(path.join(md, 'Sonic & Knuckles (World).zip'), [['Sonic & Knuckles (World) (Lock-on).bin', 64], ['Sonic & Knuckles (World).md', 256]]);
  makeZip(path.join(md, 'Sonic CD (Europe).zip'), [['Sonic CD (Europe) (Track 01).bin', 512], ['Sonic CD (Europe) (Track 02).bin', 128], ['Sonic CD (Europe).cue', 16]]);
  makeZip(path.join(md, 'Sonic 2 (World).zip'), [['Sonic 2 (World).md', 128]]);
  fs.writeFileSync(path.join(md, 'Ecco CD (USA).cue'), 'FILE "Ecco CD (USA).bin" BINARY');
  fs.writeFileSync(path.join(md, 'Ecco CD (USA).bin'), 'x');
  const ra = path.join(root, 'ra', 'retroarch.exe');
  fs.mkdirSync(path.dirname(ra));
  fs.writeFileSync(ra, '');
  const roms = emu.scanRoms([root], { retroarch: { path: ra, source: 'kanemode' } }, {});
  const sk = roms.find(r => r.name === 'Sonic & Knuckles');
  assert.equal(sk.system, 'megadrive');
  assert.ok(sk.launch.args.endsWith('Sonic & Knuckles (World).zip#Sonic & Knuckles (World).md"'), sk.launch.args);
  const cd = roms.find(r => r.name === 'Sonic CD');
  assert.equal(cd.system, 'segacd');
  assert.equal(cd.archive, 'extract');
  const s2 = roms.find(r => r.name === 'Sonic 2');
  assert.ok(s2.launch.args.endsWith('Sonic 2 (World).zip"'), 'une seule cartouche : rien ne change');
  const ecco = roms.filter(r => /Ecco/.test(r.name));
  assert.equal(ecco.length, 1, 'le .cue masque son .bin');
  assert.equal(ecco[0].system, 'segacd');
});

test('BIOS Mega-CD : celui de la région du jeu, reconnu sous un autre nom', () => {
  const dir = tmp();
  assert.equal(setup.biosStatus(dir, 'segacd', { region: 'Europe' }).ok, false);
  assert.match(setup.biosStatus(dir, 'segacd', { region: 'Europe' }).what, /bios_CD_E\.bin/);
  const b = Buffer.alloc(131072); b.write('SEGA MEGA DRIVE', 0x100, 'latin1');
  fs.writeFileSync(path.join(dir, '[BIOS] Mega-CD 2 (Europe) (v2.00).bin'), b);
  assert.equal(setup.biosStatus(dir, 'segacd', { region: 'Europe' }).ok, true);
  assert.ok(fs.existsSync(path.join(dir, 'bios_CD_E.bin')));
  assert.equal(setup.biosStatus(dir, 'segacd', { region: 'USA' }).ok, false, 'un jeu américain veut bios_CD_U.bin');
});

test('Manette XInput (ROG Ally, Xbox) posée dans Eden, Lichii, Azahar, RPCS3, Cemu et melonDS, sans écraser un réglage fait à la main', () => {
  const pads = require('../host/lib/emu-pads');
  // Identifiant vérifié contre SDL3 (SDL_GetJoystickGUID, octets 2-3 effacés comme Eden) sur une manette Xbox 360 virtuelle
  const pad = { user: 0, vid: 0x045e, pid: 0x028e, ver: 0x0114, sub: 1 };
  assert.equal(pads.sdlGuid(pad), '030000005e0400008e02000014017801');
  const dir = tmp();
  const qt = path.join(dir, 'user', 'config', 'qt-config.ini');
  const ini = () => fs.readFileSync(qt, 'utf8');
  // Eden : touches au clavier par défaut → manette
  fs.mkdirSync(path.dirname(qt), { recursive: true });
  fs.writeFileSync(qt, '[Controls]\r\nplayer_0_button_a\\default=false\r\nplayer_0_button_a="engine:keyboard,code:67,toggle:0"\r\n');
  setup.prepare('eden', dir, { bios: dir, saves: dir, pads: [pad] });
  assert.ok(ini().includes('player_0_button_a="engine:sdl,port:0,guid:030000005e0400008e02000014017801,button:1"'));
  assert.ok(ini().includes('player_0_button_zl="engine:sdl,port:0,guid:030000005e0400008e02000014017801,axis:2,threshold:0.5,invert:+"'));
  assert.ok(ini().includes('player_0_button_dup="engine:sdl,port:0,guid:030000005e0400008e02000014017801,hat:0,direction:up"'));
  assert.equal((ini().match(/^player_0_button_a=/gm) || []).length, 1, 'une seule ligne par touche');
  // Autre manette ensuite (identifiant posé par KaneMode) : suivie ; réglage à la main : gardé
  setup.prepare('lichii', dir, { bios: dir, saves: dir, pads: [{ ...pad, vid: 0x0b05, pid: 0x1b4c, ver: 0x0100 }] });
  assert.ok(ini().includes('guid:03000000050b00004c1b000000017801,button:1'));
  fs.writeFileSync(qt, ini().replace(/player_0_button_a=.*/, 'player_0_button_a="engine:sdl,port:0,guid:aaaa,button:3"'));
  setup.prepare('eden', dir, { bios: dir, saves: dir, pads: [pad] });
  assert.ok(ini().includes('player_0_button_a="engine:sdl,port:0,guid:aaaa,button:3"'));
  // Sans manette : rien n'est changé
  const az = tmp();
  setup.prepare('azahar', az, { bios: az, saves: az, pads: [] });
  assert.ok(!fs.readFileSync(path.join(az, 'user', 'config', 'qt-config.ini'), 'utf8').includes('profiles'));
  setup.prepare('azahar', az, { bios: az, saves: az, pads: [pad] });
  const azi = fs.readFileSync(path.join(az, 'user', 'config', 'qt-config.ini'), 'utf8');
  assert.ok(azi.includes(String.raw`profiles\1\button_a="engine:sdl,api:controller,maptype:all,guid:0,port:0,button:1"`));
  assert.ok(azi.includes(String.raw`profiles\size=1`));
  // RPCS3 : gestionnaire XInput à la place du clavier
  const rp = tmp();
  setup.prepare('rpcs3', rp, { bios: rp, saves: rp, pads: [pad] });
  const yml = fs.readFileSync(path.join(rp, 'config', 'input_configs', 'global', 'Default.yml'), 'utf8');
  assert.match(yml, /Handler: XInput/);
  assert.match(yml, /Device: "XInput Pad #1"/);
  assert.match(yml, /Cross: "A"/);
  // Cemu : GamePad Wii U sur la manette XInput n° 0
  const ce = tmp();
  setup.prepare('cemu', ce, { bios: ce, saves: ce, pads: [pad] });
  const xml = fs.readFileSync(path.join(ce, 'portable', 'controllerProfiles', 'controller0.xml'), 'utf8');
  assert.match(xml, /<api>XInput<\/api>\s*<uuid>0<\/uuid>/);
  assert.match(xml, /<mapping>1<\/mapping>\s*<button>13<\/button>/);
  // melonDS : dossier portable, joystick n° 0
  const md = tmp();
  setup.prepare('melonds', md, { bios: md, saves: md, pads: [pad] });
  const toml = fs.readFileSync(path.join(md, 'portable', 'melonDS.toml'), 'utf8');
  assert.match(toml, /\[Instance0\.Joystick\][\s\S]*A = 1/);
  assert.match(toml, /Up = 257/);
  // RetroArch : pilote xinput (profil « XInput Controller » pour toute manette XInput)
  const ra = tmp();
  setup.prepare('retroarch', ra, { bios: ra, saves: ra });
  assert.match(fs.readFileSync(path.join(ra, 'retroarch.cfg'), 'utf8'), /input_joypad_driver = "xinput"/);
});

test('Switch et Switch 2 selon la machine : ROG Ally en mode portable, précision basse et FSR ; carte dédiée en mode TV ; jeux .nup', () => {
  const dir = tmp();
  const qt = () => fs.readFileSync(path.join(dir, 'user', 'config', 'qt-config.ini'), 'utf8');
  setup.prepare('lichii', dir, { bios: dir, saves: dir, screenH: 1080, tier: 'low', gpu: 'AMD Radeon(TM) Graphics', quality: 'auto' });
  assert.match(qt(), /^gpu_accuracy=0$/m);
  assert.match(qt(), /^use_docked_mode=0$/m);
  assert.match(qt(), /^resolution_setup=3$/m);
  assert.match(qt(), /^scaling_filter=6$/m);
  assert.match(qt(), /^nvidia_dlss=false$/m);
  // Profil Lichii du tuto, posé une fois
  for (const l of ['cpu_accuracy=2', 'use_custom_cpu_ticks=true', 'cpu_ticks=16000', 'fast_cpu_time=0', 'fast_gpu_time=1',
    'language_index=2', 'region_index=2', 'speed_limit=100', 'slow_speed_limit=50', 'turbo_speed_limit=200', 'backend=1',
    'use_vsync=1', 'fsr_sharpening_slider=72', 'anti_aliasing=2', 'gpu_fence_behavior=1', 'nvdec_emulation=2',
    'frame_pacing_mode=2', 'sync_memory_operations=true', 'async_presentation=true', 'use_asynchronous_shaders=true',
    'gpu_unswizzle_texture_size=3', 'gpu_unswizzle_stream_size=4', 'gpu_unswizzle_chunk_size=4', 'dyna_state=2'])
    assert.match(qt(), new RegExp(`^${l}$`, 'm'), l);
  // Un réglage changé ensuite dans Lichii reste
  fs.writeFileSync(path.join(dir, 'user', 'config', 'qt-config.ini'), qt().replace(/^anti_aliasing=2$/m, 'anti_aliasing=1'));
  setup.prepare('lichii', dir, { bios: dir, saves: dir, screenH: 1440, tier: 'high', gpu: 'NVIDIA GeForce RTX 5080', quality: 'auto' });
  assert.match(qt(), /^anti_aliasing=1$/m);
  assert.match(qt(), /^use_docked_mode=1$/m);
  assert.match(qt(), /^resolution_setup=5$/m);
  assert.match(qt(), /^scaling_filter=1$/m);
  assert.match(qt(), /^nvidia_dlss=true$/m);
  setup.prepare('eden', dir, { bios: dir, saves: dir, screenH: 2160, tier: 'high', quality: 'auto' });
  assert.match(qt(), /^resolution_setup=6$/m);
  const root = tmp();
  fs.mkdirSync(path.join(root, 'Nintendo Switch 2'));
  fs.writeFileSync(path.join(root, 'Nintendo Switch 2', 'The Legend of Zelda Ocarina of Time [0400486024dec000][v131072].nup'), 'NUP');
  const roms = emu.scanRoms([root], {}, {});
  assert.equal(roms.length, 1);
  assert.equal(roms[0].name, 'The Legend of Zelda Ocarina of Time');
  assert.equal(roms[0].system, 'switch2');
});

test('Dump Switch 2 : toujours le dossier updates (la plus récente) ; Switch : la mise à jour seulement si elle a tout le jeu', () => {
  const root = tmp();
  const game = path.join(root, 'Nintendo Switch 2', 'Pokopia (v2.0.1a) (DUMP)');
  const put = (g, rel) => { const f = path.join(g, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, 'NSO'); };
  const rel = g => path.relative(g, emu.scanRoms([root], {}, {}).find(r => r.romPath.startsWith(g)).romPath).split(path.sep).join('/');
  put(game, 'base/exefs/main');
  put(game, 'updates/65536/exefs/main'); put(game, 'updates/65536/romfs/data.bin');
  put(game, 'updates/655360/exefs/main'); put(game, 'updates/655360/romfs/data.bin');
  const roms = emu.scanRoms([root], {}, {});
  assert.equal(roms.length, 1);
  assert.equal(rel(game), 'updates/655360/exefs/main');
  assert.equal(roms[0].name, 'Pokopia');
  // Même identifiant que si la base était lancée (favoris, jaquettes, réglages gardés)
  const idOf = p => 'rom:' + require('crypto').createHash('sha1').update(p.toLowerCase()).digest('hex').slice(0, 12);
  assert.equal(roms[0].id, idOf(path.join(game, 'base', 'exefs', 'main')));
  // Switch 2 : toujours la plus récente, même sans romfs et même avec une base complète
  for (let i = 0; i < 9; i++) put(game, `base/romfs/Dir${i}/x.bin`);
  put(game, 'updates/700000/exefs/main');
  assert.equal(rel(game), 'updates/700000/exefs/main');
  // Dossier DLC (romfs seul) : jamais lancé, un seul jeu
  put(game, 'dlc/040074a01bf13001/0/romfs/x.bin');
  assert.equal(emu.scanRoms([root], {}, {}).length, 1);
  // Switch : mise à jour fusionnée (tous les dossiers de la base) → la mise à jour, sinon la base
  const sw = path.join(root, 'Nintendo Switch', 'Jeu (DUMP)');
  put(sw, 'base/exefs/main'); put(sw, 'base/romfs/Model/a.bin'); put(sw, 'base/romfs/Sound/a.bin');
  put(sw, 'updates/131072/exefs/main'); put(sw, 'updates/131072/romfs/Model/a.bin'); put(sw, 'updates/131072/romfs/Sound/a.bin');
  assert.equal(rel(sw), 'updates/131072/exefs/main');
  for (let i = 0; i < 9; i++) put(sw, `base/romfs/Dir${i}/x.bin`);
  assert.equal(rel(sw), 'base/exefs/main');
});

test('Quitter complètement : RetroArch ne quitte plus dès Select + Start, la reprise automatique du jeu est effaçable', () => {
  const ra = tmp();
  setup.prepare('retroarch', ra, { bios: ra, saves: ra });
  const cfg = fs.readFileSync(path.join(ra, 'retroarch.cfg'), 'utf8');
  assert.match(cfg, /input_quit_gamepad_combo = "3"/, 'secours : L1 + R1 + Select + Start');
  assert.match(cfg, /input_exit_emulator = "nul"/, 'Échap : KaneMode');
  const src = fs.readFileSync(path.join(__dirname, '..', 'host', 'server.js'), 'utf8');
  assert.match(src, /'POST \/api\/emu\/forget-resume'/);
  assert.ok(src.includes('.state') && src.includes('forgetResume(e)'));
});

test('Mods Switch : identifiant du jeu (nom ou main.npdm), dossier load de l’émulateur, ajout d’une archive et retrait', async () => {
  const mods = require('../host/lib/emu-mods');
  assert.equal(mods.titleIdOf('C:/x/The Legend of Zelda [0400486024dec000][v131072].nup'), '0400486024DEC000');
  // main.npdm : « META », section ACI0 (adresse en 0x70), identifiant à +0x10
  const game = tmp();
  const npdm = Buffer.alloc(0x200);
  npdm.write('META', 0, 'latin1'); npdm.writeUInt32LE(0x100, 0x70);
  npdm.write('ACI0', 0x100, 'latin1'); npdm.writeBigUInt64LE(0x0400A3A01EE4C000n, 0x110);
  fs.mkdirSync(path.join(game, 'exefs'));
  fs.writeFileSync(path.join(game, 'exefs', 'main.npdm'), npdm);
  assert.equal(mods.titleIdOf(path.join(game, 'exefs', 'main')), '0400A3A01EE4C000');
  // Dossier load réglé dans l'émulateur (config reprise d'Eglantine) : c'est lui qui compte
  const emuDir = tmp();
  assert.equal(mods.modsDir(emuDir, 'AB'), path.join(emuDir, 'user', 'load', 'AB'));
  const other = tmp();
  fs.mkdirSync(path.join(emuDir, 'user', 'config'), { recursive: true });
  fs.writeFileSync(path.join(emuDir, 'user', 'config', 'qt-config.ini'), ['[Data%20Storage]', 'load_directory\\default=false', 'load_directory=' + other.split(path.sep).join('/'), ''].join('\n'));
  const dir = mods.modsDir(emuDir, '0400486024DEC000');
  assert.equal(dir, path.join(other, '0400486024DEC000'));
  // Archive du mod (dossier « Dynamic-fps/exefs/<build>.ips ») : copiée sous son nom
  const src = tmp();
  fs.mkdirSync(path.join(src, 'Dynamic-fps', 'exefs'), { recursive: true });
  fs.writeFileSync(path.join(src, 'Dynamic-fps', 'exefs', 'E0F3.ips'), 'PATCH');
  const zip = path.join(tmp(), 'Dynamic FPS Zelda.zip');
  require('child_process').execFileSync(path.join(process.env.SystemRoot || 'C:\Windows', 'System32', 'tar.exe'), ['-a', '-cf', zip, '-C', src, 'Dynamic-fps']);
  assert.deepEqual(await mods.add(dir, zip), ['Dynamic-fps']);
  assert.deepEqual(mods.list(dir), [{ name: 'Dynamic-fps', parts: ['exefs'] }]);
  // Dossier de mod sans sous-dossier : refusé
  await assert.rejects(() => mods.add(dir, tmp()), /Aucun mod reconnu/);
  mods.remove(dir, 'Dynamic-fps');
  assert.deepEqual(mods.list(dir), []);
  assert.throws(() => mods.remove(dir, '..'), /introuvable/);
});

test('Lichii modifié (.zip) : copie de Lichii + exécutable de l’archive, dossier user partagé, jamais mis à jour en ligne', async () => {
  const home = tmp();
  const s = store.create({ home: () => home });
  const base = path.join(home, 'Émulateurs', 'lichii');
  fs.mkdirSync(path.join(base, 'user', 'keys'), { recursive: true });
  fs.writeFileSync(path.join(base, 'lichii.exe'), 'OFFICIEL');
  fs.writeFileSync(path.join(base, 'Qt6Core.dll'), 'DLL');
  fs.writeFileSync(path.join(base, 'kanemode.json'), JSON.stringify({ id: 'lichii', version: 'build-94', exe: path.join(base, 'lichii.exe') }));
  const src = tmp();
  fs.mkdirSync(path.join(src, 'Lichii-Frizti-v3'));
  fs.writeFileSync(path.join(src, 'Lichii-Frizti-v3', 'lichii.exe'), 'FRIZTI');
  const zip = path.join(tmp(), 'Lichii-Frizti-v3-Windows-x64.zip');
  require('child_process').execFileSync(path.join(process.env.SystemRoot || 'C:\Windows', 'System32', 'tar.exe'), ['-a', '-cf', zip, '-C', src, 'Lichii-Frizti-v3']);
  const m = await s.installLocal('lichiimod', zip);
  const dir = path.join(home, 'Émulateurs', 'lichiimod');
  assert.equal(m.label, 'Lichii-Frizti-v3');
  assert.equal(fs.readFileSync(path.join(dir, 'lichii.exe'), 'utf8'), 'FRIZTI');
  assert.equal(fs.readFileSync(path.join(dir, 'Qt6Core.dll'), 'utf8'), 'DLL');
  assert.ok(fs.existsSync(path.join(dir, 'user', 'keys')), 'user partagé (jonction)');
  assert.equal(fs.realpathSync(path.join(dir, 'user')), fs.realpathSync(path.join(base, 'user')));
  assert.equal(fs.readFileSync(path.join(base, 'lichii.exe'), 'utf8'), 'OFFICIEL', 'Lichii officiel intact');
  await assert.rejects(() => s.install('lichiimod'), /archive/);
  const row = (await s.list({ check: true })).find(r => r.id === 'lichiimod');
  assert.equal(row.local, true);
  assert.ok(!row.update && !row.checkError, 'pas de recherche de mise à jour');
  const sys = emu.SYSTEMS.find(x => x.id === 'switch2');
  assert.deepEqual(sys.emus, ['lichii', 'lichiimod']);
});

test('Visuels Switch : le bon jeu sur le site de Nintendo (même nom, même console) et adresses d’images limitées à son CDN', () => {
  const nin = require('../host/lib/nintendo-art');
  const games = [
    { id: '1', name: 'The Legend of Zelda: Ocarina of Time 3D', systems: ['Nintendo 3DS'] },
    { id: '2', name: 'The Legend of Zelda: Ocarina of Time', systems: ['Nintendo 64', 'Wii'] },
    { id: '3', name: 'The Legend of Zelda: Ocarina of Time', systems: ['Nintendo Switch 2'] },
  ];
  assert.equal(nin.best('The Legend of Zelda Ocarina of Time', 'switch2', games).id, '3');
  assert.equal(nin.best('Pokopia', 'switch2', [{ id: 'p', name: 'Pokémon Pokopia', systems: ['Nintendo Switch 2'] }]).id, 'p');
  assert.equal(nin.best('Rien à voir', 'switch2', games), null);
  assert.ok(nin.isNintendoUrl('https://www.nintendo.com/eu/media/images/assets/x/1x1_A.png'));
  assert.ok(!nin.isNintendoUrl('https://evil.example/eu/media/images/x.png'));
});

test('Reprise RetroArch faite avec une autre commande (Sonic & Knuckles : puce Lock-on avant la 4.16) : mise de côté, pas rechargée', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'host', 'server.js'), 'utf8');
  assert.match(src, /function staleResume\(e, args\)/);
  assert.match(src, /staleResume\(e, launch\.args\);\s*\n\s*launch = \{ \.\.\.launch, args: launch\.args \+ retroarchLook/);
  assert.match(src, /prev !== null \|\| \/#\[\^"\]\+"\/\.test\(args\) \? forgetResume\(e, \{ backup: true \}\)/);
  assert.match(src, /fs\.renameSync\(p, p\.replace\(\/\(\\.png\)\?\$\/i, '\.bak\$1'\)\)/);
});
