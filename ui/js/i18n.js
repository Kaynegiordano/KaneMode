// Langues de l'interface. Le texte source est le français, écrit tel quel dans le code et passé par
// t() ; chaque autre langue a son dictionnaire (ui/i18n/<langue>.json : texte français → traduction),
// préparé par tools/i18n.js. Un texte absent du dictionnaire reste en français.
//   t('Paramètres')                          texte simple
//   t('Pilote {v} installé', { v })          parties variables entre accolades
//   tn(n, '{n} jeu', '{n} jeux')             singulier ou pluriel, selon les règles de la langue
//   tx(message)                              message venu de l'hôte (erreurs, notes) : reconnu tel
//                                            quel ou d'après un modèle à parties variables
// La langue est choisie dans Paramètres → Apparence (settings.lang), sinon celle de Windows.

export const LANGS = [
  ['fr', 'Français'], ['en', 'English'], ['es', 'Español'], ['de', 'Deutsch'], ['it', 'Italiano'],
  ['pt', 'Português (Brasil)'], ['ja', '日本語'], ['zh', '简体中文'],
];
const SUPPORTED = LANGS.map(l => l[0]);
// Formats des dates, heures et nombres de chaque langue
const LOCALES = { fr: 'fr-FR', en: 'en-US', es: 'es-ES', de: 'de-DE', it: 'it-IT', pt: 'pt-BR', ja: 'ja-JP', zh: 'zh-CN' };

/** Langue de Windows si elle est proposée, sinon l'anglais. */
export function systemLang() {
  for (const l of navigator.languages || [navigator.language]) {
    const p = String(l || '').toLowerCase().split('-')[0];
    if (SUPPORTED.includes(p)) return p;
  }
  return 'en';
}
function chosen() {
  // Interface de KaneMode : son réglage ; widgets Game Bar (autre stockage) : la langue que KaneMode
  // leur a transmise (km.lang, voir widget.js)
  try { const s = JSON.parse(localStorage.getItem('km.settings') || '{}'); if (SUPPORTED.includes(s.lang)) return s.lang; } catch { /* stockage indisponible */ }
  try { const w = localStorage.getItem('km.lang'); if (SUPPORTED.includes(w)) return w; } catch { /* idem */ }
  return systemLang();
}

export const lang = chosen();
export const locale = LOCALES[lang];
document.documentElement.lang = lang;

const dict = lang === 'fr' ? {} : await fetch(new URL(`../i18n/${lang}.json`, import.meta.url)).then(r => (r.ok ? r.json() : {})).catch(() => ({}));

const fill = (s, vars) => (vars ? String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s);

/** Texte traduit (voir en tête). */
export function t(s, vars) {
  const r = dict[s];
  return fill(r != null && r !== '' ? r : s, vars);
}

const plural = new Intl.PluralRules(locale);
/** Singulier ou pluriel selon `n` et les règles de la langue ; `{n}` est remplacé par le nombre. */
export function tn(n, one, other, vars) {
  return t(plural.select(n) === 'one' ? one : other, { n: Number(n).toLocaleString(locale), ...vars });
}

// Messages de l'hôte avec des parties variables : modèles « {a} » du dictionnaire, en expressions
let patterns = null;
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function compile() {
  patterns = [];
  for (const k of Object.keys(dict)) {
    if (!/\{\w+\}/.test(k)) continue;
    const names = [];
    const src = escRe(k).replace(/\\\{(\w+)\\\}/g, (m, name) => { names.push(name); return '([\\s\\S]*?)'; });
    patterns.push({ re: new RegExp('^' + src + '$'), k, names });
  }
}
/** Message venu de l'hôte (français) : traduit s'il est connu, tel quel sinon. */
export function tx(msg) {
  if (msg == null || lang === 'fr') return msg;
  const s = String(msg);
  if (dict[s]) return dict[s];
  if (!patterns) compile();
  for (const p of patterns) {
    const m = p.re.exec(s);
    if (!m) continue;
    const vars = {};
    p.names.forEach((name, i) => { vars[name] = tx(m[i + 1]); });
    return t(p.k, vars);
  }
  return s;
}

/** Textes écrits dans une page HTML (index.html) et quelques attributs : traduits sur place. */
export function translateDom(root) {
  if (lang === 'fr') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const s = n.nodeValue.trim();
    if (!s || !dict[s]) continue;
    n.nodeValue = n.nodeValue.replace(s, dict[s]);
  }
  for (const e of root.querySelectorAll('[title], [placeholder], [aria-label]')) {
    for (const a of ['title', 'placeholder', 'aria-label']) {
      const v = e.getAttribute(a);
      if (v && dict[v]) e.setAttribute(a, dict[v]);
    }
  }
}
