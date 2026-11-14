// Journal lisible depuis les Paramètres (Système → Journal) : dernières erreurs de l'app et de
// l'hôte (kanemode.log, écrit par l'app native) et de la dernière session de streaming (journal du
// moteur KanePlay). Lecture seule, la fin des fichiers seulement : jamais tout un journal en mémoire.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const TAIL_BYTES = 512 * 1024;

/** Dossier des journaux de l'app : donné par l'app native, sinon celui de l'app installée. */
function appLogDir(env = process.env) {
  if (env.KANEMODE_LOGS) return env.KANEMODE_LOGS;
  return path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'KaneMode', 'logs');
}

/** Dernières lignes d'un fichier (sans couper un caractère UTF-8 au début). */
function tail(file, bytes = TAIL_BYTES) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    let text = buf.toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1); // première ligne incomplète
    return text.split(/\r?\n/).filter(l => l.trim());
  } catch { return []; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch { /* rien */ } }
}

// Lignes de l'app : « [2026-11-11 10:02:37] [hôte:erreur] message »
const APP_LINE = /^\[(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\] (.*)$/;
const APP_ERROR = /\[hôte:erreur\]|erreur|error|échec|impossible|plant|fatale|exception/i;
// Bruit connu : titres de fenêtres qui contiennent « Error », lignes vides d'une trace
const APP_NOISE = /Premier plan : |premier plan « |Fenêtre apparue|^\[hôte:erreur\]\s*$/;

/**
 * Erreurs de l'app et de l'hôte, la plus récente d'abord. Les lignes d'une même trace (même seconde,
 * « [hôte:erreur] ») sont regroupées en une seule entrée.
 */
function appErrors(dir = appLogDir(), limit = 30) {
  const lines = [...tail(path.join(dir, 'kanemode.log.old'), 64 * 1024), ...tail(path.join(dir, 'kanemode.log'))];
  const out = [];
  for (const line of lines) {
    const m = APP_LINE.exec(line);
    if (!m) continue;
    const [, at, text] = m;
    if (!APP_ERROR.test(text) || APP_NOISE.test(text)) continue;
    const last = out[out.length - 1];
    const trace = text.startsWith('[hôte:erreur]');
    const body = text.replace(/^\[hôte(:erreur)?\]\s?/, '');
    if (last && trace && last.trace && last.at === at) { last.detail.push(body); continue; }
    // Même message répété (une tentative par minute) : une seule entrée, comptée, à l'heure de la dernière
    if (last && !trace && last.text === body.trim()) { last.count++; last.at = at; continue; }
    out.push({ at, text: body.trim(), source: trace || /^\[hôte\]/.test(text) ? 'host' : 'app', trace, detail: [], count: 1 });
  }
  // Une trace Node commence souvent par la ligne du fichier fautif : le message est la ligne « Error: … »
  for (const e of out) {
    const msg = e.trace && [e.text, ...e.detail].find(l => /^\w*Error\b|^Error:|^\s*Erreur/.test(l.trim()));
    if (msg && msg.trim() !== e.text) { e.detail.unshift(e.text); e.text = msg.trim(); }
    delete e.trace;
  }
  return out.slice(-limit).reverse();
}

/** Journal du moteur de la dernière session de streaming (le plus récent du dossier temporaire). */
function engineLog(dir = os.tmpdir()) {
  try {
    const files = fs.readdirSync(dir).filter(f => /^KanePlay-\d+\.log$/.test(f))
      .map(f => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs })).sort((a, b) => b.t - a.t);
    return files.length ? path.join(dir, files[0].f) : null;
  } catch { return null; }
}

// Lignes du moteur : « 00:01:23 - SDL Error (0): … » ou « 00:01:23 - Qt Warning: … »
const ENGINE_LINE = /^(\d\d:\d\d:\d\d) - (.*)$/;
const ENGINE_ERROR = /\b(error|critical|fatal)\b|failed|unable to|échec/i;

function engineErrors(file = engineLog(), limit = 30) {
  if (!file) return { file: null, at: null, errors: [] };
  const errors = [];
  for (const line of tail(file, 256 * 1024)) {
    const m = ENGINE_LINE.exec(line);
    if (!m || !ENGINE_ERROR.test(m[2])) continue;
    // Une même erreur répétée chaque image : comptée, pas recopiée
    const last = errors[errors.length - 1];
    if (last && last.text === m[2]) { last.count++; continue; }
    errors.push({ at: m[1], text: m[2], count: 1 });
  }
  let at = null;
  try { at = fs.statSync(file).mtime.toISOString(); } catch { /* rien */ }
  return { file, at, errors: errors.slice(-limit).reverse() };
}

/** Texte à copier : la fin brute des deux journaux, pour un message ou un rapport. */
function copyText({ dir = appLogDir(), engine = engineLog(), lines = 300 } = {}) {
  const app = tail(path.join(dir, 'kanemode.log')).slice(-lines);
  const parts = [`KaneMode ${process.env.KANEMODE_VERSION || ''} · ${new Date().toISOString()}`.trim(), '', '== App et hôte (kanemode.log)', ...app];
  if (engine) parts.push('', `== Moteur de streaming (${path.basename(engine)})`, ...tail(engine, 128 * 1024).slice(-lines));
  return parts.join('\n');
}

module.exports = { appLogDir, tail, appErrors, engineLog, engineErrors, copyText };
