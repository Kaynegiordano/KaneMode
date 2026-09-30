// Paramètres, organisés comme SteamOS : catégories à gauche, réglages à droite.
import { t, tn, tx, locale, LANGS, lang } from '../i18n.js';
import { el, esc, icon, api, lib, settings, saveSettings, sourceOf, toast, busy, fmt, native, mergeOrder } from '../core.js';
import { definePage, nav, padLive, focusIn, go, focused, setFocus, renderHints } from '../nav.js';
import { segmented, switchRow, openKeyboard, confirmDialog, dialog } from '../widgets.js';
import { pickFile } from './add.js';
import { exitToDesktop, openGame, openStreaming } from './game.js';
import { playBoot, chime } from '../boot.js';
import { sleepNow } from '../power.js';
import { QAM_SECTIONS, PERF_MODES } from '../qam.js';
import { HOME_ROWS } from './home.js';

const ACCENTS = ['#1a9fff', '#6a5cff', '#3fca5a', '#ff8a3d', '#ff4d8d', '#e5484d', '#1fc7c1', '#e6e9ee'];
const PAD_NAMES = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', t('Select'), t('Start'), 'L3', 'R3', '↑', '↓', '←', '→', t('Guide')];
const SECTIONS = [
  ['library', 'i-library', t('Bibliothèque')], ['sgdb', 'i-image', 'SteamGridDB'], ['emulation', 'i-rom', t('Émulation')], ['stream', 'i-gamepad', t('Streaming local')],
  ['look', 'i-palette', t('Apparence')], ['boot', 'i-media', t('Démarrage')], ['pad', 'i-gamepad', t('Manette')],
  ['qam', 'i-grid', t('Accès rapide')], ['access', 'i-info', t('Accessibilité')], ['power', 'i-moon', t('Veille')], ['energy', 'i-power', t('Énergie')],
  ['device', 'i-battery', t('Appareil et pilotes')],
  ['storage', 'i-drive', t('Stockage')], ['xbox', 'i-desktop', t('Mode Xbox')], ['system', 'i-cpu', t('Système')],
];
// Réglage demandé par une autre page → catégorie à afficher
const SECTION_OF = { 'sgdb-key': 'sgdb', scan: 'library', demo: 'library', 'upd-apply': 'system', 'upd-check': 'system' };

export async function rescan() {
  busy(t('Analyse de la bibliothèque…'));
  try {
    const r = await api.post('/api/scan');
    await lib.load();
    toast(r.added.length ? `${tn(r.added.length, '{n} nouveauté', '{n} nouveautés')} : ${r.added.slice(0, 3).join(', ')}${r.added.length > 3 ? '…' : ''}` : t('Bibliothèque à jour, rien de nouveau'), { notify: r.added.length > 0 });
  } catch (e) { toast(e.message, { error: true }); }
  finally { busy(null); }
}

const h2 = (s, iconId, text) => s.append(el('h2', '', `${icon(iconId)}${text}`));
function actionRow(s, iconId, title, desc, act, key) {
  const r = el('div', 'set-row nav', `${icon(iconId)}<div class="txt"><b>${title}</b><small>${desc}</small></div><span></span>`);
  r.querySelector('svg').style.cssText = 'width:26px;height:26px;fill:var(--accent)';
  s.append(nav(r, act, key));
  return r;
}
function infoRow(s, title, desc, control) {
  const r = el('div', 'set-row', `<div class="txt"><b>${title}</b>${desc ? `<small>${desc}</small>` : ''}</div>`);
  r.style.gridTemplateColumns = '1fr auto';
  if (control) r.append(control);
  s.append(r);
  return r;
}
const toggle = (s, key, title, desc) => s.append(switchRow({ title, desc, on: settings[key], key, onToggle: v => { settings[key] = v; saveSettings(); } }));

/**
 * Liste ordonnable (sections de l'accès rapide, rangées de l'accueil) : ▲ ▼ pour déplacer,
 * « Affichée / Masquée » pour montrer ou cacher.
 */
function orderList(s, items, orderKey, hiddenKey, prefix) {
  const box = el('div', 'order-list');
  s.append(box);
  const draw = focus => {
    const order = mergeOrder(items.map(i => i.id), settings[orderKey]);
    const hidden = new Set(settings[hiddenKey] || []);
    if (prefix === 'home') {
      if (settings.homeApps === false) hidden.add('apps');
      if (settings.homeStores === false) hidden.add('stores');
    }
    const commit = key => {
      settings[orderKey] = order;
      settings[hiddenKey] = [...hidden];
      if (prefix === 'home') { settings.homeApps = !hidden.has('apps'); settings.homeStores = !hidden.has('stores'); }
      saveSettings();
      draw(key);
    };
    box.replaceChildren();
    order.forEach((id, idx) => {
      const it = items.find(i => i.id === id);
      const r = el('div', 'set-row order-row' + (hidden.has(id) ? ' off' : ''), `<div class="txt"><b>${esc(it.label)}</b><small>${esc(it.desc || '')}</small></div>`);
      const move = d => {
        const key = `${prefix}:${id}:${d < 0 ? 'up' : 'down'}`;
        const edge = (d < 0 && idx === 0) || (d > 0 && idx === order.length - 1);
        return nav(el('div', 'chip-btn' + (edge ? ' dim' : ''), d < 0 ? '▲' : '▼'), () => {
          const j = idx + d;
          if (j < 0 || j >= order.length) return;
          [order[idx], order[j]] = [order[j], order[idx]];
          commit(key);
        }, key);
      };
      const vis = nav(el('div', 'chip-btn' + (hidden.has(id) ? '' : ' primary'), hidden.has(id) ? t('Masquée') : t('Affichée')), () => {
        hidden.has(id) ? hidden.delete(id) : hidden.add(id);
        commit(`${prefix}:${id}:vis`);
      }, `${prefix}:${id}:vis`);
      r.append(move(-1), move(1), vis);
      box.append(r);
    });
    if (focus) focusIn(box, focus);
  };
  draw();
}
const scaleSeg = key => segmented([90, 100, 110, 125].map(v => ({ value: v, label: v + ' %' })), settings.uiScale, v => { settings.uiScale = +v; saveSettings(); }, key);

let page;
const rerender = focus => page.show(page.section, focus);

// ---------- Appareil, réglages Windows, pilotes
const device = (force = false) => api.get(`/api/device?simulate=${encodeURIComponent(settings.simulateDevice || '')}${force ? '&refresh=1' : ''}`).catch(() => null);
async function openDevice(target) {
  try { await api.post('/api/device/open', { target, simulate: settings.simulateDevice || '' }); toast(t('Ouverture…')); }
  catch (e) { toast(e.message, { error: true }); }
}
async function openWin(p) {
  try { await api.post('/api/open-settings', { page: p }); toast(t('Ouverture des Paramètres Windows…')); }
  catch (e) { toast(e.message, { error: true }); }
}
const day = d => new Date(d).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });

// Blocs redessinés sur place (téléchargement, installation, analyse) : l'élément sélectionné et la
// position de la page restent les mêmes. Avant, le focus disparaissait avec l'ancien contenu et
// l'appui suivant ramenait tout en haut des Paramètres.
function snapshot(box) {
  const sc = box.closest('.settings');
  return { key: focused && box.contains(focused) ? focused.dataset.key : null, sc, top: sc ? sc.scrollTop : 0 };
}
function restore(box, snap, focus, fallback = []) {
  if (snap.sc) snap.sc.scrollTop = snap.top;
  const want = [focus, snap.key, ...fallback].find(k => k && box.querySelector(`[data-key="${CSS.escape(k)}"]`));
  if ((focus || snap.key) && want) focusIn(box, want);
  else if (focus || snap.key) focusIn(box);
}

// ---------- Mises à jour de KaneMode (Releases GitHub)
async function updatesBlock(s) {
  h2(s, 'i-download2', t('Mises à jour'));
  const box = el('div');
  s.append(box);
  let timer = 0, drawn = false;
  const draw = async focus => {
    const u = await api.get('/api/update').catch(() => null);
    // Premier dessin : la catégorie est construite hors de l'écran, `box` n'y est pas encore
    if (!u || (drawn && !box.isConnected)) return clearInterval(timer);
    drawn = true;
    const snap = snapshot(box);
    box.replaceChildren();
    const l = u.last, j = u.job;
    infoRow(box, `KaneMode ${esc(u.current)}`, u.packaged ? t('App installée') : t('Version de développement (mise à jour par l’installateur)'));
    box.append(switchRow({ title: t('Vérifier au démarrage'), desc: t('Une notification signale une nouvelle version'), on: u.auto, key: 'upd-auto', onToggle: v => api.post('/api/update/prefs', { auto: v }) }));
    const status = !l ? t('Jamais vérifié') : l.available ? t('Version {a} disponible', { a: esc(l.latest.version) }) : l.latest ? t('À jour · dernière version {a}', { a: esc(l.latest.version) }) : t('Aucune version publiée');
    actionRow(box, 'i-refresh', t('Rechercher des mises à jour'), `${status}${l ? t(' · vérifié le {day}', { day: day(l.checked) }) : ''}`, async () => {
      busy(t('Recherche des mises à jour…'));
      try { await api.post('/api/update/check'); }
      catch (e) { toast(e.message, { error: true }); }
      finally { busy(null); }
      draw('upd-check');
    }, 'upd-check');
    if (l && l.available) {
      if (l.latest.notes) box.append(el('div', 'notice update-notes', esc(l.latest.notes).replace(/\r?\n/g, '<br>')));
      if (!u.packaged) {
        actionRow(box, 'i-globe', t('Ouvrir la page de téléchargement'), t('Installateur KaneMode-Setup sur GitHub'), () => api.post('/api/update/page'), 'upd-page');
      } else if (j.phase === 'downloading') {
        const pct = j.total ? Math.round(100 * j.received / j.total) : 0;
        infoRow(box, t('Téléchargement de la version {a}… {pct} %', { a: esc(j.version), pct }), t('{size} sur {size2}', { size: fmt.size(j.received), size2: fmt.size(j.total) }));
        clearInterval(timer);
        timer = setInterval(() => draw(), 1000);
      } else if (j.phase === 'ready' && j.version === l.latest.version) {
        clearInterval(timer);
        actionRow(box, 'i-download2', t('Installer la version {a}', { a: esc(l.latest.version) }), t('KaneMode se ferme, s’installe et se relance tout seul (environ 30 secondes)'), async () => {
          if (!(await confirmDialog(t('Installer la mise à jour ?'), t('KaneMode va se fermer pendant l’installation, puis se relancer. Les jeux en cours ne sont pas fermés.'), t('Installer')))) return;
          try { await api.post('/api/update/apply'); busy(t('Installation de la mise à jour…')); }
          catch (e) { toast(e.message, { error: true }); }
        }, 'upd-apply');
      } else {
        clearInterval(timer);
        if (j.phase === 'error') infoRow(box, t('<span class="dot-ko"></span>Échec du téléchargement'), esc(j.error || ''));
        actionRow(box, 'i-download2', t('Télécharger la version {a}', { a: esc(l.latest.version) }), t('{size} · empreinte SHA-256 vérifiée', { size: fmt.size(l.latest.msix.size) }), async () => {
          try { await api.post('/api/update/download'); } catch (e) { return toast(e.message, { error: true }); }
          draw('upd-apply');
        }, 'upd-dl');
      }
    }
    restore(box, snap, focus, ['upd-apply', 'upd-dl', 'upd-check']);
  };
  await draw();
}

async function driversBlock(s) {
  const box = el('div');
  s.append(box);
  let drawn = false;
  const draw = async focus => {
    const st = await api.get('/api/drivers').catch(() => ({}));
    if (drawn && !box.isConnected) return;
    drawn = true;
    const snap = snapshot(box);
    box.replaceChildren();
    const last = st.last;
    const items = last && last.ok ? last.items : [];
    const sub = st.searching ? t('Recherche en cours sur Windows Update…')
      : !last ? t('Jamais vérifié sur ce PC · via Windows Update, sans droits administrateur')
        : !last.ok ? t('Échec : {a}', { a: esc(last.error || 'erreur inconnue') })
          : `${items.length ? tn(items.length, '{n} mise à jour proposée', '{n} mises à jour proposées') : t('Aucune mise à jour de pilote en attente')} · ${t('vérifié le {date}', { date: day(last.checked) })}`;
    actionRow(box, 'i-search', t('Rechercher des mises à jour de pilotes'), sub, async () => {
      busy(t('Recherche des pilotes sur Windows Update…'));
      try { await api.post('/api/drivers/search'); }
      catch (e) { toast(e.message, { error: true }); }
      finally { busy(null); }
      draw('drv-search');
    }, 'drv-search');
    for (const it of items) {
      infoRow(box, esc(it.title), [it.class, it.provider || it.maker, it.date && t('version du {day}', { day: day(it.date) }), it.size ? fmt.size(it.size) : ''].filter(Boolean).map(esc).join(' · '));
    }
    if (items.length) {
      actionRow(box, 'i-download2', items.length > 1 ? t('Installer les {length} mises à jour', { length: items.length }) : t('Installer la mise à jour'),
        st.installing ? t('Installation en cours…') : t('Windows demande l’accord de l’administrateur ; un redémarrage peut être nécessaire'), async () => {
          if (st.installing) return toast(t('Installation déjà en cours'));
          if (!(await confirmDialog(t('Installer les pilotes ?'), t('Windows va demander l’autorisation de l’administrateur. Pendant l’installation, l’écran peut clignoter ou s’éteindre un instant.'), t('Installer')))) return;
          try { await api.post('/api/drivers/install', { ids: items.map(i => i.id) }); toast(t('Installation lancée · acceptez la demande de Windows')); }
          catch (e) { return toast(e.message, { error: true }); }
          // Suivi jusqu'à la fin de l'installation
          const timer = setInterval(async () => {
            const now = await api.get('/api/drivers').catch(() => null);
            if (!now || now.installing) return;
            clearInterval(timer);
            const r = now.install;
            if (!r) toast(t('Installation annulée'), { error: true });
            else if (r.ok) toast(`${tn(r.installed, '{n} pilote installé', '{n} pilotes installés')}${r.reboot ? ` · ${t('redémarrez pour terminer')}` : ''}`, { notify: true });
            else toast(t('Échec de l’installation : {a}', { a: r.error || '' }), { error: true });
            draw('drv-search');
          }, 3000);
        }, 'drv-install');
    }
    if (st.install && !st.installing) {
      infoRow(box, st.install.ok ? t('Dernière installation réussie') : t('Dernière installation échouée'),
        st.install.ok ? `${tn(st.install.installed, '{n} pilote installé', '{n} pilotes installés')}${st.install.reboot ? ` · ${t('redémarrage nécessaire')}` : ''}` : esc(st.install.error || ''));
    }
    actionRow(box, 'i-open', t('Ouvrir Windows Update'), t('Mises à jour facultatives : pilotes proposés par les constructeurs'), () => openWin('optional-updates'), 'drv-wu');
    restore(box, snap, focus);
  };
  await draw();
}

// ---------- Pilotes graphiques des fabricants (NVIDIA, AMD, Intel)
// Chaque carte : pilote installé, dernier publié par son fabricant, téléchargement officiel. Vérifié
// par l'hôte une fois par jour (notification au démarrage), ou ici à la demande.
const GPU_STATUS = { new: '<span class="dot-ko"></span>', ok: '<span class="dot-ok"></span>', unknown: '' };
async function gpuBlock(s, d, hh) {
  h2(s, 'i-download2', t('Pilotes graphiques'));
  const box = el('div');
  s.append(box);
  let drawn = false;
  const draw = async focus => {
    const st = await api.get('/api/gpu-drivers').catch(() => null);
    if (!st || (drawn && !box.isConnected)) return;
    drawn = true;
    const snap = snapshot(box);
    box.replaceChildren();
    const last = st.last;
    const byName = new Map(((last && last.gpus) || []).map(g => [g.name, g]));
    const news = [...byName.values()].filter(g => g.status === 'new' && !g.preferOem).length;
    actionRow(box, 'i-search', t('Vérifier les pilotes graphiques'),
      st.checking ? t('Vérification sur les sites des fabricants…')
        : !last ? t('NVIDIA, AMD et Intel · vérifié chaque jour automatiquement')
          : `${news ? tn(news, '{n} nouveau pilote', '{n} nouveaux pilotes') : t('Pilotes à jour')} · ${t('vérifié le {date}', { date: day(last.checked) })}`,
      async () => {
        busy(t('Vérification des pilotes graphiques…'));
        try { await api.post('/api/gpu-drivers/check'); } catch (e) { toast(e.message, { error: true }); }
        busy(null);
        draw('gpu-check');
      }, 'gpu-check');
    for (const g of d.gpus) {
      const r = byName.get(g.name);
      const installed = r && r.installed ? r.installed : g.driver || '?';
      const when = g.date ? t(' du {a}', { a: new Date(g.date).toLocaleDateString(locale) }) : '';
      if (!r) { infoRow(box, esc(g.name), t('Pilote {a}{when}', { a: esc(g.driver || '?'), when })); continue; }
      const published = r.latest ? t('publié : {a}{b}{c}', { a: esc(r.latest), b: r.date ? t(" du {day}", { day: day(r.date) }) : r.dateText ? t(" du {a}", { a: esc(r.dateText) }) : '', c: r.sizeMb ? ` · ${r.sizeMb.toLocaleString(locale, { maximumFractionDigits: 1 })}${t(' Mo')}` : '' }) : r.error ? t('site du fabricant injoignable') : t('dernière version à vérifier sur le site');
      const desc = t('Installé : {a}{when} · {published}', { a: esc(installed), when, published });
      const title = `${GPU_STATUS[r.status] || ''}${esc(g.name)}${r.status === 'new' ? ` · ${esc(r.title || t('nouveau pilote'))} ${esc(r.latest)}` : r.status === 'ok' ? t(' · à jour') : ''}`;
      if (r.status === 'new' && r.url && !r.preferOem) {
        actionRow(box, 'i-download2', title, t('{desc} · télécharger sur le site officiel de {a}', { desc, a: esc(r.maker) }), () => openDevice(r.url), 'gpu:' + g.name);
      } else if (g.tool && g.tool.app) {
        actionRow(box, 'i-open', title, t('{desc} · ouvrir {a}', { desc, a: esc(g.tool.name) }), () => openDevice(g.tool.app.target), 'gpu:' + g.name);
      } else if (r.page) {
        actionRow(box, 'i-globe', title, t('{desc} · page officielle de {a}', { desc, a: esc(r.maker) }), () => openDevice(r.page), 'gpu:' + g.name);
      } else infoRow(box, title, desc);
    }
    if (hh && d.gpus.some(g => g.vendor === '1002')) box.append(el('div', 'notice', t('Sur une {a}, préférez les pilotes graphiques proposés par {b} ({c}) : ils sont réglés pour la console (consommation, écran, boutons). La version générique d’AMD est indiquée sans notification.', { a: esc(hh.name), b: esc(hh.maker), c: hh.maker === 'ASUS' ? t("Mises à jour officielles ASUS, plus haut") : esc(hh.tool ? hh.tool.name : 'site officiel') })));
    restore(box, snap, focus);
    // Jamais vérifié, ou il y a plus d'un jour : vérification tout de suite
    if (!st.checking && (!last || Date.now() - Date.parse(last.checked) > 24 * 3600e3) && !box.dataset.auto) {
      box.dataset.auto = '1';
      api.post('/api/gpu-drivers/check').catch(() => {}).then(() => draw());
    }
  };
  await draw();
}

// ---------- Mises à jour officielles du constructeur (BIOS et pilotes du modèle de console)
const OEM_STATUS = { new: '<span class="dot-ko"></span>', ok: '<span class="dot-ok"></span>', unknown: '' };
async function oemBlock(s, hh) {
  h2(s, 'i-download2', t('Mises à jour officielles {a}', { a: esc(hh.maker) }));
  const box = el('div');
  s.append(box);
  const sim = settings.simulateDevice || '';
  const check = async () => {
    try { await api.post('/api/oem/check', { simulate: sim }); }
    catch (e) { toast(e.message, { error: true }); }
  };
  let drawn = false;
  const draw = async focus => {
    const st = await api.get(`/api/oem?simulate=${encodeURIComponent(sim)}`).catch(() => null);
    if (!st || (drawn && !box.isConnected)) return;
    drawn = true;
    const snap = snapshot(box);
    box.replaceChildren();
    const last = st.last;
    const channels = last && last.ok ? last.channels : [];
    const drivers = (channels.find(c => c.items) || { items: [] }).items;
    const news = drivers.filter(i => i.status === 'new');
    const bios = channels.find(c => c.id.endsWith('-bios'));
    const count = news.length + (bios && bios.status === 'new' ? 1 : 0);
    const sub = st.checking ? t('Vérification sur le site {a}…', { a: esc(hh.maker) })
      : !last ? t('BIOS et pilotes publiés par {a} pour cette console', { a: esc(hh.maker) })
        : !last.ok ? t('Échec : {a}', { a: esc(last.error || 'erreur inconnue') })
          : `${count ? tn(count, '{n} mise à jour', '{n} mises à jour') : t('Aucune mise à jour')} · ${t('vérifié le {date}', { date: day(last.checked) })}`;
    actionRow(box, 'i-search', t('Vérifier les mises à jour du constructeur'), sub, async () => {
      busy(t('Vérification sur le site {maker}…', { maker: hh.maker }));
      await check();
      busy(null);
      draw('oem-check');
    }, 'oem-check');
    if (bios) {
      const desc = t('Installé : {a} · publié : {b}{c}{d}', { a: esc(bios.installed || '?'), b: esc(bios.latest), c: bios.date ? t(" du {day}", { day: day(bios.date) }) : '', d: bios.size ? ` · ${esc(bios.size)}` : '' });
      const title = `${OEM_STATUS[bios.status]}${esc(bios.title)}${bios.status === 'new' ? t(' · nouvelle version') : bios.status === 'ok' ? t(' · à jour') : ''}`;
      if (bios.url && bios.status !== 'ok') actionRow(box, 'i-download2', title, `${desc} · ${esc(bios.notes)}`, () => openDevice(bios.url), 'oem-bios');
      else infoRow(box, title, desc);
    }
    // Pilotes : ceux qui ont une version plus récente d'abord, puis ceux qui sont à jour
    for (const it of [...news, ...drivers.filter(i => i.status === 'ok')]) {
      const desc = [it.category, it.installed ? t('installé : {installed}', { installed: it.installed }) : '', t('publié : {version}', { version: it.version }), it.date && t('du {day}', { day: day(it.date) }), it.size].filter(Boolean).map(esc).join(' · ');
      const title = `${OEM_STATUS[it.status]}${esc(it.title)}${it.status === 'new' ? t(' · nouvelle version') : ''}`;
      if (it.url && it.status === 'new') actionRow(box, 'i-download2', title, desc + t(' · télécharger sur le site officiel'), () => openDevice(it.url), 'oem:' + it.title);
      else infoRow(box, title, desc);
    }
    const other = drivers.filter(i => i.status === 'unknown').length;
    if (other) infoRow(box, tn(other, '{n} autre pilote publié', '{n} autres pilotes publiés'), t('Outils ou matériel non détecté sur cette console : voir le site officiel'));
    if (hh.support) actionRow(box, 'i-globe', t('Assistance {a}', { a: esc(hh.maker) }), t('Toutes les versions, notes de version et manuels'), () => openDevice(hh.support), 'oem-site');
    restore(box, snap, focus);
    // Vérification automatique une fois par jour
    if (!st.checking && (!last || Date.now() - Date.parse(last.checked) > 24 * 3600e3) && !box.dataset.auto) {
      box.dataset.auto = '1';
      check().then(() => draw());
    }
  };
  await draw();
}

// ---------- Boutons dédiés de la console (ROG Ally : Command Center et Armoury Crate)
const BUTTON_ACTIONS = [
  { value: 'gamebar', label: t('Game Bar') }, { value: 'qam', label: t('Accès rapide') }, { value: 'menu', label: t('Menu') },
  { value: 'home', label: 'KaneMode' }, { value: 'taskview', label: t('Vue des tâches') }, { value: 'screenshot', label: t('Capture') },
  { value: 'none', label: t('Rien') },
];
function buttonsBlock(s) {
  h2(s, 'i-gamepad', t('Boutons de la console'));
  // Sept choix : la rangée prend toute la largeur, sous le titre
  const row = (key, title, desc) => {
    const r = el('div', 'set-row', `<div class="txt"><b>${title}</b><small>${desc}</small></div>`);
    r.style.gridTemplateColumns = '1fr';
    r.append(segmented(BUTTON_ACTIONS, settings[key], v => { settings[key] = v; saveSettings(); }, key));
    s.append(r);
  };
  row('btnCC', t('Bouton Command Center'), t('Le petit bouton en haut à gauche de l’écran'));
  row('btnAC', t('Bouton Armoury Crate'), t('Le bouton sous Command Center'));
  row('btnACHold', t('Armoury Crate, appui long'), t('Maintenu une seconde'));
  toggle(s, 'blockAsusPrompt', t('Bloquer l’invite Armoury Crate SE'), t('Referme la fenêtre qui propose d’installer Armoury Crate quand on appuie sur ces boutons'));
  s.append(el('div', 'notice', native.available
    ? t('Ces boutons fonctionnent partout, même en jeu, tant que KaneMode est ouvert. <b>Vue des tâches</b> montre les fenêtres ouvertes, comme un appui long sur la touche Xbox. <b>Accès rapide</b> et <b>Menu</b> s’ouvrent par-dessus le jeu, et le refermer y ramène. <b>KaneMode</b> revient à l’accueil.')
    : t('Les boutons de la console sont lus par l’app KaneMode installée (pas dans le navigateur).')));
}

const BUILDERS = {
  async library(s) {
    h2(s, 'i-library', t('Bibliothèque'));
    actionRow(s, 'i-refresh', t('Actualiser la bibliothèque'), t('Détecte les jeux de toutes les boutiques et les ROMs{a}', { a: lib.generated ? t(
      " · dernier scan le {toLocaleString}",
      { toLocaleString: new Date(lib.generated).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) }
    ) : '' }), rescan, 'scan');
    s.append(switchRow({
      title: t('Bibliothèque de démonstration'), key: 'demo', on: settings.demo,
      desc: t('Ajoute des jeux fictifs de toutes les boutiques et des ROMs pour voir une grosse bibliothèque. Marqués « DÉMO », ils ne se lancent pas.'),
      onToggle: async v => { settings.demo = v; saveSettings(); await lib.load(); toast(v ? t('Démo activée') : t('Démo désactivée')); },
    }));
    // Boutiques démarrées sans leur fenêtre peu après KaneMode : le premier jeu part tout de suite
    const cfg = await api.get('/api/config').catch(() => null);
    if (cfg && cfg.storesReady) {
      h2(s, 'i-play', t('Lancement des jeux'));
      s.append(el('div', 'notice', t('Une boutique fermée met du temps à s’ouvrir avant le jeu. Gardée prête en arrière-plan (sans fenêtre, dans la zone de notification), le jeu démarre tout de suite. Par défaut : les boutiques dont vous avez des jeux installés.')));
      for (const [id, name] of [['steam', t('Steam')], ['epic', t('Epic Games')]]) {
        if (!cfg.storesAvailable || !cfg.storesAvailable[id]) continue;
        s.append(switchRow({
          title: t('{name} prêt en arrière-plan', { name }), key: 'ready:' + id, on: !!cfg.storesReady[id],
          desc: t('Démarré sans fenêtre peu après KaneMode{a}', { a: cfg.storesReadyChosen[id] === undefined ? t(" · réglé automatiquement") : '' }),
          onToggle: v => api.post('/api/config', { storesReady: { [id]: v } }).then(() => toast(v ? t('{name} sera prêt pour vos jeux', { name }) : t('{name} ne sera plus démarré à l’avance', { name }))).catch(e => toast(e.message, { error: true })),
        }));
      }
    }

    h2(s, 'i-store', t('Boutiques et lanceurs'));
    const counts = {};
    lib.games.forEach(g => { counts[g.source] = (counts[g.source] || 0) + 1; });
    const rowFor = (id, name, img, installed) => {
      const n = counts[id] || 0;
      const lead = img ? `<img src="${img}" alt="">` : '<span class="noicon"></span>';
      const items = tn(n, '{n} élément', '{n} éléments');
      const status = installed === null ? items : installed ? `${t('Installé')} · ${items}` : n ? `${items} (${t('démo')})` : t('Non détecté sur ce PC');
      s.append(switchRow({
        lead, title: name, desc: t('{status} · afficher dans la bibliothèque', { status }), key: 'src:' + id, on: !settings.hiddenSources.includes(id),
        onToggle: v => { settings.hiddenSources = v ? settings.hiddenSources.filter(x => x !== id) : [...settings.hiddenSources, id]; saveSettings(); },
      }));
    };
    const launchers = [...lib.launchers].sort((a, b) => b.installed - a.installed || (counts[b.id] || 0) - (counts[a.id] || 0));
    for (const l of launchers) if (sourceOf(l.id).label !== l.id) rowFor(l.id, l.name, l.icon, l.installed);
    rowFor('custom', t('Ajouts perso'), null, null);
    rowFor('rom', t('Émulation'), null, null);
  },

  async sgdb(s) {
    h2(s, 'i-image', 'SteamGridDB');
    const cfg = await api.get('/api/config');
    s.append(el('div', 'notice', t('Jaquettes, fonds, logos et icônes de la communauté SteamGridDB pour <b>tous</b> vos jeux (Steam, autres boutiques, ajouts perso, ROMs). <b>Rien à configurer</b> : ni compte, ni clé. Pour un jeu précis : fiche du jeu → <b>Visuels</b> (Récupérer à nouveau, Parcourir SteamGridDB, Importer votre image).')));
    const cfgToggle = (key, title, desc, on) => s.append(switchRow({ title, desc, on, key: 'cfg:' + key, onToggle: async v => { await api.post('/api/config', { [key]: v }); await lib.load(); } }));
    cfgToggle('sgdbAuto', t('Visuels automatiques'), t('Complète automatiquement les jaquettes, fonds et logos manquants'), cfg.sgdb.auto);
    cfgToggle('sgdbPreferSteam', t('Préférer les visuels officiels Steam'), t('Pour les jeux présents sur Steam ; sinon SteamGridDB passe en premier'), cfg.sgdb.preferSteam);
    infoRow(s, t('Style préféré des jaquettes'), t('Proposé en premier, automatiquement et dans « Parcourir »'), segmented(
      [{ value: '', label: t('Tous') }, { value: 'alternate', label: t('Alternatif') }, { value: 'blurred', label: t('Flou') }, { value: 'white_logo', label: t('Logo blanc') }, { value: 'material', label: t('Material') }],
      cfg.sgdb.style, async v => { await api.post('/api/config', { sgdbStyle: v }); toast(t('Style enregistré')); }, 'sgstyle'));
    s.append(el('div', 'notice', t('Les visuels posés dans Steam par SGDBoop ou Steam ROM Manager (dossier <code>grid</code>) sont repris automatiquement.')));
    h2(s, 'i-gear', t('Avancé'));
    actionRow(s, 'i-edit', t('Clé API personnelle (facultative)'), cfg.sgdb.key ? t('Utilisée ({a}) · passe par l’API officielle · A pour la remplacer', { a: esc(cfg.sgdb.hint) }) : t('Inutile au quotidien · utile seulement si l’accès public venait à changer'), async () => {
      const key = await openKeyboard({ title: t('Clé API SteamGridDB (Ctrl+V pour coller)'), placeholder: t('32 caractères') });
      if (!key) return;
      busy(t('Vérification de la clé…'));
      try { await api.post('/api/config', { sgdbKey: key.trim() }); toast(t('Clé SteamGridDB enregistrée')); await lib.load(); }
      catch (e) { toast(e.message, { error: true }); }
      finally { busy(null); }
      rerender('sgdb-key');
    }, 'sgdb-key');
    if (cfg.sgdb.key) {
      actionRow(s, 'i-trash', t('Retirer la clé'), t('Revient à l’accès public, sans clé'), async () => {
        if (!(await confirmDialog(t('Retirer la clé SteamGridDB ?'), t('Les visuels déjà choisis sont conservés.'), t('Retirer'), true))) return;
        await api.post('/api/config', { sgdbKey: null }); await lib.load(); rerender('sgdb-key');
      }, 'sgdb-del');
    }
  },

  async emulation(s) {
    h2(s, 'i-rom', t('Émulation'));
    const d = await api.get('/api/emulation');
    const roms = lib.games.filter(g => g.source === 'rom' && !g.demo);
    const emus = d.emulators.filter(e => e.path).length, systems = d.systems.filter(x => x.count).length;
    infoRow(s, `${tn(roms.length, '{n} ROM', '{n} ROMs')} · ${tn(emus, '{n} émulateur détecté', '{n} émulateurs détectés')}`, `${tn(d.romRoots.length, '{n} dossier de ROMs', '{n} dossiers de ROMs')} · ${tn(systems, '{n} console', '{n} consoles')}`);
    actionRow(s, 'i-rom', t('Gérer l’émulation'), t('Dossiers de ROMs, émulateurs, consoles prises en charge'), () => go('emulation'), 'open-emu');
  },

  async stream(s) {
    h2(s, 'i-gamepad', t('Streaming local'));
    const d = await api.get('/api/stream').catch(() => null);
    if (!d || !d.engine) {
      infoRow(s, t('<span class="dot-ko"></span>Moteur de streaming absent'), t('L’app KaneMode l’embarque ; en développement : engine\\build-engine.ps1'));
      return;
    }
    infoRow(s, t('<span class="dot-ok"></span>Streaming intégré{a}', { a: d.dev ? t(" (moteur compilé : engine\\out)") : '' }), t('Jouez aux jeux de vos autres PC (Sunshine, Apollo, GeForce Experience) en plein écran'));
    for (const h of d.hosts) {
      infoRow(s, `<span class="${h.paired ? 'dot-ok' : 'dot-ko'}"></span>${esc(h.name)}`, `${h.paired ? t('Appairé') : t('Non appairé')} · ${tn(h.apps, '{n} application', '{n} applications')}`);
    }
    actionRow(s, 'i-gamepad', t('Ouvrir le streaming local'), t('PC trouvés automatiquement, appairage, bibliothèque de chaque PC, qualité, profils'), openStreaming, 'open-stream');
    s.append(el('div', 'notice', t('Les jeux de vos PC se choisissent dans le streaming local, qui prend les couleurs de KaneMode (accent compris). Pendant un jeu, <b>LB + RB + Select + Y</b> met la session en pause : le jeu reste ouvert sur le PC, <b>Reprendre</b> y retourne. Sur l’accueil du streaming local, <b>B</b> revient à KaneMode.')));
  },
  async look(s) {
    h2(s, 'i-palette', t('Apparence'));
    // Langue : l'interface se recharge pour l'appliquer partout (menus, widgets, streaming)
    const langName = LANGS.find(([id]) => id === lang)[1];
    actionRow(s, 'i-globe', `${t('Langue')} · ${esc(langName)}`, esc(settings.lang ? t('Langue de l’interface, des widgets Game Bar et du streaming local') : t('Automatique : langue de Windows')), async () => {
      const v = await dialog({
        title: t('Langue'),
        buttons: [{ label: t('Automatique (langue de Windows)'), value: 'auto', primary: !settings.lang }, ...LANGS.map(([value, label]) => ({ label, value, primary: settings.lang === value }))],
      });
      if (!v || v === (settings.lang || 'auto')) return;
      settings.lang = v === 'auto' ? undefined : v;
      saveSettings();
      location.reload();
    }, 'lang');
    const sw = infoRow(s, t('Couleur d’accent'), t('Boutons, curseurs et reflets · repris par le streaming local'));
    const swatches = el('div', 'swatches');
    for (const c of ACCENTS) {
      const d = el('div', 'swatch' + (settings.accent === c ? ' active' : ''), icon('i-check'));
      d.style.setProperty('--sw', c);
      swatches.append(nav(d, () => { settings.accent = c; saveSettings(); swatches.querySelectorAll('.swatch').forEach(x => x.classList.toggle('active', x === d)); }, 'accent:' + c));
    }
    sw.append(swatches);
    const pick = (title, desc, key, options) => infoRow(s, title, desc, segmented(options.map(([value, label]) => ({ value, label })), settings[key], v => { settings[key] = typeof settings[key] === 'boolean' ? v === 'true' : v; saveSettings(); }, key));
    pick(t('Fond d’écran'), t('Derrière les menus'), 'background', [['art', t('Jaquette floue')], ['gradient', t('Dégradé animé')], ['dark', t('Uni')]]);
    infoRow(s, t('Taille de l’interface'), t('Pour un grand écran vu de loin, ou l’écran d’une console portable'), scaleSeg('scale'));
    pick(t('Taille des jaquettes'), t('Rangées de l’accueil et de l’émulation'), 'cardSize', [['s', t('Petite')], ['m', t('Moyenne')], ['l', t('Grande')]]);
    pick(t('Coins'), t('Jaquettes, boutons et panneaux'), 'corners', [['square', t('Carrés')], ['soft', t('Doux')], ['round', t('Arrondis')]]);
    pick(t('Police'), '', 'font', [['segoe', t('Segoe UI')], ['system', t('Système')]]);
    toggle(s, 'lowFx', t('Effets allégés'), t('Moins d’ombres, de flous et de reflets : plus fluide sur une console portable, plus économe en batterie'));
    toggle(s, 'solidPanels', t('Panneaux opaques'), t('Sans transparence ni flou : plus lisible, un peu plus léger pour la carte graphique'));
    toggle(s, 'badges', t('Toujours afficher la boutique'), t('Pastille de la boutique sur chaque jaquette de la bibliothèque'));

    h2(s, 'i-gamepad', t('Barre des boutons'));
    pick(t('Barre du bas'), t('Indications des boutons · compacte : plus de place pour l’interface'), 'hintsBar', [['full', t('Complète')], ['compact', t('Compacte')]]);

    h2(s, 'i-clock', t('Barre du haut'));
    pick(t('Horloge'), '', 'clock24', [['true', '24 h'], ['false', '12 h']]);
    toggle(s, 'clockSeconds', t('Afficher les secondes'), '');
    toggle(s, 'batteryPct', t('Pourcentage de batterie'), t('À côté de l’icône, sur les consoles et PC portables'));

    h2(s, 'i-home', t('Accueil'));
    s.append(el('div', 'notice', t('Les <b>jeux récents</b> (et le streaming local) restent en haut. Choisissez l’ordre et l’affichage des rangées suivantes.')));
    orderList(s, HOME_ROWS, 'homeRows', 'homeHidden', 'home');
    toggle(s, 'sounds', t('Sons de l’interface'), t('Petits sons de navigation et de validation'));
    toggle(s, 'notifications', t('Notifications'), t('Nouveaux jeux détectés, ajouts…'));

    h2(s, 'i-store', t('Bons plans et nouveautés'));
    s.append(el('div', 'notice', t('Rangée de l’accueil : promotions, nouveautés, sorties à venir et jeux gratuits, relus toutes les 4 heures au plus (jamais pendant un jeu). A sur une offre ouvre sa page dans l’application de la boutique si elle est installée, sinon dans le navigateur.')));
    toggle(s, 'dealsSteam', 'Steam', t('Promotions, nouveautés et sorties à venir'));
    toggle(s, 'dealsEpic', 'Epic Games Store', t('Jeux gratuits de la semaine et à venir'));
    toggle(s, 'dealsGog', 'GOG', t('Promotions et nouveautés'));
    toggle(s, 'dealsOther', t('Jeux offerts ailleurs'), t('IndieGala, itch.io, Prime Gaming… (GamerPower)'));
    toggle(s, 'dealsFree', t('Jeux gratuits'), '');
    toggle(s, 'dealsPromo', t('Promotions'), '');
    toggle(s, 'dealsNew', t('Nouveautés'), '');
    toggle(s, 'dealsSoon', t('Sorties à venir'), '');
    toggle(s, 'dealsAuto', t('Défilement automatique'), t('Une carte toutes les 5 secondes quand la rangée n’est pas parcourue (jamais en effets allégés)'));
  },

  async qam(s) {
    h2(s, 'i-grid', t('Accès rapide'));
    s.append(el('div', 'notice', t('Le panneau <b>Accès rapide</b> (bouton {a} de la manette, touche Q) règle vraiment Windows : mode de performance, volume, luminosité, Wi-Fi, Bluetooth, fréquence de l’écran, profil et puissance de la console. Choisissez ses sections et leur ordre.', { a: settings.padSwap ? t("Select") : t("Start") })));
    orderList(s, QAM_SECTIONS, 'qamOrder', 'qamHidden', 'qam');
  },

  async energy(s) {
    h2(s, 'i-power', t('Énergie'));
    const [p, sys, d] = await Promise.all([api.get('/api/power/profiles'), api.get('/api/sys').catch(() => null), device()]);
    const save = async patch => {
      try { Object.assign(p, await api.post('/api/power/profiles', patch)); } catch (e) { toast(e.message, { error: true }); }
    };
    s.append(switchRow({
      title: t('Profils automatiques'), key: 'pw-auto', on: p.auto,
      desc: t('En branchant ou débranchant le chargeur, KaneMode applique le profil correspondant'),
      onToggle: v => save({ auto: v }),
    }));
    const hh = d && d.ok && d.handheld;
    const vendor = sys && sys.vendor && sys.vendor.modes ? sys.vendor : null;
    const VL = { silent: t('Silencieux'), quiet: t('Silencieux'), balanced: t('Équilibré'), performance: t('Performance'), turbo: t('Turbo') };
    for (const [src, title, icon1] of [['battery', t('Sur batterie'), 'i-battery'], ['ac', t('Sur secteur'), 'i-power']]) {
      h2(s, icon1, title);
      const prof = p[src] || {};
      const field = (label, desc, key, options) => infoRow(s, label, desc, segmented(
        [{ value: '', label: t('Inchangé') }, ...options.map(([value, lab]) => ({ value, label: lab }))],
        prof[key] ?? '', v => save({ [src]: { [key]: v === '' ? null : (typeof options[0][0] === 'number' ? +v : v) } }), `${src}-${key}`));
      field(t('Mode de performance'), t('Règle d’un coup Windows, le processeur et le profil de la console · les réglages suivants le précisent'), 'mode', PERF_MODES);
      if (vendor) field(t('Profil {a}', { a: hh ? esc(hh.maker) : t("de la console") }), t('Puissance et ventilateurs réglés par le constructeur'), 'vendor', vendor.modes.map(m => [m, VL[m] || m]));
      if (sys && sys.vendor && sys.vendor.tdp) field(t('Puissance (TDP, expérimental)'), t('{min} à {max} W, les trois limites égales', { min: sys.vendor.tdp.min, max: sys.vendor.tdp.max }), 'tdp', [8, 10, 15, 20, 25, 30].filter(w => w >= sys.vendor.tdp.min && w <= sys.vendor.tdp.max).map(w => [w, w + ' W']));
      if (sys && sys.cpu) {
        field(t('Limite du processeur'), t('Plus bas : moins de chaleur et plus d’autonomie'), 'cpuMax', [[50, '50 %'], [70, '70 %'], [85, '85 %'], [100, '100 %']]);
        infoRow(s, t('Turbo du processeur'), t('Désactivé : plus frais et plus économe, un peu moins rapide'), segmented(
          [{ value: '', label: t('Inchangé') }, { value: 'on', label: t('Activé') }, { value: 'off', label: t('Désactivé') }],
          prof.boost === true ? 'on' : prof.boost === false ? 'off' : '', v => save({ [src]: { boost: v === '' ? null : v === 'on' } }), `${src}-boost`));
      }
      if (sys && sys.refresh && sys.refresh.available.length > 1) field(t('Fréquence de l’écran'), t('Moins d’images par seconde : plus d’autonomie'), 'refresh', sys.refresh.available.filter(hz => hz >= 30).slice(-4).map(hz => [hz, hz + t(' Hz')]));
      if (sys && sys.brightness != null) field(t('Luminosité'), '', 'brightness', [30, 50, 70, 100].map(v => [v, v + ' %']));
      actionRow(s, 'i-check', t('Appliquer maintenant'), t('Sans attendre de brancher ou débrancher le chargeur'), async () => {
        busy(t('Application du profil…'));
        try {
          const r = await api.post('/api/power/apply', { source: src, force: true });
          toast(r.errors && r.errors.length ? r.errors[0] : t('Profil « {toLowerCase} » appliqué', { toLowerCase: title.toLowerCase() }), { error: !!(r.errors && r.errors.length) });
        } catch (e) { toast(e.message, { error: true }); }
        finally { busy(null); }
      }, 'pw-apply-' + src);
    }
    if (hh && !vendor) {
      s.append(el('div', 'notice', t('Sur {a}, les profils de puissance du constructeur se règlent dans {b} (Paramètres → Appareil et pilotes) : KaneMode règle ici le mode d’alimentation de Windows, la fréquence et la luminosité.', { a: esc(hh.name), b: esc(hh.tool ? hh.tool.name : t("son logiciel")) })));
    } else if (vendor) {
      s.append(el('div', 'notice', t('Profils {a} : les mêmes que dans {b}. La puissance en watts est expérimentale : restez dans les valeurs proposées.', { a: esc(hh ? hh.maker : ''), b: esc(hh && hh.tool ? hh.tool.name : t("le logiciel du constructeur")) })));
    }
  },
  async boot(s) {
    h2(s, 'i-media', t('Démarrage'));
    const cfg = await api.get('/api/config');
    const set = (k, v) => { settings[k] = v; saveSettings(); };
    infoRow(s, t('Animation'), t('Au lancement de KaneMode · n’importe quel bouton la passe'), segmented(
      [{ value: 'logo', label: t('Logo KaneMode') }, { value: 'video', label: t('Vidéo perso') }, { value: 'none', label: t('Aucune') }],
      settings.bootMode, v => {
        if (v === 'video' && !cfg.bootVideo) toast(t('Choisissez la vidéo plus bas (« Vidéo perso… »)'));
        set('bootMode', v);
      }, 'boot-mode'));
    infoRow(s, t('Son'), t('Joué avec le logo, qui apparaît pile sur son éclat, façon console de salon'), segmented(
      [{ value: 'chime', label: t('Son KaneMode') }, { value: 'custom', label: t('Son perso') }, { value: 'none', label: t('Aucun') }],
      settings.bootSound, v => {
        if (v === 'custom' && !cfg.bootSound) toast(t('Choisissez le son plus bas (« Son perso… »)'));
        set('bootSound', v);
      }, 'boot-sound'));
    infoRow(s, t('Volume du son'), t('Démarrage, mise en veille et réveil'), segmented(
      [25, 50, 70, 100].map(v => ({ value: v, label: v + ' %' })), settings.bootVolume,
      v => { set('bootVolume', +v); chime('wake'); }, 'boot-vol'));
    actionRow(s, 'i-play', t('Tester le démarrage'), t('Rejoue l’animation et le son choisis'), () => playBoot({ force: true, mode: settings.bootMode === 'none' ? 'logo' : settings.bootMode }), 'boot-play');
    h2(s, 'i-folder', t('Personnaliser'));
    actionRow(s, 'i-media', t('Vidéo perso…'), cfg.bootVideo ? t('Actuelle : {a} · A pour en choisir une autre', { a: esc(cfg.bootVideo) }) : t('Un fichier .mp4 ou .webm sur vos disques (votre ancienne vidéo est dans extras\\ du dossier KaneMode)'), async () => {
      const p = await pickFile('video', t('Choisir la vidéo de démarrage'));
      if (!p) return;
      await api.post('/api/config', { bootVideo: p });
      set('bootMode', 'video');
      toast(t('Vidéo de démarrage enregistrée'));
      rerender('boot-video');
    }, 'boot-video');
    if (cfg.bootVideo) actionRow(s, 'i-trash', t('Retirer la vidéo perso'), t('Revient au logo KaneMode'), async () => {
      await api.post('/api/config', { bootVideo: null });
      if (settings.bootMode === 'video') set('bootMode', 'logo');
      rerender('boot-video');
    }, 'boot-video-del');
    actionRow(s, 'i-music', t('Son perso…'), cfg.bootSound ? t('Actuel : {a} · A pour en choisir un autre', { a: esc(cfg.bootSound) }) : t('Un fichier .mp3, .wav, .ogg ou .m4a, idéalement de 2 à 5 secondes · le logo apparaît pile sur le pic du son'), async () => {
      const p = await pickFile('audio', t('Choisir le son de démarrage'));
      if (!p) return;
      await api.post('/api/config', { bootSound: p });
      set('bootSound', 'custom');
      toast(t('Son de démarrage enregistré'));
      rerender('boot-sound-pick');
    }, 'boot-sound-pick');
    if (cfg.bootSound) actionRow(s, 'i-trash', t('Retirer le son perso'), t('Revient au son KaneMode'), async () => {
      await api.post('/api/config', { bootSound: null });
      if (settings.bootSound === 'custom') set('bootSound', 'chime');
      rerender('boot-sound-pick');
    }, 'boot-sound-del');
    toggle(s, 'splash', t('Logo pendant le chargement'), t('Quand l’animation de démarrage est désactivée'));
  },

  async pad(s) {
    h2(s, 'i-gamepad', t('Manette'));
    infoRow(s, t('Symboles des boutons'), t('Automatique : selon la manette utilisée'), segmented([{ value: 'auto', label: t('Automatique') }, { value: 'xbox', label: t('Xbox') }, { value: 'ps', label: 'PlayStation' }], settings.padGlyphs, v => { settings.padGlyphs = v; saveSettings(); }, 'glyphs'));
    infoRow(s, t('Boutons Select et Start'), t('Menu principal et accès rapide'), segmented(
      [{ value: 'false', label: t('Select : menu · Start : accès rapide') }, { value: 'true', label: t('Start : menu · Select : accès rapide') }],
      String(!!settings.padSwap), v => { settings.padSwap = v === 'true'; saveSettings(); renderHints(); }, 'padSwap'));
    infoRow(s, t('Mode souris'), t('Maintenez Start 1 s, comme dans le streaming local : le stick déplace le curseur, A clique, B fait un clic droit, X un clic du milieu, la croix fait défiler, LB / RB reviennent en arrière ou avancent. Il marche aussi dans les autres fenêtres (lanceurs, connexion à un compte). Maintenez Start de nouveau pour revenir à la manette.'));
    page.padName = infoRow(s, t('Aucune manette détectée'), t('Appuyez sur un bouton de la manette pour la réveiller'));
    const tester = el('div', 'set-row');
    tester.style.gridTemplateColumns = '1fr';
    page.buttons = el('div', 'tester', PAD_NAMES.map(n => `<span>${n}</span>`).join(''));
    page.sticks = el('div', 'sticks', t('<div class="stick"><i></i></div>Stick gauche<div class="stick"><i></i></div>Stick droit'));
    tester.append(el('div', 'txt', t('<b>Testeur de boutons</b><small>Les boutons s’allument quand vous appuyez dessus</small>')), page.buttons, page.sticks);
    s.append(tester);
  },

  async access(s) {
    h2(s, 'i-info', t('Accessibilité'));
    toggle(s, 'reduceMotion', t('Réduire les animations'), t('Supprime les zooms, fondus et reflets'));
    toggle(s, 'highContrast', t('Contraste élevé'), t('Textes plus lisibles et contour jaune très visible autour de l’élément sélectionné'));
    infoRow(s, t('Taille de l’interface'), t('Aussi réglable dans Apparence'), scaleSeg('scale2'));
  },

  async power(s) {
    h2(s, 'i-moon', t('Veille'));
    actionRow(s, 'i-moon', t('Mettre en veille maintenant'), native.available ? t('L’écran s’éteint en fondu ; au réveil, KaneMode revient là où vous étiez') : t('Simulée dans le navigateur : n’importe quel bouton réveille'), () => sleepNow(), 'sleep-now');
    const mins = (list, key, never = t('Jamais')) => segmented(list.map(v => ({ value: v, label: v ? `${v} min` : never })), settings[key], v => { settings[key] = +v; saveSettings(); }, key);
    infoRow(s, t('Atténuer l’écran après'), t('Sans activité dans KaneMode · le moindre bouton le rallume'), mins([0, 1, 2, 5, 10], 'dimAfter'));
    infoRow(s, t('Veille automatique sur batterie'), t('Consoles portables et PC portables · jamais pendant un jeu'), mins([0, 5, 10, 15, 30], 'sleepAfterBattery'));
    infoRow(s, t('Veille automatique sur secteur'), t('PC branché ou console en charge'), mins([0, 15, 30, 60], 'sleepAfterAC'));
    toggle(s, 'wakeAnimation', t('Animation de réveil'), t('Logo KaneMode et carillon au retour de veille, puis vérification des manettes'));
    const d = await device();
    if (d && d.ok) infoRow(s, d.modernStandby ? t('Veille moderne (S0)') : d.s3 ? t('Veille classique (S3)') : t('Veille indisponible'),
      d.modernStandby ? t('Comme une console : le PC s’endort et se réveille en une seconde, les téléchargements peuvent continuer.')
        : d.s3 ? t('Le PC s’endort entièrement ; la manette ou le clavier peuvent le réveiller selon le BIOS.') : t('Ce PC ne propose pas de veille (voir les options d’alimentation).'));
    actionRow(s, 'i-open', t('Options d’alimentation de Windows'), t('Bouton d’alimentation, écran, veille du système'), () => openWin('power'), 'win-power');
    s.append(el('div', 'notice', t('Comme sur SteamOS, <b>Mettre en veille</b> agit tout de suite, sans confirmation. Réglez le <b>bouton d’alimentation</b> de la console sur « Veille » dans les options d’alimentation de Windows pour retrouver le même geste.')));
  },

  async device(s) {
    h2(s, 'i-battery', t('Cet appareil'));
    // Description en cache (immédiate) ; l'analyse complète (WMI, plusieurs secondes sur une
    // console) est relancée en arrière-plan pour la prochaine visite
    const d = await device();
    if (!this.deviceRefreshed) { this.deviceRefreshed = true; setTimeout(() => device(true), 1500); }
    if (!d || !d.ok) { s.append(el('div', 'notice', t('Impossible de décrire cet appareil.'))); return; }
    const hh = d.handheld;
    const bat = d.battery ? ` · ${t('batterie {p} %', { p: d.battery.percent })}${d.battery.charging ? t(' (en charge)') : ''}` : '';
    infoRow(s, hh ? t('<span class="dot-ok"></span>{a} détectée{b}', { a: esc(hh.name), b: d.simulated ? ' (simulation)' : '' }) : t('<span class="dot-ko"></span>Pas une console portable'),
      `${esc(d.manufacturer)} ${esc(d.model)}${d.family && d.family !== d.model ? ` (${esc(d.family)})` : ''} · ${esc(d.cpu)} · ${d.memoryGb}${t(' Go')}${d.screenInches ? t(' · écran {screenInches}″', { screenInches: d.screenInches }) : ''}${bat}`);
    if (settings.demo || d.simulated) {
      infoRow(s, t('Simuler une console'), t('Démo : pour voir ces réglages sur un PC de bureau'), segmented(
        [{ value: '', label: t('Non') }, { value: 'rog-ally', label: 'ROG Ally' }, { value: 'legion-go', label: t('Legion Go') }, { value: 'steam-deck', label: t('Steam Deck') }],
        settings.simulateDevice || '', v => { settings.simulateDevice = v; saveSettings(); rerender('simulateDevice-' + v); }, 'simulateDevice'));
    }
    if (hh) {
      const tool = hh.tool;
      if (tool && tool.app) actionRow(s, 'i-open', t('Ouvrir {a}', { a: esc(tool.name) }), t('Mises à jour du BIOS et des pilotes, performances (TDP), boutons, éclairage'), () => openDevice(tool.app.target), 'hh-tool');
      // ASUS : pas besoin d'Armoury Crate, KaneMode suit lui-même le BIOS et les pilotes (plus bas)
      else if (tool && hh.maker !== 'ASUS') actionRow(s, 'i-globe', t('Installer {a}', { a: esc(tool.name) }), t('Logiciel {a} absent · ouvre la page d’assistance officielle', { a: esc(hh.maker) }), () => openDevice(hh.support), 'hh-tool');
      if (hh.support && tool && tool.app && hh.maker !== 'ASUS') actionRow(s, 'i-globe', t('Assistance {a}', { a: esc(hh.maker) }), t('BIOS, pilotes et manuels sur le site officiel'), () => openDevice(hh.support), 'hh-support');
      actionRow(s, 'i-grid', t('Adapter l’interface à cet écran'), t('Textes et jaquettes plus grands pour un écran de {a}″ tenu en main', { a: d.screenInches || 7 }), () => {
        settings.uiScale = 125; settings.badges = false; saveSettings(); toast(t('Interface adaptée à la console'));
      }, 'hh-scale');
      if (hh.id.startsWith('rog-')) buttonsBlock(s);
      if (hh.maker === 'ASUS') oemBlock(s, hh); // se remplit tout seul, sans retenir l'affichage
    }

    gpuBlock(s, d, hh); // se remplit tout seul, sans retenir l'affichage
    h2(s, 'i-download2', t('Autres pilotes (Windows Update)'));
    driversBlock(s);
  },

  async storage(s) {
    h2(s, 'i-drive', t('Stockage'));
    const drives = await api.get('/api/storage');
    for (const d of drives) {
      const games = d.games.reduce((a, g) => a + g.size, 0);
      const used = d.total - d.free;
      s.append(el('div', 'drive', t('<div class="drive-head"><b>Disque {letter}</b><small>{gb} libres sur {gb2}</small></div>\n        <div class="drive-bar"><i class="games" style="width:{toFixed}%"></i><i class="other" style="width:{toFixed2}%"></i></div>\n        <div class="legend"><span style="--c:var(--accent)">Jeux {gb3}</span><span style="--c:rgba(255,255,255,.28)">Autres {gb4}</span><span style="--c:rgba(255,255,255,.08)">Libre {gb5}</span></div>', { letter: d.letter, gb: fmt.gb(d.free), gb2: fmt.gb(d.total), toFixed: (100 * games / d.total).toFixed(2), toFixed2: (100 * Math.max(0, used - games) / d.total).toFixed(2), gb3: fmt.gb(games), gb4: fmt.gb(Math.max(0, used - games)), gb5: fmt.gb(d.free) })));
      for (const g of d.games.slice(0, 8)) {
        const e = lib.byId(g.id);
        const r = el('div', 'set-row nav', `<div class="txt"><b>${esc(g.name)}</b><small>${fmt.size(g.size)}</small></div><span></span>`);
        r.style.gridTemplateColumns = '1fr auto';
        s.append(e ? nav(r, () => openGame(e), 'store:' + g.id) : r);
      }
    }
  },

  async xbox(s) {
    h2(s, 'i-desktop', t('Mode Xbox (plein écran)'));
    const x = await api.get('/api/xboxmode');
    infoRow(s, x.enabled ? t('<span class="dot-ok"></span>Mode Xbox activé') : t('<span class="dot-ko"></span>Mode Xbox non activé'),
      t('Windows {a} · {b}', { a: esc(x.windows), b: x.compatible ? (x.native ? 'build compatible (native)' : t("build compatible (ancienne méthode)")) : t("build non compatible : mettez Windows à jour") }));
    infoRow(s, 'XboxFullScreenExperienceTool', x.toolInstalled ? t('Installé : {a}', { a: esc(x.toolPath) }) : t('Non installé'));
    infoRow(s, 'Activation silencieuse (/silentenable)', x.enabler ? t('Compilée et prête (setup\\bin\\xfset)') : t('Pas encore compilée : setup\\build-xbox-enabler.ps1'));
    infoRow(s, native.available ? t('<span class="dot-ok"></span>App native KaneMode') : t('<span class="dot-ko"></span>Version navigateur (prototype)'),
      native.available ? t('Déclarée à Windows comme application de jeu : elle peut devenir l’application d’accueil du mode Xbox.')
        : t('Seule l’app native peut devenir l’application d’accueil : native\\build.ps1 -Register'));
    actionRow(s, 'i-open', t('Ouvrir les réglages du mode Xbox'), t('Paramètres Windows > Jeux > Mode Xbox : choisissez KaneMode comme application d’accueil'), async () => {
      openWin('xbox');
    }, 'open-xbox-settings');
    s.append(el('div', 'notice', t('Le mode Xbox complet (celui qui permet de choisir l’application d’accueil) s’active avec <code>setup\\install.ps1</code>. Sur ce PC, {a}. Ensuite : réglages du mode Xbox → <b>Choisir l’application d’accueil</b> → <b>KaneMode</b>, et « Entrer en mode Xbox au démarrage ». Pour tout annuler : <code>setup\\uninstall.ps1 -RevertXboxMode</code>.', { a: x.enabled ? t("c’est déjà fait") : 'lancez-le en administrateur' })));
  },

  async system(s) {
    h2(s, 'i-cpu', t('Système'));
    const x = await api.get('/api/system').catch(() => null);
    const grid = el('div', 'sysgrid');
    if (x) {
      const cell = (k, v) => `<div><small>${k}</small><b>${esc(v)}</b></div>`;
      grid.innerHTML = cell(t('Processeur'), t('{trim} ({cores} cœurs)', { trim: x.cpuName.trim(), cores: x.cores })) + cell(t('Mémoire'), `${fmt.gb(x.memUsed)} / ${fmt.gb(x.memTotal)}`)
        + cell(t('Système'), x.os) + cell(t('Allumé depuis'), fmt.duration(x.uptime)) + cell(t('Hôte'), t('Node {node}', { node: x.node })) + cell(t('Données'), x.dataDir);
    }
    s.append(grid);
    updatesBlock(s);
    h2(s, 'i-cpu', t('Interface'));
    actionRow(s, 'i-restart', t('Redémarrer l’interface'), t('Recharge KaneMode sans quitter'), () => location.reload(), 'reload');
    actionRow(s, 'i-exit', t('Bureau Windows'), t('Sort du mode Xbox ; KaneMode reste ouvert'), exitToDesktop, 'exit');
  },
};

page = definePage('settings', {
  libBound: true,
  title: () => t('Paramètres'),
  render(p = {}, { refresh = false } = {}) {
    // Rafraîchissement : on garde l'élément sélectionné ; nouvelle visite : celui demandé
    const keep = refresh && focused && this.el.contains(focused) ? focused.dataset.key : null;
    const section = p.section || SECTION_OF[p.focus] || this.section || 'library';
    this.show(keep ? this.section || section : section, keep || p.focus);
  },
  /** Affiche une catégorie. Sans `focus`, le focus ne bouge pas (survol de la barre latérale). */
  async show(section, focus) {
    const root = this.el;
    // La barre latérale est construite une fois : seul le contenu change
    if (!this.wrap || !root.contains(this.wrap)) {
      this.wrap = el('div', 'settings-wrap');
      this.side = el('div', 'settings-nav');
      this.side.dataset.zone = 'side';
      for (const [id, iconId, label] of SECTIONS) {
        const it = el('div', 'menu-item', `${icon(iconId)}${label}`);
        this.side.append(nav(it, () => this.enter(id), 'sec:' + id));
      }
      const content = el('div', 'settings');
      this.wrap.append(this.side, content);
      root.replaceChildren(el('div', 'page-head', t('<h1>Paramètres</h1>')), this.wrap);
    }
    const changed = section !== this.section;
    this.section = section;
    cancelAnimationFrame(this.raf);
    for (const m of this.side.children) {
      const cur = m.dataset.key === 'sec:' + section;
      m.classList.toggle('current', cur);
      if (cur) m.dataset.autofocus = ''; else delete m.dataset.autofocus;
    }
    if (focus && focus.startsWith('sec:')) focusIn(root, focus, { scroll: false });
    // Construit hors de l'écran puis remplace d'un coup : pas de page vide ni de saut
    const s = el('div', 'settings');
    s.dataset.zone = 'content';
    const token = (this.token = {});
    try { await BUILDERS[section](s); }
    catch (e) { s.append(el('div', 'notice', t('Impossible de charger cette section : {a}', { a: esc(e.message) }))); }
    if (token !== this.token) return; // une autre catégorie a été demandée entre-temps
    const old = this.wrap.lastElementChild;
    const hadFocus = focused && old.contains(focused);
    const top = old.scrollTop;
    old.replaceWith(s);
    // Même catégorie (rafraîchissement) : on reste au même endroit
    if (!changed) s.scrollTop = top;
    if (focus && !focus.startsWith('sec:')) focusIn(root, focus);
    else if (hadFocus) focusIn(s);
    if (section === 'pad') this.live();
  },
  /** A (ou droite) sur une catégorie : on entre dans ses réglages. */
  async enter(id) {
    clearTimeout(this.hover);
    if (id !== this.section || !this.wrap.lastElementChild.children.length) await this.show(id);
    focusIn(this.wrap.lastElementChild);
  },
  onFocus(t) {
    // Comme sur SteamOS : parcourir les catégories affiche leur contenu
    clearTimeout(this.hover);
    const id = t.dataset.key && t.dataset.key.startsWith('sec:') && t.dataset.key.slice(4);
    if (id && id !== this.section) this.hover = setTimeout(() => this.show(id), 160);
  },
  back() {
    // B dans les réglages : retour à la liste des catégories
    if (focused && this.wrap && this.wrap.lastElementChild.contains(focused)) {
      const cur = this.side.querySelector('.current');
      if (cur) { setFocus(cur); return true; }
    }
    return false;
  },
  live() {
    const tick = () => {
      if (!this.el.classList.contains('active') || this.section !== 'pad') return;
      if (padLive.connected) {
        this.padName.innerHTML = `<div class="txt"><b>${esc(tx(padLive.id.replace(/\(.*?\)/g, '').trim()) || t('Manette'))}</b><small>${tn(padLive.connected, '{n} manette connectée', '{n} manettes connectées')} · ${/054c/i.test(padLive.id) ? 'PlayStation' : t('Xbox / standard')}</small></div>`;
      }
      [...this.buttons.children].forEach((b, i) => b.classList.toggle('on', !!padLive.buttons[i]));
      const [lx, ly, rx, ry] = padLive.axes;
      const dots = this.sticks.querySelectorAll('i');
      dots[0].style.transform = `translate(${lx * 27}px, ${ly * 27}px)`;
      dots[1].style.transform = `translate(${rx * 27}px, ${ry * 27}px)`;
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  },
  leave() { cancelAnimationFrame(this.raf); clearTimeout(this.hover); },
  hints: () => [['a', t('Modifier')], ['b', t('Retour')]],
});
