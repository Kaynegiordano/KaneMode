// Pilotes graphiques des fabricants (NVIDIA, AMD, Intel) : version installée comparée à la dernière
// publiée, pour chaque carte de la machine. Résultat gardé dans DATA/gpu-drivers.json, vérifié une
// fois par jour par l'hôte (notification dans l'interface) ou à la demande (Paramètres).
// - NVIDIA : API publique de son sélecteur de pilotes (carte retrouvée par son nom exact).
// - AMD : pas d'API ; la page officielle des pilotes donne le lien de l'installateur, qui porte la
//   version d'Adrenalin et sa date. Comparée à RadeonSoftwareVersion (device.ps1).
// - Intel : pas d'API ; la page officielle des pilotes Arc donne la version dans ses métadonnées.
// Une page qui change de forme donne « à vérifier sur le site », jamais une fausse information.
'use strict';
const fs = require('fs');
const path = require('path');

const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) KaneMode', 'Accept-Language': 'fr-FR,fr;q=0.9' };
const PAGES = {
  nvidia: 'https://www.nvidia.com/fr-fr/drivers/',
  amd: 'https://www.amd.com/fr/support/download/drivers.html',
  intel: 'https://www.intel.fr/content/www/fr/fr/support/detect.html',
  intelArc: 'https://www.intel.com/content/www/us/en/download/785597/intel-arc-graphics-windows.html',
};

async function text(url) {
  const r = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}
/** Compare deux versions numériques (« 26.8.1 », « 32.0.101.9033 ») : -1, 0 ou 1. */
function compare(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return Math.sign(d);
  }
  return 0;
}
/** Version NVIDIA « grand public » depuis celle de Windows : 32.0.15.7314 → 573.14. */
function nvidiaVersion(win) {
  const d = String(win || '').replace(/\./g, '');
  if (!/^\d{6,}$/.test(d)) return null;
  const x = d.slice(-5);
  return `${+x.slice(0, 3)}.${x.slice(3)}`;
}
const norm = s => String(s || '').toLowerCase().replace(/\(r\)|\(tm\)|®|™/g, '').replace(/^nvidia\s+/, '').replace(/\s+/g, ' ').trim();
const status = (latest, installed) => (!latest || !installed ? 'unknown' : compare(latest, installed) > 0 ? 'new' : 'ok');

// ---------------------------------------------------------------- fabricants
let nvProducts = null;
async function nvidia(g) {
  if (!nvProducts) {
    const x = await text('https://www.nvidia.com/Download/API/lookupValueSearch.aspx?TypeID=3');
    nvProducts = [...x.matchAll(/<LookupValue[^>]*ParentID="(\d+)"[^>]*>\s*<Name>([^<]+)<\/Name>\s*<Value>(\d+)<\/Value>/g)].map(m => ({ psid: m[1], name: m[2], pfid: m[3] }));
  }
  const want = norm(g.name);
  const p = nvProducts.find(i => norm(i.name) === want);
  const installed = nvidiaVersion(g.driver);
  if (!p) return { installed, status: 'unknown', note: 'Carte introuvable dans le sélecteur de NVIDIA', page: PAGES.nvidia };
  const j = JSON.parse(await text(`https://gfwsl.geforce.com/services_toolkit/services/com/nvidia/services/AjaxDriverService.php?func=DriverManualLookup&psid=${p.psid}&pfid=${p.pfid}&osID=57&languageCode=1036&beta=0&isWHQL=1&dltype=-1&dch=1&upCRD=0&qnf=0&sort1=0&numberOfResults=1`));
  const d = j && j.IDS && j.IDS[0] && j.IDS[0].downloadInfo;
  if (!d || !/^\d+\.\d+$/.test(d.Version || '')) return { installed, status: 'unknown', page: PAGES.nvidia };
  // Date en français chez NVIDIA : « 2026 septembre 22 » → 2026-09-22
  const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const dm = /(\d{4})\s+(\S+)\s+(\d{1,2})/.exec(d.ReleaseDateTime || '');
  const month = dm ? MONTHS.indexOf(dm[2].toLowerCase()) : -1;
  const date = month >= 0 ? `${dm[1]}-${String(month + 1).padStart(2, '0')}-${dm[3].padStart(2, '0')}` : null;
  return {
    installed, latest: d.Version, date, dateText: date ? null : d.ReleaseDateTime || null, size: d.DownloadURLFileSize ? d.DownloadURLFileSize.replace(/\s*MB$/i, ' Mo').replace('.', ',') : null,
    title: decodeURIComponent(d.Name || 'Pilote NVIDIA'),
    url: /^https:\/\/[a-z]+\.download\.nvidia\.com\/[\w./-]+\.exe$/.test(d.DownloadURL || '') ? d.DownloadURL : null,
    page: /^https:\/\/www\.nvidia\.com\//.test(d.DetailsURL || '') ? d.DetailsURL : PAGES.nvidia,
    status: status(d.Version, installed),
  };
}

async function amd(g) {
  const x = await text('https://www.amd.com/en/support/download/drivers.html');
  const m = /https:\/\/drivers\.amd\.com\/drivers\/installer\/[\w./-]*?amd-software-adrenalin-edition-(\d+\.\d+\.\d+)-minimalsetup-(\d{6})_web\.exe/.exec(x);
  const installed = g.adrenalin || null;
  if (!m) return { installed, status: 'unknown', page: PAGES.amd };
  return {
    installed, latest: m[1], date: `20${m[2].slice(0, 2)}-${m[2].slice(2, 4)}-${m[2].slice(4, 6)}`,
    title: 'AMD Software: Adrenalin Edition', url: m[0], page: PAGES.amd,
    status: status(m[1], installed),
  };
}

async function intel(g) {
  // Seulement les cartes et processeurs « Arc » : la page officielle ne vaut que pour eux
  if (!/\barc\b/i.test(g.name)) return { installed: g.driver || null, status: 'unknown', page: PAGES.intel };
  const x = await text(PAGES.intelArc);
  const v = /name="DownloadVersion" content="(\d+\.\d+\.\d+\.\d+)/.exec(x);
  const d = /name="lastModifieddate" content="(\d\d)\/(\d\d)\/(\d{4})/.exec(x);
  if (!v) return { installed: g.driver || null, status: 'unknown', page: PAGES.intel };
  return {
    installed: g.driver || null, latest: v[1], date: d ? `${d[3]}-${d[1]}-${d[2]}` : null,
    title: 'Pilote graphique Intel Arc', url: PAGES.intelArc, page: PAGES.intelArc,
    status: status(v[1], g.driver),
  };
}

const MAKERS = { '10DE': ['nvidia', 'NVIDIA', nvidia], '1002': ['amd', 'AMD', amd], '8086': ['intel', 'Intel', intel] };

// ---------------------------------------------------------------- suivi
function tracker(dataDir) {
  const file = path.join(dataDir, 'gpu-drivers.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
  let pending = null;
  return {
    status() { return { checking: !!pending, last: read() }; },
    /** dev : device.info() (cartes, console portable). */
    check(dev) {
      if (pending) return pending;
      pending = (async () => {
        const gpus = [];
        for (const g of (dev && dev.gpus) || []) {
          const m = MAKERS[String(g.vendor || '').toUpperCase()];
          if (!m) continue; // adaptateur virtuel, affichage de base de Windows…
          const [id, maker, fn] = m;
          let r;
          try { r = await fn(g); } catch (e) { r = { status: 'unknown', error: e.message, page: PAGES[id] }; }
          // Console portable à puce AMD : ses pilotes graphiques viennent du constructeur (réglés pour
          // la console) ; la version générique d'AMD est indiquée, sans notification
          gpus.push({ name: g.name, maker, vendor: id, driver: g.driver || null, driverDate: g.date || null, preferOem: !!(dev.handheld && id === 'amd'), ...r });
        }
        const out = { ok: true, checked: new Date().toISOString(), gpus };
        try { fs.writeFileSync(file, JSON.stringify(out)); } catch { /* disque plein ? */ }
        return out;
      })().finally(() => { pending = null; });
      return pending;
    },
    /** Adresses de téléchargement ou pages trouvées lors de la dernière vérification (pour les ouvrir). */
    allowed(target) {
      const last = read();
      return !!last && (last.gpus || []).some(g => g.url === target || g.page === target) || Object.values(PAGES).includes(target);
    },
  };
}

module.exports = { tracker, compare, nvidiaVersion };
