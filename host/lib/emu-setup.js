// Configuration automatique des émulateurs installés par KaneMode, refaite à chaque lancement :
// plein écran, dossiers BIOS et sauvegardes, première manette, Select + Start pour quitter.
// Seules les clés listées ici sont écrites ; les autres réglages de l'utilisateur sont gardés.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const pads = require('./emu-pads');

const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');

const mkdir = d => { fs.mkdirSync(d, { recursive: true }); return d; };
const read = f => { try { return fs.readFileSync(f, 'utf8').replace(/^﻿/, ''); } catch { return ''; } };

/** Fichier INI : met à jour les clés de chaque section, garde le reste tel quel. */
function mergeIni(file, values, { sep = ' = ' } = {}) {
  const lines = read(file).split(/\r?\n/);
  if (lines.length === 1 && lines[0] === '') lines.length = 0;
  for (const [section, keys] of Object.entries(values)) {
    let start = lines.findIndex(l => l.trim() === `[${section}]`);
    if (start < 0) { if (lines.length && lines[lines.length - 1] !== '') lines.push(''); lines.push(`[${section}]`); start = lines.length - 1; }
    let end = lines.findIndex((l, i) => i > start && /^\s*\[.*\]\s*$/.test(l));
    if (end < 0) end = lines.length;
    for (const [k, v] of Object.entries(keys)) {
      const i = lines.findIndex((l, j) => j > start && j < end && l.split('=')[0].trim() === k);
      const line = `${k}${sep}${v}`;
      if (i >= 0) lines[i] = line;
      else { lines.splice(end, 0, line); end++; }
    }
  }
  mkdir(path.dirname(file));
  fs.writeFileSync(file, lines.join('\r\n') + '\r\n');
}

/** retroarch.cfg : lignes clé = "valeur". */
function mergeCfg(file, values) {
  const lines = read(file).split(/\r?\n/).filter(Boolean);
  for (const [k, v] of Object.entries(values)) {
    const line = `${k} = "${v}"`;
    const i = lines.findIndex(l => l.split('=')[0].trim() === k);
    if (i >= 0) lines[i] = line; else lines.push(line);
  }
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

// Manette n° 1 vue par SDL (DuckStation, PCSX2) : boutons à la place de ceux de la PlayStation
const SDL = b => `SDL-0/${b}`;
const PS_PAD = {
  Up: SDL('DPadUp'), Down: SDL('DPadDown'), Left: SDL('DPadLeft'), Right: SDL('DPadRight'),
  Cross: SDL('A'), Circle: SDL('B'), Square: SDL('X'), Triangle: SDL('Y'),
  Select: SDL('Back'), Start: SDL('Start'), L1: SDL('LeftShoulder'), R1: SDL('RightShoulder'),
  L2: SDL('+LeftTrigger'), R2: SDL('+RightTrigger'), L3: SDL('LeftStick'), R3: SDL('RightStick'),
  LUp: SDL('-LeftY'), LDown: SDL('+LeftY'), LLeft: SDL('-LeftX'), LRight: SDL('+LeftX'),
  RUp: SDL('-RightY'), RDown: SDL('+RightY'), RLeft: SDL('-RightX'), RRight: SDL('+RightX'),
  SmallMotor: SDL('SmallMotor'), LargeMotor: SDL('LargeMotor'),
};
const QUIT_CHORD = `${SDL('Back')} & ${SDL('Start')}`;

// Fichier BIOS de la PS2 (PCSX2 demande son nom) : fichier de 4 Mo du dossier BIOS
function ps2Bios(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return null; }
  const sized = names.filter(n => /\.(bin|rom0?)$/i.test(n)).filter(n => { try { return fs.statSync(path.join(dir, n)).size === 4194304; } catch { return false; } });
  return sized.find(n => /scph|ps2/i.test(n)) || sized[0] || null;
}

// Clés et firmware de la Switch : copiés depuis BIOS\<console> dans le dossier user de l'émulateur
function switchFiles(dir, src) {
  const keys = mkdir(path.join(dir, 'user', 'keys'));
  for (const k of ['prod.keys', 'title.keys']) {
    const f = path.join(src, k);
    if (fs.existsSync(f)) fs.copyFileSync(f, path.join(keys, k));
  }
  const fw = path.join(src, 'Firmware');
  let ncas = [];
  try { ncas = fs.readdirSync(fw).filter(n => /\.nca$/i.test(n)); } catch { /* pas de firmware */ }
  if (ncas.length) {
    const reg = mkdir(path.join(dir, 'user', 'nand', 'system', 'Contents', 'registered'));
    for (const n of ncas) { const t = path.join(reg, n); if (!fs.existsSync(t)) fs.copyFileSync(path.join(fw, n), t); }
  }
}

// Format de l'image choisi dans KaneMode (réglage du jeu ou de la console), noms de chaque émulateur
const DUCK_ASPECT = { auto: 'Auto (Game Native)', '4:3': '4:3', '16:9': '16:9', full: 'Stretch To Fill' };
const PCSX2_ASPECT = { auto: 'Auto 4:3/3:2', '4:3': '4:3', '16:9': '16:9', full: 'Stretch' };

/**
 * Agrandissement interne d'un émulateur 3D : la hauteur de l'écran divisée par celle de la console,
 * bornée selon la carte graphique (puce intégrée de la ROG Ally : moins). « Origine » : 1.
 */
function upscale(c, base, capLow, capHigh) {
  if (c.quality === 'native') return 1;
  const cap = c.tier === 'high' ? capHigh : capLow;
  return Math.max(1, Math.min(cap, Math.round((c.screenH || 1080) / base)));
}
// Qt (Eden, Lichii, Azahar) : une valeur choisie s'écrit avec « \default=false »
const qt = values => Object.fromEntries(Object.entries(values).flatMap(([k, v]) => [[`${k}\\default`, 'false'], [k, v]]));

const SETUP = {
  retroarch(dir, c) {
    mergeCfg(path.join(dir, 'retroarch.cfg'), {
      video_fullscreen: 'true', video_windowed_fullscreen: 'true', pause_nonactive: 'false',
      // Pilote xinput (celui de RetroArch sous Windows) : toute manette XInput (ROG Ally, Xbox) a son
      // profil « XInput Controller » ; les autres passent par DirectInput
      input_autodetect_enable: 'true', input_joypad_driver: 'xinput',
      // Select + Start et Échap : c'est KaneMode qui ferme le jeu (maintenus 1 s : partie gardée, 3 s :
      // partie oubliée), RetroArch ne doit pas quitter dès l'appui. Secours : L1 + R1 + Select + Start.
      // L3 + R3 ouvre le menu.
      input_quit_gamepad_combo: '3', input_exit_emulator: 'nul', input_menu_toggle_gamepad_combo: '2', quit_press_twice: 'false', confirm_quit: 'false',
      system_directory: c.bios, savefile_directory: mkdir(path.join(c.saves, 'RetroArch', 'saves')),
      savestate_directory: mkdir(path.join(c.saves, 'RetroArch', 'states')),
      savestate_auto_save: 'true', savestate_auto_load: 'true',
      // Le jeu, rien d'autre : pas de messages ni de notifications à l'écran, réglages non réécrits en quittant
      menu_driver: 'ozone', config_save_on_exit: 'false', video_font_enable: 'false', menu_enable_widgets: 'false',
      notification_show_autoconfig: 'false', notification_show_remap_load: 'false', notification_show_config_override_load: 'false',
      notification_show_set_initial_disk: 'false', notification_show_refresh_rate: 'false', notification_show_save_state: 'false',
      notification_show_fast_forward: 'false', notification_show_cheats_applied: 'false', notification_show_patch_applied: 'false',
      notification_show_screenshot: 'false', notification_show_disk_control: 'false',
      network_cmd_enable: 'false', video_shader_watch_files: 'false', video_hdr_enable: 'false',
    });
    // Nintendo 64 (Mupen64Plus-Next) : rendu à la taille de l'écran
    if (c.system === 'n64') {
      const sizes = ['640x480', '960x720', '1280x960', '1440x1080', '1600x1200', '1920x1440', '2240x1680', '2560x1920', '2880x2160'];
      const maxH = c.quality === 'native' ? 480 : Math.min(c.screenH || 1080, c.tier === 'high' ? 2160 : 1080);
      const size = sizes.filter(s => +s.split('x')[1] <= maxH).pop() || sizes[0];
      const opt = path.join(dir, 'config', 'Mupen64Plus-Next', 'Mupen64Plus-Next.opt');
      mkdir(path.dirname(opt));
      mergeCfg(opt, { 'mupen64plus-43screensize': size, 'mupen64plus-BilinearMode': 'standard', 'mupen64plus-MultiSampling': c.tier === 'high' ? '4' : '0' });
    }
  },
  duckstation(dir, c) {
    const native = c.quality === 'native';
    mergeIni(path.join(dir, 'settings.ini'), {
      Main: { SettingsVersion: 3, SetupWizardIncomplete: 'false', StartFullscreen: 'true', ConfirmPowerOff: 'false', PauseOnFocusLoss: 'false', SaveStateOnExit: 'true', InhibitScreensaver: 'true' },
      // Logo PlayStation passé : le jeu démarre tout de suite
      BIOS: { SearchDirectory: c.bios, PatchFastBoot: 'true' },
      Display: { AspectRatio: c.wide ? '16:9' : DUCK_ASPECT[c.aspect] || DUCK_ASPECT.auto, ShowOSDMessages: 'false' },
      // Résolution agrandie, géométrie précise (PGXP : plus de polygones qui tremblent), écran large
      GPU: { ResolutionScale: upscale(c, 240, 4, 8), PGXPEnable: native ? 'false' : 'true', PGXPCulling: 'true', PGXPTextureCorrection: 'true', WidescreenHack: c.wide ? 'true' : 'false', TrueColor: native ? 'false' : 'true' },
      InputSources: { SDL: 'true', XInput: 'false' },
      Pad1: { Type: 'AnalogController', ...PS_PAD, Analog: SDL('Guide') },
      Hotkeys: { PowerOff: QUIT_CHORD },
      // Pas de recherche de mise à jour au lancement (KaneMode s'en charge, et elle retarde le jeu)
      AutoUpdater: { CheckAtStartup: 'false' },
    });
  },
  pcsx2(dir, c) {
    const bios = ps2Bios(c.bios);
    mergeIni(path.join(dir, 'inis', 'PCSX2.ini'), {
      UI: { SettingsVersion: 1, SetupWizardIncomplete: 'false', StartFullscreen: 'true', ConfirmShutdown: 'false', PauseOnFocusLoss: 'false', HideMouseCursor: 'true' },
      Folders: { Bios: c.bios, MemoryCards: mkdir(path.join(c.saves, 'PCSX2', 'memcards')), Savestates: mkdir(path.join(c.saves, 'PCSX2', 'sstates')) },
      ...(bios ? { Filenames: { BIOS: bios } } : {}),
      // Correctifs d'écran large et de désentrelacement fournis avec PCSX2, par jeu
      EmuCore: { EnableFastBoot: 'true', SaveStateOnShutdown: 'true', EnableWideScreenPatches: c.wide ? 'true' : 'false', EnableNoInterlacingPatches: 'true' },
      'EmuCore/GS': { AspectRatio: c.wide ? '16:9' : PCSX2_ASPECT[c.aspect] || PCSX2_ASPECT.auto, upscale_multiplier: upscale(c, 448, 2, 6), OsdShowMessages: 'false' },
      InputSources: { SDL: 'true', XInput: 'false' },
      Pad1: { Type: 'DualShock2', ...PS_PAD, Analog: SDL('Guide') },
      Hotkeys: { ShutdownVM: QUIT_CHORD, OpenPauseMenu: SDL('Guide') },
      AutoUpdater: { CheckAtStartup: 'false' },
    });
  },
  dolphin(dir, c) {
    const cfg = path.join(dir, 'User', 'Config');
    const x = b => `\`${b}\``;
    mergeIni(path.join(cfg, 'Dolphin.ini'), {
      Display: { Fullscreen: 'True' },
      Interface: { ConfirmStop: 'False', OnScreenDisplayMessages: 'False' },
      Core: { SkipIPL: 'True' },
      AutoUpdate: { UpdateTrack: '' },
      Analytics: { PermissionAsked: 'True', Enabled: 'False' },
    });
    mergeIni(path.join(cfg, 'GFX.ini'), {
      Settings: { InternalResolution: upscale(c, 528, 2, 6), AspectRatio: c.wide ? 1 : 0, wideScreenHack: c.wide ? 'True' : 'False', MSAA: c.tier === 'high' && c.quality !== 'native' ? '0x00000004' : '0x00000001' },
      Enhancements: { MaxAnisotropy: c.quality === 'native' ? 0 : c.tier === 'high' ? 4 : 2 },
    });
    const gc = {
      Device: 'XInput/0/Gamepad',
      'Buttons/A': x('Button A'), 'Buttons/B': x('Button X'), 'Buttons/X': x('Button B'), 'Buttons/Y': x('Button Y'),
      'Buttons/Z': x('Shoulder R'), 'Buttons/Start': x('Start'),
      'Main Stick/Up': x('Left Y+'), 'Main Stick/Down': x('Left Y-'), 'Main Stick/Left': x('Left X-'), 'Main Stick/Right': x('Left X+'),
      'C-Stick/Up': x('Right Y+'), 'C-Stick/Down': x('Right Y-'), 'C-Stick/Left': x('Right X-'), 'C-Stick/Right': x('Right X+'),
      'Triggers/L': x('Trigger L'), 'Triggers/R': x('Trigger R'), 'Triggers/L-Analog': x('Trigger L'), 'Triggers/R-Analog': x('Trigger R'),
      'D-Pad/Up': x('Pad N'), 'D-Pad/Down': x('Pad S'), 'D-Pad/Left': x('Pad W'), 'D-Pad/Right': x('Pad E'),
      'Rumble/Motor': x('Motor L') + '|' + x('Motor R'),
    };
    mergeIni(path.join(cfg, 'GCPadNew.ini'), { GCPad1: gc });
    // Wii : Wiimote émulée avec Nunchuk, pointeur au stick droit
    mergeIni(path.join(cfg, 'WiimoteNew.ini'), {
      Wiimote1: {
        Device: 'XInput/0/Gamepad', Source: 1, Extension: 'Nunchuk',
        'Buttons/A': x('Button A'), 'Buttons/B': x('Trigger R'), 'Buttons/1': x('Button X'), 'Buttons/2': x('Button Y'),
        'Buttons/-': x('Back'), 'Buttons/+': x('Start'), 'Buttons/Home': x('Thumb R'),
        'D-Pad/Up': x('Pad N'), 'D-Pad/Down': x('Pad S'), 'D-Pad/Left': x('Pad W'), 'D-Pad/Right': x('Pad E'),
        'IR/Up': x('Right Y+'), 'IR/Down': x('Right Y-'), 'IR/Left': x('Right X-'), 'IR/Right': x('Right X+'),
        'Shake/X': x('Button B'), 'Shake/Y': x('Button B'), 'Shake/Z': x('Button B'),
        'Nunchuk/Buttons/C': x('Shoulder L'), 'Nunchuk/Buttons/Z': x('Trigger L'),
        'Nunchuk/Stick/Up': x('Left Y+'), 'Nunchuk/Stick/Down': x('Left Y-'), 'Nunchuk/Stick/Left': x('Left X-'), 'Nunchuk/Stick/Right': x('Left X+'),
      },
    });
    mergeIni(path.join(cfg, 'Hotkeys.ini'), { Hotkeys: { Device: 'XInput/0/Gamepad', 'General/Exit': `${x('Back')}&${x('Start')}` } });
  },
  ppsspp(dir, c) {
    // PPSSPP reconnaît les manettes XInput tout seul ; résolution 0 = celle de la fenêtre (l'écran)
    mergeIni(path.join(dir, 'memstick', 'PSP', 'SYSTEM', 'ppsspp.ini'), {
      Graphics: { FullScreen: 'True', InternalResolution: c.quality === 'native' ? 1 : 0, AnisotropyLevel: c.quality === 'native' ? 0 : 4 },
      General: { FirstRun: 'False', CheckForNewVersion: 'False' },
    });
  },
  azahar(dir, c) {
    const file = path.join(dir, 'user', 'config', 'qt-config.ini');
    mergeIni(file, {
      Renderer: qt({ resolution_factor: upscale(c, 240, 3, 6) }),
      UI: qt({ fullscreen: 'true', confirmClose: 'false' }),
      ...(pads.azaharPad(file, c.pads) || {}),
    }, { sep: '=' });
  },
  eden(dir, c) { switchFiles(dir, path.join(c.bios, 'Switch')); switchConfig(dir, c, 'eden'); },
  lichii(dir, c) { switchFiles(dir, path.join(c.bios, 'Switch 2')); switchConfig(dir, c, 'lichii'); },
  rpcs3(dir, c) { pads.rpcs3Pad(dir, c.pads); },
  cemu(dir, c) { pads.cemuPad(dir, c.pads); },
  // melonDS : réglages à côté de l'exécutable (dossier portable), manette n° 0
  melonds(dir, c) {
    const file = path.join(mkdir(path.join(dir, 'portable')), 'melonDS.toml');
    const v = pads.melonPad(file, c.pads);
    if (v) mergeIni(file, v);
  },
};

// Eden et Lichii (même base, mêmes clés) : plein écran, pas de question en quittant, shaders compilés sans à-coups
// Image selon la machine (valeurs des énumérations d'Eden et de Lichii : résolution 3 = 1x, 5 = 1,5x,
// 6 = 2x ; filtre 6 = FSR ; anticrénelage 0 = aucun, 1 = FXAA ; mode 0 = portable, 1 = TV).
// Puce intégrée (ROG Ally…) : mode portable (moins de pixels à calculer), précision GPU basse,
// FSR pour agrandir à l'écran. Carte dédiée : mode TV, résolution d'après l'écran (1080p de la console TV).
function switchVideo(c, variant) {
  const low = c.tier !== 'high';
  const native = c.quality === 'native';
  const h = c.screenH || 1080;
  const res = native || low ? 3 : h >= 2000 ? (variant === 'lichii' ? 5 : 6) : h > 1100 ? 5 : 3;
  return {
    Renderer: qt({
      resolution_setup: res, scaling_filter: 6, anti_aliasing: low ? 0 : 1,
      // Eden : Low/Medium/High (0-2), Lichii : Low/High (0-1)
      gpu_accuracy: low ? 0 : 1,
      use_asynchronous_shaders: 'true', use_disk_shader_cache: 'true',
    }),
    System: qt({ use_docked_mode: low ? 0 : 1 }),
  };
}

function switchConfig(dir, c = {}, variant = 'eden') {
  const file = path.join(dir, 'user', 'config', 'qt-config.ini');
  const pad = pads.yuzuPad(file, c.pads);
  mergeIni(file, {
    ...(pad || {}),
    UI: qt({ fullscreen: 'true', confirmStop: 2, pauseWhenInBackground: 'false', hideInactiveMouse: 'true' }),
    Miscellaneous: qt({ first_launch: 'false' }),
    ...switchVideo(c, variant),
  }, { sep: '=' });
}

/** Prépare l'émulateur avant un lancement ; une erreur n'empêche jamais de jouer. */
function prepare(id, dir, ctx) {
  const fn = SETUP[id];
  if (!fn) return false;
  try { fn(dir, ctx); return true; }
  catch (e) { console.error(`Émulation : configuration de ${id} :`, e.message); return false; }
}

// BIOS ou clés indispensables : vérifiés avant le lancement pour un message clair
const REQUIRES = {
  // BIOS PS1 : fichier de 512 Ko, quel que soit son nom (DuckStation le reconnaît à son contenu)
  psx: { what: 'BIOS PlayStation (fichier .bin de 512 Ko, scph5501.bin…)', test: (n, f) => /\.bin$/i.test(n) && fs.statSync(f).size === 524288 },
  ps2: { what: 'BIOS PlayStation 2 (fichier de 4 Mo, scph…)', test: (n, f) => /\.(bin|rom0?)$/i.test(n) && fs.statSync(f).size === 4194304 },
  saturn: { what: 'BIOS Saturn (sega_101.bin ou mpr-17933.bin)', test: n => /^(sega_101|mpr-17933|saturn_bios)\.bin$/i.test(n) },
  segacd: { what: 'BIOS Mega-CD (bios_CD_E.bin, bios_CD_U.bin, bios_CD_J.bin)', test: n => /^bios_cd_[euj]\.bin$/i.test(n) },
  xbox: { what: 'BIOS Xbox (mcpx_1.0.bin et un BIOS complet)', test: n => /^mcpx_1\.0\.bin$/i.test(n) },
  switch: { what: 'Clés de la Switch (prod.keys) dans BIOS\\Switch', dir: 'Switch', test: n => /^prod\.keys$/i.test(n) },
  switch2: { what: 'Clés de la Switch 2 (prod.keys) dans BIOS\\Switch 2', dir: 'Switch 2', test: n => /^prod\.keys$/i.test(n) },
};

/**
 * BIOS rangés dans une archive (.zip, .7z, .rar) au premier niveau du dossier BIOS : décompressés à
 * côté, une seule fois par archive (nom, taille et date gardés dans .kanemode-bios.json).
 */
function unpackBios(bios) {
  let names;
  try { names = fs.readdirSync(bios).filter(n => /\.(zip|7z|rar)$/i.test(n)); } catch { return 0; }
  if (!names.length) return 0;
  const markFile = path.join(bios, '.kanemode-bios.json');
  let done = {};
  try { done = JSON.parse(fs.readFileSync(markFile, 'utf8')); } catch { /* premier passage */ }
  let count = 0;
  for (const n of names) {
    const f = path.join(bios, n);
    let sig;
    try { const st = fs.statSync(f); sig = `${st.size}|${Math.floor(st.mtimeMs)}`; } catch { continue; }
    if (done[n] === sig) continue;
    try { execFileSync(TAR, ['-xf', f, '-C', bios], { windowsHide: true, stdio: 'ignore', timeout: 60000 }); count++; }
    catch { /* archive abîmée : nouvel essai si elle change */ }
    done[n] = sig;
  }
  try { fs.writeFileSync(markFile, JSON.stringify(done)); } catch { /* dossier en lecture seule */ }
  if (count) console.log(`Émulation : ${count} BIOS décompressé(s) dans ${bios}`);
  return count;
}

// Mega-CD : un BIOS par région (le jeu européen veut bios_CD_E.bin). Un BIOS de 128 Ko rangé sous
// un autre nom (« Mega-CD 2 (Europe) v2.00.bin ») est reconnu et copié sous le nom attendu.
// Essayées dans l'ordre J, U, E : « Mega-CD » se dit en Europe comme au Japon, « Sega CD » aux États-Unis
const CD_REGION = { E: /europe|\(e\)|\beu\b|\bpal\b|mega-?cd/i, U: /usa|\(u\)|\bus\b|america|sega.?cd/i, J: /japan|\(j\)|\bjp\b/i };
function megaCdBios(bios) {
  let names = [];
  try { names = fs.readdirSync(bios); } catch { return; }
  for (const n of names) {
    if (/^bios_cd_[euj]\.bin$/i.test(n) || !/\.(bin|md|smd|gen|rom)$/i.test(n)) continue;
    const f = path.join(bios, n);
    let buf;
    try { if (fs.statSync(f).size !== 131072) continue; buf = fs.readFileSync(f); } catch { continue; }
    if (!/SEGA/.test(buf.toString('latin1', 0x100, 0x110))) continue;
    // Région : celle du nom du fichier, sinon celle de l'en-tête (« E », « U » ou « J »)
    let region = ['J', 'U', 'E'].find(k => CD_REGION[k].test(n));
    if (!region) { const h = buf.toString('latin1', 0x1f0, 0x1f3).toUpperCase().replace(/[^EUJ]/g, ''); if (h.length === 1) region = h; }
    if (!region) continue;
    const target = path.join(bios, `bios_CD_${region}.bin`);
    if (!fs.existsSync(target)) try { fs.copyFileSync(f, target); console.log(`Émulation : ${n} reconnu comme BIOS Mega-CD (${region})`); } catch { /* lecture seule */ }
  }
}
const CD_NEED = { Europe: 'E', France: 'E', Germany: 'E', Spain: 'E', Italy: 'E', USA: 'U', Japan: 'J' };
const CD_NAME = { E: 'européen', U: 'américain', J: 'japonais' };

/** game : { region } du jeu, pour les consoles dont le BIOS dépend de la région (Mega-CD). */
function biosStatus(bios, sysId, game = {}) {
  const r = REQUIRES[sysId];
  if (!r) return null;
  if (sysId === 'segacd') {
    megaCdBios(bios);
    const want = CD_NEED[game.region];
    if (want) {
      const ok = fs.existsSync(path.join(bios, `bios_CD_${want}.bin`));
      return { ok, what: `BIOS Mega-CD ${CD_NAME[want]} (bios_CD_${want}.bin, 128 Ko)` };
    }
  }
  const dir = r.dir ? path.join(bios, r.dir) : bios;
  let ok = false;
  try { ok = fs.readdirSync(dir).some(n => { try { return r.test(n, path.join(dir, n)); } catch { return false; } }); } catch { /* dossier absent */ }
  return { ok, what: r.what };
}

module.exports = { prepare, biosStatus, unpackBios, mergeIni, mergeCfg, REQUIRES };
