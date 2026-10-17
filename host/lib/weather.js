// Météo du panneau Heure (barre d'état) : Open-Meteo, gratuit et sans clé. Le lieu vient d'une ville
// choisie dans KaneMode, sinon de la position de Windows (si elle est autorisée). Aucune adresse IP
// n'est envoyée à un service de géolocalisation.
'use strict';
const { execFile } = require('child_process');

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'KaneMode' } });
  if (!r.ok) throw new Error(`Météo indisponible (${r.status})`);
  return r.json();
}

/** Position de Windows (services de localisation), null si refusée ou indisponible. */
function windowsPosition() {
  const script = `Add-Type -AssemblyName System.Device
$w = New-Object System.Device.Location.GeoCoordinateWatcher
$null = $w.TryStart($false, [TimeSpan]::FromSeconds(6))
$end = (Get-Date).AddSeconds(8)
while ($w.Status -ne 'Ready' -and $w.Permission -ne 'Denied' -and (Get-Date) -lt $end) { Start-Sleep -Milliseconds 200 }
$c = $w.Position.Location
if ($w.Permission -ne 'Denied' -and -not $c.IsUnknown) { '{0};{1}' -f $c.Latitude.ToString([Globalization.CultureInfo]::InvariantCulture), $c.Longitude.ToString([Globalization.CultureInfo]::InvariantCulture) }`;
  return new Promise(resolve => execFile('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, timeout: 15000 }, (err, out) => {
    const m = /(-?\d+(?:\.\d+)?);(-?\d+(?:\.\d+)?)/.exec(String(out || ''));
    resolve(m ? { lat: +(+m[1]).toFixed(3), lon: +(+m[2]).toFixed(3) } : null);
  }));
}

/** Recherche de villes (nom tapé dans le panneau). */
async function search(name, lang = 'fr') {
  const q = String(name || '').trim().slice(0, 80);
  if (q.length < 2) return [];
  const d = await getJson(`${GEOCODE}?name=${encodeURIComponent(q)}&count=6&language=${encodeURIComponent(lang)}&format=json`);
  return (d.results || []).map(r => ({
    name: r.name, region: [r.admin1, r.country].filter(Boolean).join(', '),
    lat: +r.latitude.toFixed(3), lon: +r.longitude.toFixed(3),
  }));
}

function create({ read, write }) {
  let cache = null, pos = null;
  async function place() {
    const c = read().weather || {};
    if (c.place && Number.isFinite(c.place.lat)) return { ...c.place, chosen: true };
    // Position de Windows relue au plus toutes les 6 h
    if (!pos || Date.now() - pos.t > 6 * 3600e3) pos = { t: Date.now(), v: await windowsPosition() };
    return pos.v ? { name: null, ...pos.v, chosen: false } : null;
  }
  async function get(force = false) {
    const p = await place();
    if (!p) return { place: null };
    const k = `${p.lat},${p.lon}`;
    if (!force && cache && cache.k === k && Date.now() - cache.t < 20 * 60e3) return cache.v;
    const d = await getJson(`${FORECAST}?latitude=${p.lat}&longitude=${p.lon}&timezone=auto&forecast_days=5`
      + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset');
    const cur = d.current || {}, day = d.daily || {};
    const v = {
      place: { name: p.name, region: p.region || null, chosen: p.chosen },
      now: { temp: Math.round(cur.temperature_2m), feels: Math.round(cur.apparent_temperature), humidity: cur.relative_humidity_2m, wind: Math.round(cur.wind_speed_10m), code: cur.weather_code, day: cur.is_day === 1 },
      days: (day.time || []).map((date, i) => ({
        date, code: day.weather_code[i], max: Math.round(day.temperature_2m_max[i]), min: Math.round(day.temperature_2m_min[i]),
        rain: day.precipitation_probability_max ? day.precipitation_probability_max[i] : null, sunrise: day.sunrise[i], sunset: day.sunset[i],
      })),
      at: new Date().toISOString(),
    };
    cache = { k, t: Date.now(), v };
    return v;
  }
  function setPlace(p) {
    const c = read();
    c.weather = { ...(c.weather || {}) };
    if (p) c.weather.place = { name: String(p.name).slice(0, 80), region: String(p.region || '').slice(0, 120), lat: +p.lat, lon: +p.lon };
    else delete c.weather.place; // retour à la position de Windows
    write(c);
    cache = null;
  }
  return { get, setPlace, search };
}

module.exports = { create, search };
