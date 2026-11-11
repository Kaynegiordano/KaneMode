// Manette des émulateurs qui ne la prennent pas toute seule (ROG Ally, manette Xbox, XInput) :
// Eden et Lichii (identifiant SDL de la manette), Azahar, RPCS3, Cemu, melonDS. Écrit avant chaque
// lancement, seulement quand une manette XInput est branchée, et sans toucher à un réglage fait à
// la main : les touches ne sont posées que si elles sont encore au clavier (ou déjà posées par KaneMode).
// Disposition « à la Nintendo » partout : le bouton de droite (B Xbox) est le A de la console.
'use strict';
const fs = require('fs');
const path = require('path');

const read = f => { try { return fs.readFileSync(f, 'utf8').replace(/^﻿/, ''); } catch { return ''; } };
const mkdir = d => { fs.mkdirSync(d, { recursive: true }); return d; };

/** Valeur d'une clé dans une section d'un fichier INI (ou null). */
function iniValue(text, section, key) {
  let inside = false;
  for (const line of text.split(/\r?\n/)) {
    const s = /^\s*\[(.*)\]\s*$/.exec(line);
    if (s) { inside = s[1] === section; continue; }
    if (!inside) continue;
    const i = line.indexOf('=');
    if (i > 0 && line.slice(0, i).trim() === key) return line.slice(i + 1).trim();
  }
  return null;
}

/**
 * Identifiant SDL d'une manette XInput, tel qu'Eden le garde (SDL3, nom effacé des octets 2-3) :
 * bus USB, vendeur, produit, version, « x » (pilote XInput), sous-type. Vérifié sur une manette
 * Xbox 360 virtuelle contre SDL_GetJoystickGUID.
 */
function sdlGuid(p) {
  const b = Buffer.alloc(16);
  b[0] = 0x03;
  if (p.vid) {
    b.writeUInt16LE(p.vid & 0xffff, 4);
    b.writeUInt16LE(p.pid & 0xffff, 8);
    b.writeUInt16LE(p.ver & 0xffff, 12);
    b[14] = 0x78;
    b[15] = p.sub & 0xff;
  } else b.write(`XInput Controller #${p.user + 1}`.slice(0, 11), 4, 'latin1');
  return b.toString('hex');
}

// ---------- Eden, Lichii (yuzu) ----------
// Joystick SDL d'une manette XInput : A0 B1 X2 Y3 LB4 RB5 Back6 Start7 LS8 RS9 Guide10, croix = hat 0,
// axes : stick gauche 0/1, gâchette gauche 2, stick droit 3/4, gâchette droite 5
const KANE_YUZU = /^"engine:sdl,port:0,guid:[0-9a-f]{32},button:1"$/;
function yuzuPad(file, pads) {
  const pad = pads && pads[0];
  if (!pad) return false;
  const cur = file ? iniValue(read(file), 'Controls', 'player_0_button_a') : null; // null : sans contrôle
  if (cur && !/^"engine:keyboard/.test(cur) && !KANE_YUZU.test(cur)) return false; // réglé à la main
  const g = sdlGuid(pad);
  const base = `engine:sdl,port:0,guid:${g}`;
  const btn = n => `"${base},button:${n}"`;
  const hat = d => `"${base},hat:0,direction:${d}"`;
  const axis = n => `"${base},axis:${n},threshold:0.5,invert:+"`;
  const stick = (x, y) => `"${base},axis_x:${x},axis_y:${y},offset_x:0.000000,offset_y:0.000000,invert_x:+,invert_y:+,deadzone:0.150000,range:0.950000"`;
  const v = {
    player_0_connected: 'true', player_0_type: 0,
    player_0_button_a: btn(1), player_0_button_b: btn(0), player_0_button_x: btn(3), player_0_button_y: btn(2),
    player_0_button_lstick: btn(8), player_0_button_rstick: btn(9), player_0_button_l: btn(4), player_0_button_r: btn(5),
    player_0_button_zl: axis(2), player_0_button_zr: axis(5), player_0_button_plus: btn(7), player_0_button_minus: btn(6),
    player_0_button_dleft: hat('left'), player_0_button_dup: hat('up'), player_0_button_dright: hat('right'), player_0_button_ddown: hat('down'),
    player_0_button_slleft: btn(4), player_0_button_srleft: btn(5), player_0_button_slright: btn(4), player_0_button_srright: btn(5),
    player_0_button_home: btn(10), player_0_lstick: stick(0, 1), player_0_rstick: stick(3, 4),
    player_0_vibration_enabled: 'true',
  };
  return { Controls: Object.fromEntries(Object.entries(v).flatMap(([k, x]) => [[`${k}\\default`, 'false'], [k, x]])) };
}

// ---------- Eden, Lichii : une disposition par manette (4.32) ----------
// Ces émulateurs lient le joueur 1 à UNE manette (son identifiant SDL). En streaming, la manette
// virtuelle du PC change avec celle de la console (Xbox pour la manette de l'Ally, DualShock 4 pour une
// Pro Controller ou une DualSense) : la disposition réglée pour l'une ne marchait plus avec l'autre, et
// KaneMode remettait sa disposition Xbox par-dessus une disposition DualShock 4 faite à la main.
// Désormais, la disposition trouvée avant chaque lancement est retenue pour sa manette
// (user/config/kanemode-pads.json, par vendeur:produit), puis :
//   - sa manette est branchée : rien ne change ;
//   - une autre manette est branchée : sa disposition retenue est remise ; à défaut, pour une manette
//     Xbox (XInput), la disposition de KaneMode ;
//   - aucune manette (pas encore créée par Sunshine) : rien ne change.

/** « vendeur:produit » (hexadécimal) d'un identifiant SDL, ou null (manette XInput sans identité). */
function guidPad(guid) {
  if (!/^[0-9a-f]{32}$/i.test(guid || '')) return null;
  const b = Buffer.from(guid, 'hex');
  const vid = b.readUInt16LE(4), pid = b.readUInt16LE(8);
  return vid ? padKey(vid, pid) : null;
}
const padKey = (vid, pid) => `${(vid & 0xffff).toString(16).padStart(4, '0')}:${(pid & 0xffff).toString(16).padStart(4, '0')}`;

/** Clés du joueur 1 dans [Controls] (avec leurs « \default »), telles qu'écrites. */
function playerOne(text) {
  const keys = {};
  let inside = false;
  for (const line of text.split(/\r?\n/)) {
    const s = /^\s*\[(.*)\]\s*$/.exec(line);
    if (s) { inside = s[1] === 'Controls'; continue; }
    const i = line.indexOf('=');
    if (inside && i > 0 && line.startsWith('player_0_')) keys[line.slice(0, i)] = line.slice(i + 1);
  }
  return keys;
}

/** Manette liée au joueur 1 : identifiant SDL lu dans ses boutons (clavier : null). */
function boundGuid(keys) {
  for (const k of ['player_0_button_a', 'player_0_button_b', 'player_0_lstick']) {
    const v = keys[k] || '';
    if (!/engine:sdl/.test(v)) continue;
    const m = /guid:([0-9a-f]{32})/i.exec(v);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

/**
 * Manette du joueur 1 d'Eden ou Lichii avant un lancement : section [Controls] à écrire, ou false.
 * pads : manettes XInput (xinput.ps1) ; hid : manettes PlayStation et Nintendo ({ vid, pid }, hidpads.ps1).
 */
function yuzuController(file, pads = [], hid = []) {
  const store = path.join(path.dirname(file), 'kanemode-pads.json');
  const keys = playerOne(read(file));
  const guid = boundGuid(keys);
  let saved = {};
  try { saved = JSON.parse(read(store) || '{}') || {}; } catch { saved = {}; }
  const connected = [
    ...(pads || []).map(p => ({ key: guidPad(sdlGuid(p)), xinput: p })),
    ...(hid || []).map(h => ({ key: padKey(h.vid, h.pid) })),
  ];
  const bound = guidPad(guid);
  if (bound) {
    // Retenue pour cette manette (la dernière disposition vue gagne)
    if (JSON.stringify((saved[bound] || {}).keys) !== JSON.stringify(keys)) {
      saved[bound] = { guid, keys, at: new Date().toISOString() };
      try { mkdir(path.dirname(store)); fs.writeFileSync(store, JSON.stringify(saved, null, 2)); } catch { /* sans mémoire */ }
    }
    if (connected.some(c => c.key === bound)) return false;
  }
  if (!connected.length) return false;
  const known = connected.find(c => c.key && saved[c.key]);
  if (known) return { Controls: saved[known.key].keys };
  const x = connected.find(c => c.xinput);
  if (!x) return false;
  // Clavier, rien, ou une manette absente : disposition Xbox de KaneMode (le contrôle « réglé à la main »
  // de yuzuPad est sauté : une disposition faite à la main vient d'être retenue pour sa manette)
  return yuzuPad(null, [x.xinput]);
}

// ---------- Azahar (Citra) ----------
// « maptype:all » : n'importe quelle manette branchée (API GameController de SDL2 :
// A0 B1 X2 Y3 Back4 Guide5 Start6 LS7 RS8 LB9 RB10 haut11 bas12 gauche13 droite14 ; gâchettes = axes 4 et 5)
const AZ = 'engine:sdl,api:controller,maptype:all,guid:0,port:0';
function azaharPad(file, pads) {
  if (!pads || !pads.length) return false;
  const cur = iniValue(read(file), 'Controls', 'profiles\\1\\button_a');
  if (cur && !/^"?engine:keyboard/.test(cur) && !cur.includes('maptype:all')) return false;
  const btn = n => `"${AZ},button:${n}"`;
  const v = {
    button_a: btn(1), button_b: btn(0), button_x: btn(3), button_y: btn(2),
    button_up: btn(11), button_down: btn(12), button_left: btn(13), button_right: btn(14),
    button_l: btn(9), button_r: btn(10), button_start: btn(6), button_select: btn(4),
    button_zl: `"${AZ},axis:4,direction:+,threshold:0.5"`, button_zr: `"${AZ},axis:5,direction:+,threshold:0.5"`,
    button_home: btn(5),
    circle_pad: `"${AZ},axis_x:0,axis_y:1,deadzone:0.1"`, c_stick: `"${AZ},axis_x:2,axis_y:3,deadzone:0.1"`,
  };
  const keys = { profile: 0, 'profiles\\size': 1 };
  for (const [k, x] of Object.entries(v)) { keys[`profiles\\1\\${k}\\default`] = 'false'; keys[`profiles\\1\\${k}`] = x; }
  return { Controls: keys };
}

// ---------- RPCS3 ----------
// Sans fichier de manettes, RPCS3 met le clavier au joueur 1 ; avec le gestionnaire XInput, les
// touches doivent être écrites (valeurs par défaut de xinput_pad_handler::init_config)
function rpcs3Pad(dir, pads) {
  if (!pads || !pads.length) return false;
  const file = path.join(dir, 'config', 'input_configs', 'global', 'Default.yml');
  const cur = read(file);
  const handler = (/Player 1 Input:\s*\r?\n\s+Handler:\s*(\S+)/.exec(cur) || [])[1];
  if (cur && handler && !/^(Keyboard|"Null"|Null)$/i.test(handler)) return false;
  const cfg = {
    'Left Stick Left': 'LS X-', 'Left Stick Down': 'LS Y-', 'Left Stick Right': 'LS X+', 'Left Stick Up': 'LS Y+',
    'Right Stick Left': 'RS X-', 'Right Stick Down': 'RS Y-', 'Right Stick Right': 'RS X+', 'Right Stick Up': 'RS Y+',
    Start: 'Start', Select: 'Back', 'PS Button': 'Guide', Square: 'X', Cross: 'A', Circle: 'B', Triangle: 'Y',
    Left: 'Left', Down: 'Down', Right: 'Right', Up: 'Up', R1: 'RB', R2: 'RT', R3: 'RS', L1: 'LB', L2: 'LT', L3: 'LS',
    'Left Stick Deadzone': 7849, 'Right Stick Deadzone': 8689, 'Left Stick Anti-Deadzone': 4259, 'Right Stick Anti-Deadzone': 4259,
    'Left Trigger Threshold': 30, 'Right Trigger Threshold': 30,
  };
  const yml = ['Player 1 Input:', '  Handler: XInput', `  Device: "XInput Pad #${pads[0].user + 1}"`, '  Config:',
    ...Object.entries(cfg).map(([k, v]) => `    ${k}: ${typeof v === 'number' ? v : `"${v}"`}`), ''].join('\n');
  mkdir(path.dirname(file));
  fs.writeFileSync(file, yml);
  return true;
}

// ---------- Cemu ----------
// GamePad Wii U sur la manette XInput (correspondances de VPADController::set_default_mapping) :
// boutons = bits de wButtons (haut0 bas1 gauche2 droite3 Start4 Back5 LS6 RS7 LB8 RB9 A12 B13 X14 Y15),
// 38-49 = axes (stick gauche X+/Y+ 38/39, X-/Y- 44/45 ; stick droit 40/41 et 46/47 ; gâchettes 42/43)
const CEMU_MAP = [[1, 13], [2, 12], [3, 15], [4, 14], [5, 8], [6, 9], [7, 42], [8, 43], [9, 4], [10, 5], [11, 0], [12, 1], [13, 2], [14, 3],
  [15, 6], [16, 7], [17, 39], [18, 45], [19, 44], [20, 38], [21, 41], [22, 47], [23, 46], [24, 40]];
function cemuPad(dir, pads) {
  if (!pads || !pads.length) return false;
  const file = path.join(dir, 'portable', 'controllerProfiles', 'controller0.xml');
  const cur = read(file);
  if (cur && !/<api>Keyboard<\/api>/.test(cur) && !/<!-- KaneMode -->/.test(cur)) return false;
  const entries = CEMU_MAP.map(([m, b]) => `\t\t\t<entry>\n\t\t\t\t<mapping>${m}</mapping>\n\t\t\t\t<button>${b}</button>\n\t\t\t</entry>`).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- KaneMode -->
<emulated_controller>
\t<type>Wii U GamePad</type>
\t<controller>
\t\t<api>XInput</api>
\t\t<uuid>${pads[0].user}</uuid>
\t\t<display_name>Controller ${pads[0].user + 1}</display_name>
\t\t<rumble>0.5</rumble>
\t\t<axis>
\t\t\t<deadzone>0.25</deadzone>
\t\t\t<range>1</range>
\t\t</axis>
\t\t<rotation>
\t\t\t<deadzone>0.25</deadzone>
\t\t\t<range>1</range>
\t\t</rotation>
\t\t<trigger>
\t\t\t<deadzone>0.25</deadzone>
\t\t\t<range>1</range>
\t\t</trigger>
\t\t<mappings>
${entries}
\t\t</mappings>
\t</controller>
</emulated_controller>
`;
  mkdir(path.dirname(file));
  fs.writeFileSync(file, xml);
  return true;
}

// ---------- melonDS ----------
// Joystick SDL2 n° 0 (disposition XInput) ; croix = 0x100 | hat << 4 | direction (1 haut, 2 droite, 4 bas, 8 gauche)
function melonPad(file, pads) {
  if (!pads || !pads.length) return false;
  const cur = iniValue(read(file), 'Instance0.Joystick', 'A');
  if (cur && cur !== '-1' && cur !== '1') return false;
  return {
    Instance0: { JoystickID: 0 },
    'Instance0.Joystick': { A: 1, B: 0, X: 3, Y: 2, L: 4, R: 5, Select: 6, Start: 7, Up: 0x101, Right: 0x102, Down: 0x104, Left: 0x108 },
  };
}

module.exports = { sdlGuid, iniValue, yuzuPad, yuzuController, guidPad, azaharPad, rpcs3Pad, cemuPad, melonPad };
