// Émulateurs gérés par KaneMode : téléchargés depuis leur source officielle, installés en version
// portable dans le dossier d'émulation de l'utilisateur, puis tenus à jour.
//   <dossier d'émulation>\Émulateurs\<id>\…   (fichier kanemode.json : version installée)
// Les archives .7z et .zip sont ouvertes par le tar de Windows (libarchive), sans outil en plus.
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execFile } = require('child_process');

const UA = 'KaneMode (emulation)';
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');

// source : github (repo, asset), forgejo (api, asset), dolphin, retroarch
// exe : exécutable cherché après extraction ; portable : fichiers ou dossiers qui gardent les
// réglages à côté de l'émulateur ; size : ordre de grandeur affiché avant l'installation
const CATALOG = {
  retroarch: { name: 'RetroArch', source: { type: 'retroarch' }, exe: /^retroarch\.exe$/i, size: 200, systems: 'consoles 8, 16 et 32 bits, N64, DS, arcade' },
  duckstation: { name: 'DuckStation', source: { type: 'github', repo: 'stenzek/duckstation', asset: /^duckstation-windows-x64-release\.zip$/i }, exe: /^duckstation-qt-x64-ReleaseLTCG\.exe$/i, portable: ['portable.txt'], size: 75 },
  pcsx2: { name: 'PCSX2', source: { type: 'github', repo: 'PCSX2/pcsx2', asset: /^pcsx2-v[\d.]+-windows-x64-Qt\.7z$/i }, exe: /^pcsx2-qt\.exe$/i, portable: ['portable.txt'], size: 26 },
  dolphin: { name: 'Dolphin', source: { type: 'dolphin' }, exe: /^Dolphin\.exe$/i, portable: ['portable.txt'], size: 20 },
  ppsspp: { name: 'PPSSPP', source: { type: 'github', repo: 'hrydgard/ppsspp', asset: /Windows-x64\.zip$/i }, exe: /^PPSSPPWindows64\.exe$/i, size: 30 },
  azahar: { name: 'Azahar', source: { type: 'github', repo: 'azahar-emu/azahar', asset: /^azahar-windows-msvc-[\d.]+\.zip$/i }, exe: /^azahar\.exe$/i, portable: ['user/'], size: 30 },
  cemu: { name: 'Cemu', source: { type: 'github', repo: 'cemu-project/Cemu', asset: /windows-x64\.zip$/i }, exe: /^Cemu\.exe$/i, portable: ['portable/'], size: 15 },
  rpcs3: { name: 'RPCS3', source: { type: 'github', repo: 'RPCS3/rpcs3-binaries-win', asset: /_win64_msvc\.7z$/i }, exe: /^rpcs3\.exe$/i, size: 35 },
  eden: { name: 'Eden', source: { type: 'forgejo', api: 'https://git.eden-emu.dev/api/v1/repos/eden-emu/eden', asset: /-amd64-msvc-standard\.zip$/i, ally: /-rog-ally-clang-pgo\.zip$/i }, exe: /^eden\.exe$/i, portable: ['user/'], size: 40 },
  // Switch 2 : Lichii (suite d'Eglantine, une version par jour) ; from : reprend le dossier user/ d'Eglantine
  lichii: { name: 'Lichii', source: { type: 'github', repo: 'zortos293/Lichii', pre: true, tags: [/^build-\d+$/], asset: /^lichii-windows-x86_64\.zip$/i }, exe: /^lichii\.exe$/i, portable: ['user/'], from: 'eglantine', size: 116, experimental: true },
  // Eglantine, de nouveau proposé en 4.25 (choisi jeu par jeu) : version du jour (daily-AAAAMMJJ),
  // sinon la dernière vX. Son dossier user garde les sauvegardes et les mods (Lichii y pointe aussi).
  eglantine: { name: 'Eglantine', source: { type: 'github', repo: 'Djihads80/Eglantine', pre: true, tags: [/^daily-\d{8}$/, /^v\d/], asset: /^eglantine-windows-x86_64\.zip$/i }, exe: /^eglantine\.exe$/i, portable: ['user/'], size: 116, experimental: true },
  // Version modifiée de Lichii (Lichii-Frizti…) donnée par l'utilisateur en .zip : l'exécutable seul,
  // posé sur une copie de Lichii, dont elle partage le dossier user (clés, sauvegardes, mods).
  // Choisie jeu par jeu (Réglages → Émulateur), jamais mise à jour toute seule.
  lichiimod: { name: 'Lichii (version modifiée)', source: { type: 'local' }, local: true, base: 'lichii', exe: /^lichii\.exe$/i, size: 50, experimental: true },
  xemu: { name: 'xemu', source: { type: 'github', repo: 'xemu-project/xemu', asset: /^xemu-win-x86_64-release\.zip$/i }, exe: /^xemu\.exe$/i, size: 20 },
  xenia: { name: 'Xenia Canary', source: { type: 'github', repo: 'xenia-canary/xenia-canary-releases', asset: /^xenia_canary_windows.*\.zip$/i }, exe: /^xenia_canary\.exe$/i, portable: ['portable.txt'], size: 20 },
  flycast: { name: 'Flycast', source: { type: 'github', repo: 'flyinghead/flycast', asset: /^flycast-win64-.*\.zip$/i }, exe: /^flycast\.exe$/i, size: 15 },
  melonds: { name: 'melonDS', source: { type: 'github', repo: 'melonDS-emu/melonDS', asset: /windows-x86_64\.zip$/i }, exe: /^melonDS\.exe$/i, size: 10 },
  shadps4: { name: 'shadPS4', source: { type: 'github', repo: 'shadps4-emu/shadPS4', asset: /^shadps4-win64-sdl-.*\.zip$/i }, exe: /^shadps4\.exe$/i, portable: ['user/'], size: 25, experimental: true },
  vita3k: { name: 'Vita3K', source: { type: 'github', repo: 'Vita3K/Vita3K', tag: 'continuous', asset: /^windows-latest\.zip$/i }, exe: /^Vita3K\.exe$/i, size: 25, experimental: true },
};

// ---------- Réseau ----------
function get(url, { json = false, headers = {} } = {}, redirects = 6) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA, Accept: json ? 'application/json' : '*/*', ...headers }, timeout: 30000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(get(new URL(res.headers.location, url).href, { json, headers }, redirects - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`${new URL(url).host} : HTTP ${res.statusCode}`)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (!json) return resolve(buf);
        try { resolve(JSON.parse(buf.toString('utf8'))); } catch { reject(new Error(`${new URL(url).host} : réponse illisible`)); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Délai dépassé')));
    req.on('error', reject);
  });
}

function download(url, file, onProgress, redirects = 6) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': UA }, timeout: 60000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        return resolve(download(new URL(res.headers.location, url).href, file, onProgress, redirects - 1));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`Téléchargement refusé (HTTP ${res.statusCode})`)); }
      const total = +res.headers['content-length'] || 0;
      let received = 0;
      const out = fs.createWriteStream(file);
      res.on('data', c => { received += c.length; onProgress(received, total); });
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve(received)));
      out.on('error', reject);
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Le serveur ne répond plus')));
    req.on('error', reject);
  });
}

// Une entrée sans nom (dossier vide de certains zip, Cemu) fait échouer tar sans gêner le reste :
// l'extraction compte si des fichiers sont sortis (l'exécutable est vérifié ensuite), sinon un
// .zip est confié à Expand-Archive
const hasFiles = dir => { try { return fs.readdirSync(dir).length > 0; } catch { return false; } };
const extract = (archive, dest) => new Promise((resolve, reject) => {
  fs.mkdirSync(dest, { recursive: true });
  execFile(TAR, ['-xf', archive, '-C', dest], { windowsHide: true, maxBuffer: 16 << 20 }, err => {
    if (!err || hasFiles(dest)) return resolve();
    if (!/\.zip$/i.test(archive)) return reject(new Error('Archive illisible : ' + err.message.split('\n')[0]));
    const q = s => `'${s.replace(/'/g, "''")}'`;
    execFile('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath ${q(archive)} -DestinationPath ${q(dest)} -Force`], { windowsHide: true }, err2 => (err2 || !hasFiles(dest) ? reject(new Error('Archive illisible')) : resolve()));
  });
});

/** Cherche l'exécutable jusqu'à trois niveaux sous le dossier. */
function findExe(dir, re, depth = 0) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) if (e.isFile() && re.test(e.name)) return path.join(dir, e.name);
  if (depth >= 3) return null;
  for (const e of entries) if (e.isDirectory()) { const f = findExe(path.join(dir, e.name), re, depth + 1); if (f) return f; }
  return null;
}

// ---------- Dernière version ----------
async function latest(id, { ally = false } = {}) {
  const c = CATALOG[id];
  const s = c.source;
  if (s.type === 'local') throw new Error(`${c.name} : installée depuis une archive, pas de mise à jour en ligne`);
  if (s.type === 'retroarch') {
    const r = await get('https://api.github.com/repos/libretro/RetroArch/releases/latest', { json: true });
    const v = String(r.tag_name).replace(/^v/, '');
    return { version: v, url: `https://buildbot.libretro.com/stable/${v}/windows/x86_64/RetroArch.7z`, name: 'RetroArch.7z' };
  }
  if (s.type === 'dolphin') {
    const r = await get('https://dolphin-emu.org/update/latest/beta/', { json: true });
    const a = (r.artifacts || []).find(x => x.system === 'Windows x64');
    if (!a) throw new Error('Dolphin : pas de version Windows');
    return { version: r.shortrev, url: a.url, name: path.basename(a.url) };
  }
  let rel;
  if (s.type === 'forgejo') rel = await get(`${s.api}/releases/latest`, { json: true });
  else if (s.tag) rel = await get(`https://api.github.com/repos/${s.repo}/releases/tags/${s.tag}`, { json: true });
  else if (s.pre) {
    const list = await get(`https://api.github.com/repos/${s.repo}/releases?per_page=30`, { json: true });
    for (const re of s.tags || [/./]) { rel = list.find(r => re.test(r.tag_name) && r.assets.some(a => s.asset.test(a.name))); if (rel) break; }
  } else rel = await get(`https://api.github.com/repos/${s.repo}/releases/latest`, { json: true });
  if (!rel) throw new Error(`${c.name} : aucune version publiée`);
  const asset = (ally && s.ally && rel.assets.find(a => s.ally.test(a.name))) || rel.assets.find(a => s.asset.test(a.name));
  if (!asset) throw new Error(`${c.name} : pas de fichier Windows dans la version ${rel.tag_name}`);
  // Tags qui ne changent pas (« latest », « continuous ») : la date de publication sert de version
  const version = /^(latest|continuous|preview)$/i.test(rel.tag_name) ? (asset.updated_at || rel.published_at || '').slice(0, 10) : rel.tag_name;
  return { version, url: asset.browser_download_url, name: asset.name, size: asset.size };
}

// ---------- Magasin ----------
function create({ home, isAlly = async () => false }) {
  const root = () => path.join(home(), 'Émulateurs');
  const dirOf = id => path.join(root(), id);
  const metaFile = id => path.join(dirOf(id), 'kanemode.json');
  const jobs = new Map();
  const latestCache = new Map();

  function installed(id) {
    try {
      const m = JSON.parse(fs.readFileSync(metaFile(id), 'utf8'));
      if (m.exe && fs.existsSync(m.exe)) return m;
    } catch { /* pas installé */ }
    return null;
  }

  /** Émulateurs installés par KaneMode, au format de detectEmulators. */
  function emulators() {
    const out = {};
    for (const id of Object.keys(CATALOG)) { const m = installed(id); if (m) out[id] = { path: m.exe, source: 'kanemode', version: m.version }; }
    return out;
  }

  async function latestCached(id) {
    const hit = latestCache.get(id);
    if (hit && Date.now() - hit.at < 3600e3) return hit.v;
    const v = await latest(id, { ally: await isAlly() });
    latestCache.set(id, { at: Date.now(), v });
    return v;
  }

  /** Installe ou met à jour (même chemin : les réglages et sauvegardes restent en place). */
  function install(id, { onDone } = {}) {
    const c = CATALOG[id];
    if (!c) return Promise.reject(new Error('Émulateur inconnu'));
    if (c.local) return Promise.reject(new Error(`${c.name} s’installe depuis son archive .zip (Émulation → Gérer)`));
    const running = jobs.get(id);
    if (running && running.promise) return running.promise;
    const job = { id, name: c.name, phase: 'search', received: 0, total: 0, error: null };
    jobs.set(id, job);
    job.promise = (async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `kanemode-${id}-`));
      try {
        const v = await latestCached(id);
        job.version = v.version;
        job.phase = 'download';
        job.total = v.size || c.size * 1e6;
        const archive = path.join(tmp, v.name);
        await download(v.url, archive, (r, t) => { job.received = r; if (t) job.total = t; });
        job.phase = 'extract';
        const unpacked = path.join(tmp, 'x');
        await extract(archive, unpacked);
        const exeTmp = findExe(unpacked, c.exe);
        if (!exeTmp) throw new Error(`${c.name} : exécutable introuvable dans l'archive`);
        // Contenu de l'archive (dossier de l'exécutable) copié sur l'installation existante
        const dest = dirOf(id);
        fs.mkdirSync(dest, { recursive: true });
        try { fs.cpSync(path.dirname(exeTmp), dest, { recursive: true, force: true }); }
        catch (e) { throw new Error(e.code === 'EBUSY' || e.code === 'EPERM' ? `${c.name} est encore ouvert : fermez-le puis réessayez` : e.message); }
        // Remplaçant d'un ancien émulateur : ses clés, réglages et sauvegardes (user/) le suivent
        if (c.from && !fs.existsSync(path.join(dest, 'user')) && fs.existsSync(path.join(dirOf(c.from), 'user'))) {
          job.phase = 'extract';
          fs.cpSync(path.join(dirOf(c.from), 'user'), path.join(dest, 'user'), { recursive: true });
          console.log(`Émulation : dossier user de ${c.from} repris par ${c.name}`);
        }
        for (const p of c.portable || []) {
          const target = path.join(dest, p);
          if (p.endsWith('/')) fs.mkdirSync(target, { recursive: true });
          else if (!fs.existsSync(target)) fs.writeFileSync(target, '');
        }
        const exe = path.join(dest, path.basename(exeTmp));
        const meta = { id, version: v.version, exe, installed: new Date().toISOString(), source: v.url };
        fs.writeFileSync(metaFile(id), JSON.stringify(meta, null, 2));
        job.phase = 'done';
        console.log(`Émulation : ${c.name} ${v.version} installé dans ${dest}`);
        onDone && onDone(meta);
        return meta;
      } catch (e) {
        job.phase = 'error'; job.error = e.message;
        console.error(`Émulation : ${c.name} :`, e.message);
        throw e;
      } finally {
        fs.rm(tmp, { recursive: true, force: true }, () => {});
        delete job.promise;
        setTimeout(() => { if (jobs.get(id) === job && !job.promise) jobs.delete(id); }, 60e3);
      }
    })();
    return job.promise;
  }

  /**
   * Version modifiée d'un émulateur depuis une archive de l'utilisateur (souvent l'exécutable seul) :
   * copie de l'émulateur de base (sans son dossier user), contenu de l'archive par-dessus, et dossier
   * user relié à celui de la base (jonction) pour partager clés, sauvegardes et mods.
   */
  async function installLocal(id, archive) {
    const c = CATALOG[id];
    if (!c || !c.local) throw new Error('Émulateur inconnu');
    if (!fs.existsSync(String(archive || '')) || !/\.(zip|7z|rar)$/i.test(archive)) throw new Error('Choisissez une archive .zip, .7z ou .rar');
    if (pending(id)) return pending(id);
    const job = { id, name: c.name, phase: 'extract', received: 0, total: 0, error: null };
    jobs.set(id, job);
    job.promise = (async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `kanemode-${id}-`));
      try {
        if (!installed(c.base)) { job.phase = 'download'; await install(c.base); job.phase = 'extract'; }
        const baseDir = dirOf(c.base);
        const unpacked = path.join(tmp, 'x');
        await extract(archive, unpacked);
        const exeTmp = findExe(unpacked, c.exe);
        if (!exeTmp) throw new Error(`Pas d’exécutable ${CATALOG[c.base].name} dans l’archive`);
        const dest = dirOf(id);
        fs.mkdirSync(dest, { recursive: true });
        try {
          fs.cpSync(baseDir, dest, { recursive: true, force: true, filter: src => {
            const rel = path.relative(baseDir, src).toLowerCase();
            return rel !== 'user' && !rel.startsWith('user' + path.sep) && rel !== 'kanemode.json';
          } });
          fs.cpSync(path.dirname(exeTmp), dest, { recursive: true, force: true });
        } catch (e) { throw new Error(e.code === 'EBUSY' || e.code === 'EPERM' ? `${c.name} est encore ouverte : fermez-la puis réessayez` : e.message); }
        const user = path.join(dest, 'user');
        if (!fs.existsSync(user)) {
          fs.mkdirSync(path.join(baseDir, 'user'), { recursive: true });
          fs.symlinkSync(path.join(baseDir, 'user'), user, 'junction');
        }
        const label = path.basename(archive).replace(/\.(zip|7z|rar)$/i, '').replace(/-Windows-x64$/i, '');
        const meta = { id, version: label, label, exe: path.join(dest, path.basename(exeTmp)), installed: new Date().toISOString(), source: archive, base: c.base };
        fs.writeFileSync(metaFile(id), JSON.stringify(meta, null, 2));
        job.phase = 'done';
        console.log(`Émulation : ${label} installé dans ${dest} (dossier user partagé avec ${c.base})`);
        return meta;
      } catch (e) {
        job.phase = 'error'; job.error = e.message;
        throw e;
      } finally {
        fs.rm(tmp, { recursive: true, force: true }, () => {});
        delete job.promise;
        setTimeout(() => { if (jobs.get(id) === job && !job.promise) jobs.delete(id); }, 60e3);
      }
    })();
    return job.promise;
  }

  /** Cœur RetroArch : téléchargé depuis le buildbot de libretro s'il manque. */
  async function ensureCore(coreFile) {
    if (fs.existsSync(coreFile)) return coreFile;
    const name = path.basename(coreFile);
    const key = 'core:' + name;
    if (jobs.get(key)?.promise) return jobs.get(key).promise;
    const job = { id: key, name: name.replace(/_libretro\.dll$/, ''), phase: 'download', received: 0, total: 0, error: null };
    jobs.set(key, job);
    job.promise = (async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanemode-core-'));
      try {
        const zip = path.join(tmp, name + '.zip');
        await download(`https://buildbot.libretro.com/nightly/windows/x86_64/latest/${name}.zip`, zip, (r, t) => { job.received = r; job.total = t; });
        job.phase = 'extract';
        fs.mkdirSync(path.dirname(coreFile), { recursive: true });
        await extract(zip, path.dirname(coreFile));
        if (!fs.existsSync(coreFile)) throw new Error(`Cœur ${job.name} introuvable dans l'archive`);
        job.phase = 'done';
        return coreFile;
      } catch (e) { job.phase = 'error'; job.error = e.message; throw e; }
      finally {
        fs.rm(tmp, { recursive: true, force: true }, () => {});
        delete job.promise;
        setTimeout(() => { if (jobs.get(key) === job) jobs.delete(key); }, 60e3);
      }
    })();
    return job.promise;
  }

  /** État de chaque émulateur du catalogue, avec la dernière version si demandé. */
  async function list({ check = false } = {}) {
    const out = [];
    for (const [id, c] of Object.entries(CATALOG)) {
      const m = installed(id);
      const row = { id, name: (m && m.label) || c.name, size: c.size, experimental: !!c.experimental, installed: !!m, version: m ? m.version : null, dir: m ? dirOf(id) : null, local: !!c.local };
      if (check && m && !c.local) {
        try { const v = await latestCached(id); row.latest = v.version; row.update = v.version !== m.version; }
        catch (e) { row.checkError = e.message; }
      }
      out.push(row);
    }
    return out;
  }

  const jobList = () => [...jobs.values()].map(({ promise, ...j }) => ({ ...j, busy: !!promise }));

  /** Installation ou mise à jour en cours de cet émulateur (promesse), sinon null. */
  const pending = id => (jobs.get(id) && jobs.get(id).promise) || null;

  return { CATALOG, installed, emulators, install, installLocal, ensureCore, list, jobs: jobList, dirOf, root, pending };
}

module.exports = { create, CATALOG, latest };
