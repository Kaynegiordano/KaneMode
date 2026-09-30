// Jaquette du streaming local (moteur KanePlay intégré), dessinée ici plutôt qu'en image : elle
// reprend la couleur d'accent de KaneMode et son titre est dans la langue de l'interface. Portrait
// (bibliothèque, accueil) et bandeau (fonds, cartes larges).
import { t } from './i18n.js';

const BRAND = '#6a5cff'; // violet du logo KaneMode (dégradé de l'accent vers lui)
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const FONT = "'Segoe UI Variable Display','Segoe UI','Yu Gothic UI','Microsoft YaHei UI',sans-serif";

/** Largeur approximative d'un texte (en em) : les idéogrammes sont deux fois plus larges. */
const width = s => [...s].reduce((w, c) => w + (/[　-鿿＀-￯]/.test(c) ? 1 : c === ' ' ? 0.28 : 0.56), 0);
const fit = (s, room, max) => Math.min(max, Math.floor(room / Math.max(1, width(s))));

// Icône : écran d'où part un signal vers la manette (PC → console), dans un carré arrondi aux couleurs
function mark(x, y, size, accent) {
  const k = size / 100;
  return `<g transform="translate(${x} ${y}) scale(${k})">
    <rect width="100" height="100" rx="24" fill="url(#g-brand)"/>
    <rect x="16" y="18" width="46" height="31" rx="4" fill="none" stroke="#fff" stroke-width="5"/>
    <path d="M31 57h16M39 49v8" stroke="#fff" stroke-width="5" stroke-linecap="round"/>
    <path d="M67 30a12 12 0 0 1 0 16M73 23a22 22 0 0 1 0 30" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".9"/>
    <path d="M52 66h22a10 10 0 0 1 10 10v2a6 6 0 0 1-10 4l-3-3H61l-3 3a6 6 0 0 1-10-4v-2a10 10 0 0 1 4-10z" fill="#fff"/>
  </g>`;
}

function svg(w, h, body, accent) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="g-brand" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${accent}"/><stop offset="1" stop-color="${BRAND}"/></linearGradient>
    <linearGradient id="g-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c1224"/><stop offset="1" stop-color="#05070f"/></linearGradient>
    <linearGradient id="g-wave" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${accent}" stop-opacity="0"/><stop offset=".5" stop-color="${accent}"/><stop offset="1" stop-color="${BRAND}" stop-opacity="0"/></linearGradient>
    <radialGradient id="g-glow1"><stop offset="0" stop-color="${accent}" stop-opacity=".55"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient>
    <radialGradient id="g-glow2"><stop offset="0" stop-color="${BRAND}" stop-opacity=".5"/><stop offset="1" stop-color="${BRAND}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#g-bg)"/>
  ${body}
</svg>`;
}

// Ondes lumineuses, comme un signal qui traverse l'image
function waves(w, h, y0, amp) {
  let out = '';
  for (let i = 0; i < 7; i++) {
    const y = y0 + i * amp * 0.22, a = amp * (0.6 + i * 0.08);
    out += `<path d="M${-w * 0.1} ${y} C ${w * 0.25} ${y - a}, ${w * 0.5} ${y + a}, ${w * 1.1} ${y - a * 0.4}" fill="none" stroke="url(#g-wave)" stroke-width="${1.2 + i * 0.25}" opacity="${0.55 - i * 0.06}"/>`;
  }
  return out;
}

const uri = s => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);

/** Jaquettes du streaming local : { portrait, hero, header } (adresses data:). */
export function streamingArt(accent = '#1a9fff') {
  const title = t('Streaming local'), sub = t('Jeux de vos PC').toUpperCase();
  const pw = 600, ph = 900;
  const ts = fit(title, 520, 76), ss = fit(sub, 1100, 22);
  const portrait = svg(pw, ph, `
    <circle cx="140" cy="220" r="360" fill="url(#g-glow1)"/>
    <circle cx="520" cy="640" r="380" fill="url(#g-glow2)"/>
    ${waves(pw, ph, 520, 150)}
    ${mark(150, 150, 300, accent)}
    <text x="300" y="640" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${ts}" fill="#fff" letter-spacing="-1">${esc(title)}</text>
    <text x="300" y="${640 + ts * 0.3 + 44}" text-anchor="middle" font-family="${FONT}" font-weight="400" font-size="${ss}" fill="#fff" fill-opacity=".78" letter-spacing="${/[　-鿿]/.test(sub) ? 2 : 5}">${esc(sub)}</text>
    <text x="300" y="840" text-anchor="middle" font-family="${FONT}" font-weight="600" font-size="22" fill="${accent}" letter-spacing="3">KANEMODE</text>`, accent);
  const hw = 1920, hh = 620;
  const hts = fit(title, 900, 96);
  const hero = svg(hw, hh, `
    <circle cx="420" cy="180" r="620" fill="url(#g-glow1)"/>
    <circle cx="1600" cy="520" r="640" fill="url(#g-glow2)"/>
    ${waves(hw, hh, 330, 190)}
    ${mark(250, 170, 280, accent)}
    <text x="600" y="330" font-family="${FONT}" font-weight="700" font-size="${hts}" fill="#fff" letter-spacing="-1.5">${esc(title)}</text>
    <text x="604" y="${330 + 58}" font-family="${FONT}" font-weight="400" font-size="28" fill="#fff" fill-opacity=".78" letter-spacing="6">${esc(sub)}</text>`, accent);
  return { portrait: uri(portrait), hero: uri(hero), header: uri(hero) };
}
