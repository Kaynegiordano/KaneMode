// Mises à jour de KaneMode depuis les « Releases » GitHub du projet.
// Canal « stable » : versions publiées ; canal « beta » : aussi les pré-versions.
// Le paquet téléchargé est vérifié (SHA-256 publié avec la version) puis installé hors de l'app,
// qui est fermée pendant l'installation et relancée ensuite.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REPO = 'Kaynegiordano/KaneMode';
const PAGE = `https://github.com/${REPO}/releases`;
const HEADERS = { 'User-Agent': 'KaneMode', Accept: 'application/vnd.github+json' };

/** « v0.5.0-beta.2 » → [0, 5, 0, 2] ; une version finale passe devant ses bêtas. */
function parse(v) {
  const m = String(v || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-.]?(?:beta|b|rc)\.?(\d+))?/i);
  if (!m) return null;
  return [+m[1], +m[2], +m[3], m[4] != null ? +m[4] : Infinity];
}
function newer(a, b) {
  const x = parse(a), y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

function current(root) {
  if (process.env.KANEMODE_VERSION) return process.env.KANEMODE_VERSION;
  try { return fs.readFileSync(path.join(root, 'VERSION'), 'utf8').trim(); } catch { return '0.0.0'; }
}

async function releases() {
  let r;
  try { r = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, { headers: HEADERS, signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error('GitHub injoignable (connexion Internet ?)'); }
  if (r.status === 404) return [];
  if (r.status === 403) throw new Error('GitHub limite les vérifications : réessayez dans une heure');
  if (!r.ok) throw new Error(`GitHub a répondu ${r.status}`);
  return r.json();
}

const asset = (rel, re) => (rel.assets || []).find(a => re.test(a.name));

/** Dernière version du canal, plus récente que celle installée ? */
async function check(root, channel = 'stable') {
  const cur = current(root);
  const list = (await releases()).filter(r => !r.draft && (channel === 'beta' || !r.prerelease) && parse(r.tag_name));
  list.sort((a, b) => (newer(a.tag_name, b.tag_name) ? -1 : newer(b.tag_name, a.tag_name) ? 1 : 0));
  const top = list[0];
  const pkg = top && asset(top, /\.msix$/i);
  return {
    current: cur, channel, checked: new Date().toISOString(), page: PAGE,
    available: !!(top && pkg && newer(top.tag_name, cur)),
    latest: top ? {
      version: top.tag_name.replace(/^v/, ''), name: top.name || top.tag_name, notes: (top.body || '').slice(0, 4000),
      date: top.published_at, prerelease: !!top.prerelease, url: top.html_url,
      msix: pkg ? { name: pkg.name, url: pkg.browser_download_url, size: pkg.size } : null,
      sums: (asset(top, /^SHA256SUMS(\.txt)?$/i) || {}).browser_download_url || null,
    } : null,
  };
}

// ---------------------------------------------------------------- téléchargement
const isGitHub = u => { try { const h = new URL(u).hostname; return h === 'github.com' || h.endsWith('.githubusercontent.com'); } catch { return false; } };

function job() {
  const state = { phase: 'idle', received: 0, total: 0, error: null, file: null, version: null };
  return {
    state,
    /** Télécharge le paquet et vérifie son empreinte ; renvoie le chemin du fichier. */
    async download(latest) {
      if (state.phase === 'downloading') throw new Error('Téléchargement déjà en cours');
      if (!latest || !latest.msix || !isGitHub(latest.msix.url)) throw new Error('Paquet introuvable pour cette version');
      if (!latest.sums || !isGitHub(latest.sums)) throw new Error('Empreinte SHA-256 absente : mise à jour refusée');
      Object.assign(state, { phase: 'downloading', received: 0, total: latest.msix.size || 0, error: null, file: null, version: latest.version });
      try {
        const sums = await (await fetch(latest.sums, { headers: HEADERS, signal: AbortSignal.timeout(20000) })).text();
        const line = sums.split(/\r?\n/).find(l => l.toLowerCase().includes(latest.msix.name.toLowerCase()));
        const expected = line && (line.match(/\b[a-f0-9]{64}\b/i) || [])[0];
        if (!expected) throw new Error('Empreinte du paquet absente de SHA256SUMS');
        const dir = path.join(os.tmpdir(), 'KaneMode-update');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, path.basename(latest.msix.name));
        const r = await fetch(latest.msix.url, { headers: { 'User-Agent': 'KaneMode' } });
        if (!r.ok || !r.body) throw new Error(`Téléchargement impossible (${r.status})`);
        const hash = crypto.createHash('sha256');
        const out = fs.createWriteStream(file);
        for await (const chunk of r.body) {
          hash.update(chunk);
          state.received += chunk.length;
          if (!out.write(chunk)) await new Promise(res => out.once('drain', res));
        }
        await new Promise((res, rej) => out.end(err => (err ? rej(err) : res())));
        if (hash.digest('hex').toLowerCase() !== expected.toLowerCase()) {
          fs.rmSync(file, { force: true });
          throw new Error('Empreinte SHA-256 incorrecte : fichier rejeté');
        }
        Object.assign(state, { phase: 'ready', file });
        return file;
      } catch (e) {
        Object.assign(state, { phase: 'error', error: e.message });
        throw e;
      }
    },
  };
}

/**
 * Installe le paquet téléchargé. Le script tourne hors de l'app (lancé par WMI, donc hors du
 * paquet MSIX et de son « job ») : il peut fermer KaneMode, installer puis le relancer.
 */
function apply(file, hostDir) {
  if (!file || !fs.existsSync(file)) throw new Error('Aucune mise à jour téléchargée');
  const script = path.join(path.dirname(file), 'apply-update.ps1');
  fs.copyFileSync(path.join(hostDir, 'apply-update.ps1'), script);
  const log = path.join(path.dirname(file), 'apply-update.log');
  const cmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${script}" -Msix "${file}" -Log "${log}"`;
  const ps = `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${cmd.replace(/'/g, "''")}' }; exit $r.ReturnValue`;
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true });
    p.on('close', code => (code === 0 ? resolve({ ok: true, log }) : reject(new Error(`Lancement de l'installation impossible (code ${code})`))));
    p.on('error', reject);
  });
}

module.exports = { check, current, job, apply, newer, PAGE, REPO };
