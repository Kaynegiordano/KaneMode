// Configuration automatique des émulateurs installés par KaneMode, refaite à chaque lancement :
// plein écran, dossiers BIOS et sauvegardes, première manette, Select + Start pour quitter.
// Seules les clés listées ici sont écrites ; les autres réglages de l'utilisateur sont gardés.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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

const SETUP = {
  retroarch(dir, c) {
    mergeCfg(path.join(dir, 'retroarch.cfg'), {
      video_fullscreen: 'true', video_windowed_fullscreen: 'true', pause_nonactive: 'false',
      input_autodetect_enable: 'true', input_joypad_driver: 'sdl2',
      // Combinaisons indépendantes de la numérotation des boutons : Select + Start quitte, L3 + R3 ouvre le menu
      input_quit_gamepad_combo: '4', input_menu_toggle_gamepad_combo: '2', quit_press_twice: 'false', confirm_quit: 'false',
      system_directory: c.bios, savefile_directory: mkdir(path.join(c.saves, 'RetroArch', 'saves')),
      savestate_directory: mkdir(path.join(c.saves, 'RetroArch', 'states')),
      savestate_auto_save: 'true', savestate_auto_load: 'true',
      menu_driver: 'ozone', config_save_on_exit: 'true', video_font_enable: 'true',
    });
  },
  duckstation(dir, c) {
    mergeIni(path.join(dir, 'settings.ini'), {
      Main: { SettingsVersion: 3, SetupWizardIncomplete: 'false', StartFullscreen: 'true', ConfirmPowerOff: 'false', PauseOnFocusLoss: 'false', SaveStateOnExit: 'true', InhibitScreensaver: 'true' },
      BIOS: { SearchDirectory: c.bios },
      Display: { AspectRatio: DUCK_ASPECT[c.aspect] || DUCK_ASPECT.auto },
      InputSources: { SDL: 'true', XInput: 'false' },
      Pad1: { Type: 'AnalogController', ...PS_PAD, Analog: SDL('Guide') },
      Hotkeys: { PowerOff: QUIT_CHORD },
    });
  },
  pcsx2(dir, c) {
    const bios = ps2Bios(c.bios);
    mergeIni(path.join(dir, 'inis', 'PCSX2.ini'), {
      UI: { SettingsVersion: 1, SetupWizardIncomplete: 'false', StartFullscreen: 'true', ConfirmShutdown: 'false', PauseOnFocusLoss: 'false', HideMouseCursor: 'true' },
      Folders: { Bios: c.bios, MemoryCards: mkdir(path.join(c.saves, 'PCSX2', 'memcards')), Savestates: mkdir(path.join(c.saves, 'PCSX2', 'sstates')) },
      ...(bios ? { Filenames: { BIOS: bios } } : {}),
      EmuCore: { EnableFastBoot: 'true', SaveStateOnShutdown: 'true' },
      'EmuCore/GS': { AspectRatio: PCSX2_ASPECT[c.aspect] || PCSX2_ASPECT.auto },
      InputSources: { SDL: 'true', XInput: 'false' },
      Pad1: { Type: 'DualShock2', ...PS_PAD, Analog: SDL('Guide') },
      Hotkeys: { ShutdownVM: QUIT_CHORD, OpenPauseMenu: SDL('Guide') },
    });
  },
  dolphin(dir) {
    const cfg = path.join(dir, 'User', 'Config');
    const x = b => `\`${b}\``;
    mergeIni(path.join(cfg, 'Dolphin.ini'), {
      Display: { Fullscreen: 'True' },
      Interface: { ConfirmStop: 'False' },
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
  ppsspp(dir) {
    // PPSSPP reconnaît les manettes XInput tout seul ; plein écran et pas de confirmation
    mergeIni(path.join(dir, 'memstick', 'PSP', 'SYSTEM', 'ppsspp.ini'), {
      Graphics: { FullScreen: 'True' },
      General: { FirstRun: 'False', CheckForNewVersion: 'False' },
    });
  },
  eden(dir, c) { switchFiles(dir, path.join(c.bios, 'Switch')); },
  eglantine(dir, c) { switchFiles(dir, path.join(c.bios, 'Switch 2')); },
};

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

function biosStatus(bios, sysId) {
  const r = REQUIRES[sysId];
  if (!r) return null;
  const dir = r.dir ? path.join(bios, r.dir) : bios;
  let ok = false;
  try { ok = fs.readdirSync(dir).some(n => { try { return r.test(n, path.join(dir, n)); } catch { return false; } }); } catch { /* dossier absent */ }
  return { ok, what: r.what };
}

module.exports = { prepare, biosStatus, unpackBios, mergeIni, mergeCfg, REQUIRES };
