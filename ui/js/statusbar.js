// Barre d'état (en haut à droite) : chaque icône ouvre son onglet du panneau d'état, dans KaneMode.
// Notifications (cloche), Réseau (Wi-Fi ou câble : choix du réseau), Batterie (niveau, mode de
// performance), Heure (date, heure, météo). À la manette : Haut depuis le haut d'une page.
import { t, locale } from './i18n.js';
import { $, $$, el, esc, icon, api, toast, on, getNotifications, clearNotifications, settings, saveSettings, store } from './core.js';
import { nav, openLayer, closeLayer, topLayer, focusIn, setFocus, focused, hooks, go, actions } from './nav.js';
import { openKeyboard, dialog, switchRow } from './widgets.js';

const TABS = [
  ['notifs', 'i-bell', t('Notifications')],
  ['net', 'i-wifi', t('Réseau')],
  ['battery', 'i-battery', t('Batterie')],
  ['clock', 'i-clock', t('Heure et météo')],
];
const panel = $('#status-panel');
const view = { tab: 'notifs', layer: null, timer: null, gen: 0 };

// ---------------------------------------------------------------- batterie (icône et état)
// Le niveau descend avec la charge restante (rouge sous 20 %). Quatre états : normal, en charge
// (animation de remplissage), Turbo (mode Performance) et Éco (mode Éco ou économiseur d'énergie
// de Windows, qui fait passer la console en Éco, voir host/lib/power-profiles.js).
const bat = { b: null, badge: {} };
function batState() {
  const b = bat.b, { saver, mode, vendor } = bat.badge;
  if (!b) return 'normal';
  if (b.charging && b.level < 1) return 'charging';
  if (saver || mode === 'eco') return 'eco';
  return mode === 'performance' || vendor === 'turbo' ? 'turbo' : 'normal';
}
function paintBatteryIcon(elm) {
  const b = bat.b;
  elm.dataset.state = batState();
  elm.classList.toggle('bat-low', !!b && Math.round(b.level * 100) <= 20 && !b.charging);
  elm.style.setProperty('--lvl', Math.max(0.06, b ? b.level : 1).toFixed(3));
}
function paintBattery() {
  const b = bat.b, elm = $('#battery');
  if (!b) return;
  const state = batState(), pct = Math.round(b.level * 100);
  // Branchée et pleine : cachée comme avant, sauf en Turbo (30 W sur secteur)
  elm.hidden = b.charging && b.level === 1 && state !== 'turbo';
  paintBatteryIcon(elm);
  $('span', elm).textContent = pct + ' %';
  const what = { charging: t('en charge'), eco: bat.badge.saver ? t('économiseur d’énergie, mode Éco') : t('mode Éco'), turbo: t('mode Turbo'), normal: '' }[state];
  elm.title = t('Batterie {pct} %', { pct }) + (what ? ' · ' + what : '');
  if (view.layer && view.tab === 'battery') $$('.sp-bat .bat', panel).forEach(paintBatteryIcon);
}
async function pollBadge() {
  if (document.hidden) return;
  try { bat.badge = await api.get('/api/power/badge'); } catch { /* hôte injoignable */ }
  paintBattery();
}
if (navigator.getBattery) {
  navigator.getBattery().then(b => {
    bat.b = b;
    const upd = () => { paintBattery(); pollBadge(); };
    b.addEventListener('levelchange', paintBattery);
    b.addEventListener('chargingchange', upd);
    upd();
    setInterval(pollBadge, 5000);
    document.addEventListener('visibilitychange', pollBadge);
  }).catch(() => {});
}

// ---------------------------------------------------------------- notifications (point sur la cloche)
let seenAt = store.get('notifsSeen', 0); // dernière ouverture de l'onglet : la pastille compte ce qui est plus récent
const paintBell = () => {
  const n = getNotifications().filter(x => x.at.getTime() > seenAt).length;
  const dot = $('#bell-dot');
  if (dot) { dot.hidden = !n; dot.textContent = n > 9 ? '9+' : String(n); }
  $('#bell-btn') && $('#bell-btn').setAttribute('aria-label', n ? t('Notifications ({n} nouvelles)', { n }) : t('Notifications'));
};
on('notifications', () => { if (view.layer && view.tab === 'notifs') render(); paintBell(); });

// ---------------------------------------------------------------- météo (icône et libellé)
const WMO = [
  [[0], '☀️', '🌙', t('Ciel dégagé')], [[1, 2], '⛅', '☁️', t('Partiellement nuageux')], [[3], '☁️', '☁️', t('Couvert')],
  [[45, 48], '🌫️', '🌫️', t('Brouillard')], [[51, 53, 55, 56, 57], '🌦️', '🌧️', t('Bruine')], [[61, 63, 65, 66, 67], '🌧️', '🌧️', t('Pluie')],
  [[71, 73, 75, 77], '🌨️', '🌨️', t('Neige')], [[80, 81, 82], '🌦️', '🌧️', t('Averses')], [[85, 86], '🌨️', '🌨️', t('Averses de neige')],
  [[95, 96, 99], '⛈️', '⛈️', t('Orage')],
];
const wmo = (code, day = true) => { const w = WMO.find(x => x[0].includes(code)) || WMO[2]; return { emoji: day ? w[1] : w[2], label: w[3] }; };
const wx = { v: null, t: 0, p: null };
function getWeather(force = false) {
  if (!force && wx.p) return wx.p;
  if (!force && wx.v && Date.now() - wx.t < 15 * 60e3) return Promise.resolve(wx.v);
  wx.p = api.get('/api/weather' + (force ? '?refresh=1' : '')).then(v => { wx.v = v; wx.t = Date.now(); paintMiniWeather(); return v; }).finally(() => { wx.p = null; });
  return wx.p;
}
function paintMiniWeather() {
  const m = $('#clock-weather');
  if (!m) return;
  const v = wx.v;
  m.hidden = !(v && v.now);
  if (v && v.now) m.textContent = `${wmo(v.now.code, v.now.day).emoji} ${v.now.temp}°`;
}
// Premier essai raté (position de Windows lente au démarrage, hors ligne) : nouvel essai 1 min après
getWeather().catch(() => setTimeout(() => getWeather().catch(() => {}), 60e3));
setInterval(() => { if (!document.hidden) getWeather().catch(() => {}); }, 20 * 60e3);

// ---------------------------------------------------------------- panneau
function buildTabs() {
  const row = $('#sp-tabs');
  row.replaceChildren(...TABS.map(([id, ic, label]) => {
    const b = el('button', 'sp-tab' + (id === view.tab ? ' active' : ''), `${icon(ic)}<span>${esc(label)}</span>`);
    b.setAttribute('aria-pressed', String(id === view.tab));
    nav(b, () => show(id, { focusTab: true }), 'tab-' + id);
    return b;
  }));
}
function show(tab, { focusTab = false } = {}) {
  view.tab = tab;
  $$('.sp-tab', panel).forEach(b => { const on = b.dataset.key === 'tab-' + tab; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
  render();
  if (focusTab) setFocus($(`[data-key="tab-${tab}"]`, panel), { scroll: false, sound: false });
}
/** Re-rend l'onglet ouvert ; le focus reste sur l'élément de même clé s'il existe encore. */
async function render(keep) {
  const body = $('#sp-body'), gen = ++view.gen;
  const key = keep || (focused && body.contains(focused) ? focused.dataset.key : null);
  clearInterval(view.timer);
  const out = el('div', 'sp-pane');
  out.dataset.tab = view.tab;
  await RENDER[view.tab](out, () => gen !== view.gen);
  if (gen !== view.gen) return;
  body.replaceChildren(out);
  if (key && view.layer && topLayer() === view.layer) focusIn(body, key, { scroll: false });
}
const row = (lead, title, desc, act, key, extra = '') => {
  const r = el('div', 'set-row sp-row' + (act ? ' nav' : ''), `${lead}<div class="txt"><b>${esc(title)}</b>${desc ? `<small>${desc}</small>` : ''}</div>${extra}`);
  if (act) nav(r, act, key);
  return r;
};
const button = (ic, label, act, key, cls = '') => nav(el('button', 'sp-btn ' + cls, `${icon(ic)}<span>${esc(label)}</span>`), act, key);
const lead = ic => `<span class="sp-lead">${icon(ic)}</span>`;
// Premier affichage d'un onglet : l'en-tête et une roue en attendant les données (pas au
// rafraîchissement, qui garde l'ancien contenu et le focus jusqu'à la nouvelle version)
function placeholder(out, text) {
  const body = $('#sp-body');
  if (body.firstChild && body.firstChild.dataset.tab === view.tab) return;
  body.replaceChildren(out.cloneNode(true), loading(text));
}
const loading = text => el('div', 'sp-loading', `<i class="spinner"></i><span>${esc(text)}</span>`);

const RENDER = {
  // ---------- Notifications
  // Deux parties toujours affichées : « À signaler » (mise à jour de KaneMode, pilotes) et l'historique
  async notifs(out, stale) {
    seenAt = Date.now(); store.set('notifsSeen', seenAt); paintBell();
    const [upd, drv] = await Promise.all([api.get('/api/update').catch(() => null), api.get('/api/drivers/summary').catch(() => null)]);
    if (stale()) return;
    const close = () => closeLayer(view.layer);
    out.append(el('h3', 'sp-h', esc(t('À signaler'))));
    let pending = 0;
    const last = upd && upd.last;
    if (last && last.available && last.latest) {
      pending++;
      out.append(row(lead('i-download2'), t('Mise à jour {v} disponible', { v: last.latest.version }), esc(t('KaneMode · installer maintenant')), () => { close(); actions['update-open'](); }, 'n-update'));
    }
    for (const [i, d] of ((drv && drv.items) || []).slice(0, 4).entries()) {
      pending++;
      out.append(row(lead('i-cpu'), d.title, esc(d.detail || ''), () => { close(); go('settings', { section: 'device' }); }, 'n-drv' + i));
    }
    if (!pending) out.append(el('div', 'sp-empty', `${icon('i-check')}<span>${esc(t('Tout est à jour'))}</span>`));
    out.append(el('h3', 'sp-h', esc(t('Historique'))));
    if (!settings.notifications) {
      out.append(switchRow({ title: t('Notifications'), desc: esc(t('Désactivées : les nouveaux jeux, ajouts et mises à jour ne sont plus notés ici')), key: 'n-on', on: false,
        onToggle: v => { settings.notifications = v; saveSettings(); } }));
    }
    const list = getNotifications();
    if (!list.length) out.append(el('div', 'sp-empty', `${icon('i-bell')}<span>${esc(t('Aucune notification pour l’instant'))}</span>`));
    list.forEach((n, i) => out.append(row(lead('i-bell'), n.msg, esc(n.at.toLocaleString(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })), () => {}, 'n' + i)));
    if (list.length) {
      const acts = el('div', 'sp-actions');
      acts.append(button('i-trash', t('Tout effacer'), () => { clearNotifications(); show('notifs', { focusTab: true }); }, 'n-clear'));
      out.append(acts);
    }
  },

  // ---------- Réseau
  async net(out, stale) {
    out.append(el('h3', 'sp-h', esc(t('Réseau'))));
    placeholder(out, t('Recherche des réseaux…'));
    const [net, w, sys] = await Promise.all([
      api.get('/api/net').catch(() => ({ kind: 'unknown' })),
      api.get('/api/wifi').catch(e => ({ error: e.message })),
      api.get('/api/sys').catch(() => null),
    ]);
    if (stale()) return;
    const cur = net.kind === 'ethernet' ? [lead('i-ethernet'), t('Connecté par câble'), t('Ethernet · Internet')]
      : net.kind === 'wifi' ? [lead('i-wifi'), w.ssid || t('Wi-Fi'), t('Connecté en Wi-Fi') + ((w.signal ?? net.signal) != null ? ` · ${w.signal ?? net.signal} %` : '')]
      : [lead('i-wifi-off'), t('Hors ligne'), t('Aucune connexion à Internet')];
    const c = row(cur[0], cur[1], esc(cur[2]));
    c.classList.add('sp-current');
    out.append(c);
    const radio = sys && (sys.radios || []).find(r => r.kind === 'WiFi');
    if (radio) out.append(switchRow({ title: t('Wi-Fi'), key: 'wifi-radio', on: radio.on, onToggle: async v => {
      try { await api.post('/api/sys', { cmd: 'radio', kind: 'WiFi', value: v }); setTimeout(() => render('wifi-radio'), 1500); } catch (e) { toast(e.message, { error: true }); }
    } }));
    // Carte Wi-Fi : vue par netsh, ou à défaut par la connexion en cours ou l'interrupteur radio
    // (Windows 11 24H2 : sans l'accès à la position, netsh ne montre même pas la carte)
    const hasWifi = w.adapter === true || net.kind === 'wifi' || !!radio;
    if (w.error) out.append(el('div', 'notice', esc(w.error)));
    else if (!hasWifi) out.append(el('div', 'sp-empty', `${icon('i-wifi-off')}<span>${esc(t('Pas de carte Wi-Fi sur ce PC'))}</span>`));
    else if (radio && !radio.on) out.append(el('div', 'sp-empty', `${icon('i-wifi-off')}<span>${esc(t('Wi-Fi désactivé'))}</span>`));
    else {
      out.append(el('h3', 'sp-h', esc(t('Réseaux Wi-Fi'))));
      if (w.denied || w.adapter !== true) {
        out.append(el('div', 'notice', t('Windows 11 cache les réseaux Wi-Fi tant que la <b>position</b> n’est pas autorisée. Dans la page qui s’ouvre, activez <b>Services de localisation</b>, puis <b>KaneMode</b> dans la liste des applications (et <b>Autoriser les applications de bureau</b>), puis revenez ici.')));
        out.append(button('i-open', t('Autoriser la position'), () => openWin('location'), 'w-loc'));
      }
      for (const n of w.networks || []) {
        const desc = [n.connected ? t('Connecté') : n.known ? t('Enregistré') : null, n.secure ? t('Sécurisé') : t('Ouvert'), `${n.signal} %`].filter(Boolean).join(' · ');
        const r = row(`<span class="sp-lead sp-sig" style="--sig:${n.signal}">${icon('i-wifi')}</span>`, n.ssid, esc(desc), () => wifiAction(n), 'w:' + n.ssid,
          n.connected ? `<span class="sp-tag">${icon('i-check')}</span>` : '');
        if (n.connected) r.classList.add('current');
        out.append(r);
      }
      if (!w.denied && !(w.networks || []).length) out.append(el('div', 'sp-empty', `${icon('i-wifi')}<span>${esc(t('Aucun réseau visible'))}</span>`));
    }
    const acts = el('div', 'sp-actions');
    acts.append(button('i-refresh', t('Actualiser'), () => render('w-refresh'), 'w-refresh'), button('i-open', t('Paramètres Wi-Fi de Windows'), () => openWin('wifi'), 'w-win'));
    out.append(acts);
  },

  // ---------- Batterie
  async battery(out, stale) {
    out.append(el('h3', 'sp-h', esc(t('Batterie'))));
    const badge = await api.get('/api/power/badge?full=1').catch(() => bat.badge);
    if (stale()) return;
    bat.badge = { ...bat.badge, ...badge };
    const b = bat.b, pct = b ? Math.round(b.level * 100) : null;
    const dur = s => { const m = Math.round(s / 60); return m >= 60 ? t('{h} h {m}', { h: Math.floor(m / 60), m: String(m % 60).padStart(2, '0') }) : t('{m} min', { m }); };
    const sub = !b ? t('Pas de batterie') : b.charging
      ? (b.level >= 1 ? t('Branchée · chargée') : Number.isFinite(b.chargingTime) && b.chargingTime > 0 ? t('En charge · pleine dans {d}', { d: dur(b.chargingTime) }) : t('En charge'))
      : Number.isFinite(b.dischargingTime) && b.dischargingTime > 0 ? t('Sur batterie · environ {d} restantes', { d: dur(b.dischargingTime) }) : t('Sur batterie');
    const icon2 = $('#battery .bat-icon').cloneNode(true);
    const big = el('div', 'sp-bat');
    const ico = el('span', 'bat'); ico.append(icon2); paintBatteryIcon(ico);
    big.append(ico, el('div', 'sp-bat-txt', `<b>${pct != null ? pct + ' %' : '—'}</b><small>${esc(sub)}</small>`));
    out.append(big);
    if (bat.badge.saver) out.append(el('div', 'notice', esc(t('Économiseur d’énergie de Windows actif : la console est en mode Éco.'))));
    out.append(el('h3', 'sp-h', esc(t('Mode'))));
    const W = bat.badge.watts || {};
    const modes = el('div', 'sp-modes');
    for (const [m, label, cls] of [['eco', t('Éco'), 'eco'], ['balanced', t('Équilibré'), 'bal'], ['performance', t('Turbo'), 'turbo']]) {
      const cur = bat.badge.mode === m;
      const b2 = nav(el('button', `sp-mode ${cls}${cur ? ' active' : ''}`, `<b>${esc(label)}</b><small>${W[m] ? W[m] + ' W' : m === 'performance' ? esc(t('Performance')) : ''}</small>`), async () => {
        try {
          await api.post('/api/power/mode', { mode: m });
          bat.badge.mode = m; paintBattery();
          toast(t('Mode {m}', { m: label }));
          render('m-' + m);
        } catch (e) { toast(e.message, { error: true }); }
      }, 'm-' + m);
      b2.setAttribute('aria-pressed', String(cur));
      modes.append(b2);
    }
    out.append(modes);
    const acts = el('div', 'sp-actions');
    acts.append(button('i-gear', t('Réglages d’énergie'), () => { closeLayer(view.layer); go('settings', { section: 'energy' }); }, 'b-settings'));
    out.append(acts);
  },

  // ---------- Heure et météo
  async clock(out, stale) {
    const now = el('div', 'sp-time');
    const paint = () => {
      const d = new Date();
      now.innerHTML = `<b>${esc(d.toLocaleTimeString(locale, { hour: settings.clock24 ? '2-digit' : 'numeric', minute: '2-digit', second: '2-digit', hour12: !settings.clock24 }))}</b>`
        + `<span>${esc(d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</span>`;
    };
    paint();
    out.append(now);
    let v = wx.v;
    if (!v) {
      placeholder(out, t('Météo…'));
      v = await getWeather().catch(e => ({ error: e.message }));
      if (stale()) return;
    }
    view.timer = setInterval(() => { if (out.isConnected) paint(); }, 1000);
    out.append(el('h3', 'sp-h', esc(t('Météo'))));
    const acts = el('div', 'sp-actions');
    if (v.error) out.append(el('div', 'notice', esc(v.error)));
    else if (!v.place) out.append(el('div', 'sp-empty', `<span class="sp-emoji">🌍</span><span>${esc(t('Choisissez une ville pour afficher la météo (ou autorisez la position dans Windows).'))}</span>`));
    else {
      const w = wmo(v.now.code, v.now.day);
      out.append(el('div', 'sp-wx',
        `<span class="sp-emoji big">${w.emoji}</span><div><b>${v.now.temp}°</b><span>${esc(w.label)}</span>`
        + `<small>${esc(v.place.name || t('Position actuelle'))}${v.place.region ? ' · ' + esc(v.place.region) : ''}</small></div>`
        + `<ul><li>${esc(t('Ressenti'))} <b>${v.now.feels}°</b></li><li>${esc(t('Vent'))} <b>${v.now.wind} km/h</b></li><li>${esc(t('Humidité'))} <b>${v.now.humidity} %</b></li></ul>`));
      const days = el('div', 'sp-days');
      v.days.forEach((d, i) => {
        const day = i === 0 ? t('Aujourd’hui') : new Date(d.date + 'T12:00').toLocaleDateString(locale, { weekday: 'short' });
        days.append(el('div', 'sp-day', `<span>${esc(day)}</span><span class="sp-emoji">${wmo(d.code).emoji}</span><b>${d.max}°</b><small>${d.min}°</small>${d.rain != null ? `<em>💧 ${d.rain} %</em>` : ''}`));
      });
      out.append(days);
      acts.append(button('i-refresh', t('Actualiser'), async () => { await getWeather(true).catch(e => toast(e.message, { error: true })); render('wx-refresh'); }, 'wx-refresh'));
    }
    acts.append(button('i-globe', t('Choisir une ville'), chooseCity, 'wx-city'));
    if (v.place && v.place.chosen) acts.append(button('i-link', t('Utiliser ma position'), async () => {
      await api.post('/api/weather/place', { place: null }); wx.v = null; await getWeather(true).catch(() => {}); render('wx-city');
    }, 'wx-pos'));
    out.append(acts);
  },
};

async function openWin(page) {
  try { await api.post('/api/open-settings', { page }); toast(t('Ouverture des Paramètres Windows…')); }
  catch (e) { toast(e.message, { error: true }); }
}

async function wifiAction(n) {
  if (n.connected) {
    const r = await dialog({ title: n.ssid, text: esc(t('Connecté à ce réseau.')), inline: true, buttons: [
      { label: t('Annuler'), value: null }, { label: t('Oublier'), value: 'forget', danger: true }, { label: t('Déconnecter'), value: 'off', primary: true },
    ] });
    if (r === 'off') await api.post('/api/wifi/disconnect').catch(e => toast(e.message, { error: true }));
    if (r === 'forget') await api.post('/api/wifi/forget', { ssid: n.ssid }).then(() => api.post('/api/wifi/disconnect')).catch(e => toast(e.message, { error: true }));
    if (r) render('w:' + n.ssid);
    return;
  }
  if (n.enterprise) return toast(t('Réseau d’entreprise : connexion depuis les Paramètres Windows'), { error: true });
  let password;
  if (n.secure && !n.known) {
    password = await openKeyboard({ title: t('Mot de passe de {ssid}', { ssid: n.ssid }), placeholder: t('8 caractères minimum'), submitLabel: t('Connecter'), mask: true });
    if (password == null) return;
  }
  toast(t('Connexion à {ssid}…', { ssid: n.ssid }));
  $$('.sp-row', panel).forEach(r => r.classList.toggle('busy', r.dataset.key === 'w:' + n.ssid));
  try {
    await api.post('/api/wifi/connect', { ssid: n.ssid, ...(password != null ? { password } : {}) });
    toast(t('Connecté à {ssid}', { ssid: n.ssid }), { notify: true });
    paintNetSoon();
  } catch (e) { toast(e.message, { error: true }); }
  render('w:' + n.ssid);
}

async function chooseCity() {
  const q = await openKeyboard({ title: t('Ville pour la météo'), placeholder: t('Nom de la ville'), submitLabel: t('Rechercher') });
  if (!q) return;
  let list;
  try { list = await api.get('/api/weather/search?q=' + encodeURIComponent(q)); } catch (e) { return toast(e.message, { error: true }); }
  if (!list.length) return toast(t('Aucune ville trouvée pour « {q} »', { q }), { error: true });
  const i = await dialog({ title: t('Choisir une ville'), buttons: [...list.map((c, i) => ({ label: c.region ? `${c.name} · ${c.region}` : c.name, value: i, primary: i === 0 })), { label: t('Annuler'), value: null }] });
  if (i == null) return;
  await api.post('/api/weather/place', { place: list[i] }).catch(e => toast(e.message, { error: true }));
  wx.v = null;
  await getWeather(true).catch(() => {});
  render('wx-city');
}

const paintNetSoon = () => setTimeout(() => window.dispatchEvent(new Event('kanemode-net')), 800);

export function openStatus(tab = view.tab) {
  if (view.layer && topLayer() === view.layer) return show(tab, { focusTab: true });
  if (topLayer()) closeLayer(topLayer());
  view.tab = tab;
  buildTabs();
  view.layer = openLayer({
    el: panel, name: 'status', scrim: true, focusKey: 'tab-' + tab,
    onOpen: () => render(),
    onClose: () => { clearInterval(view.timer); view.gen++; view.layer = null; $$('.status [data-status]').forEach(b => b.classList.remove('current')); },
    hints: () => [['a', t('Sélectionner')], [['lb', 'rb'], t('Onglet')], ['b', t('Fermer')]],
    button: k => {
      if (k === 'lb' || k === 'rb') {
        const i = TABS.findIndex(x => x[0] === view.tab), n = TABS[(i + (k === 'rb' ? 1 : TABS.length - 1)) % TABS.length][0];
        show(n, { focusTab: true });
        return true;
      }
      // Gauche / droite sur les onglets : l'onglet s'affiche tout de suite
      if ((k === 'left' || k === 'right') && focused && focused.classList.contains('sp-tab')) {
        const i = TABS.findIndex(x => 'tab-' + x[0] === focused.dataset.key), n = TABS[i + (k === 'right' ? 1 : -1)];
        if (n) show(n[0], { focusTab: true });
        return true;
      }
      return false;
    },
  });
  $$('.status [data-status]').forEach(b => b.classList.toggle('current', b.dataset.status === tab));
}

// Icônes de la barre : clic, toucher ; Haut en haut d'une page à la manette (nav.js, move)
for (const b of $$('.status [data-status]')) b.addEventListener('click', e => { e.stopPropagation(); openStatus(b.dataset.status); });
hooks.statusUp = () => openStatus(view.tab);
// Retour des Paramètres Windows (position autorisée, Wi-Fi changé) : l'onglet ouvert est relu
document.addEventListener('visibilitychange', () => { if (!document.hidden && view.layer && (view.tab === 'net' || view.tab === 'clock')) render(); });
paintBell();
