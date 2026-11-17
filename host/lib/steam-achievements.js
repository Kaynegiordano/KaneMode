// Succès Steam d'un jeu, lus dans le cache que Steam garde sur le PC (sans clé d'accès ni profil
// public) : appcache/stats/UserGameStatsSchema_<jeu>.bin (liste, noms et descriptions traduits,
// icônes) et UserGameStats_<compte>_<jeu>.bin (succès débloqués et leur date). Fichiers au format
// « KeyValues » binaire de Steam.
'use strict';
const fs = require('fs');
const path = require('path');

const ICONS = 'https://cdn.cloudflare.steamstatic.com/steamcommunity/public/images/apps/';
// Langues de Steam pour les langues de KaneMode
const STEAM_LANG = { fr: 'french', en: 'english' };

/** KeyValues binaire : 0 section, 1 texte, 2 entier, 3 réel, 6 couleur, 7 / 10 entier 64 bits, 8 fin. */
function parseKv(buf) {
  let i = 0;
  const str = () => { const e = buf.indexOf(0, i); if (e < 0) throw new Error('fin de texte manquante'); const s = buf.toString('utf8', i, e); i = e + 1; return s; };
  const map = () => {
    const o = {};
    while (i < buf.length) {
      const type = buf[i++];
      if (type === 0x08) return o;
      const key = str();
      if (type === 0x00) o[key] = map();
      else if (type === 0x01) o[key] = str();
      else if (type === 0x02) { o[key] = buf.readInt32LE(i); i += 4; }
      else if (type === 0x03) { o[key] = buf.readFloatLE(i); i += 4; }
      else if (type === 0x06) { o[key] = buf.readUInt32LE(i); i += 4; }
      else if (type === 0x07 || type === 0x0A) { o[key] = Number(buf.readBigUInt64LE(i)); i += 8; }
      else throw new Error(`type ${type} inconnu`);
    }
    return o;
  };
  return map();
}

const text = (o, lang) => (o && typeof o === 'object' ? o[STEAM_LANG[lang] || 'english'] || o.english || '' : String(o || ''));

/** Fichier des succès débloqués d'un jeu : celui du compte donné, sinon le plus récent (dernier compte qui y a joué). */
function userFile(dir, appid, account) {
  if (account) return path.join(dir, `UserGameStats_${account}_${appid}.bin`);
  const re = new RegExp(`^UserGameStats_\\d+_${appid}\\.bin$`);
  let best = null, bestTime = -1;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!re.test(f)) continue;
      const t = fs.statSync(path.join(dir, f)).mtimeMs;
      if (t > bestTime) { best = path.join(dir, f); bestTime = t; }
    }
  } catch { /* pas de cache */ }
  return best;
}

/**
 * Succès d'un jeu. steamRoot : dossier de Steam ; lang : langue de KaneMode ; account : identifiant du
 * compte (sinon le dernier qui a joué). Rend null si Steam ne connaît pas de succès pour ce jeu.
 * Débloqués d'abord (les plus récents en tête), puis les autres ; un succès caché pas encore débloqué
 * garde son secret.
 */
function read(steamRoot, appid, lang = 'fr', account = null) {
  const dir = path.join(steamRoot, 'appcache', 'stats');
  let schema;
  try { schema = parseKv(fs.readFileSync(path.join(dir, `UserGameStatsSchema_${appid}.bin`))); } catch { return null; }
  const game = schema[String(appid)] || Object.values(schema)[0];
  const stats = (game && game.stats) || {};
  let user = {};
  const own = userFile(dir, appid, account);
  try { if (own) user = (parseKv(fs.readFileSync(own)).cache) || {}; } catch { /* jamais joué sur ce compte */ }
  const list = [];
  for (const [statId, stat] of Object.entries(stats)) {
    if (!stat || !stat.bits || typeof stat.bits !== 'object') continue;
    const mine = user[statId] || {};
    const bitsOn = (Number(mine.data) || 0) >>> 0;
    const times = mine.AchievementTimes || {};
    for (const [bit, a] of Object.entries(stat.bits)) {
      if (!a || !a.display) continue;
      const unlocked = ((bitsOn >>> Number(bit)) & 1) === 1;
      const hidden = !unlocked && Number(a.display.hidden) === 1;
      const icon = unlocked ? a.display.icon : a.display.icon_gray || a.display.icon;
      list.push({
        id: a.name || `${statId}.${bit}`,
        name: hidden ? null : text(a.display.name, lang),
        desc: hidden ? null : text(a.display.desc, lang),
        icon: icon ? ICONS + appid + '/' + icon : null,
        unlocked,
        hidden,
        at: unlocked && times[bit] ? new Date(times[bit] * 1000).toISOString() : null,
      });
    }
  }
  if (!list.length) return null;
  list.sort((a, b) => (a.unlocked !== b.unlocked ? (a.unlocked ? -1 : 1) : a.unlocked ? String(b.at || '').localeCompare(String(a.at || '')) : a.hidden - b.hidden));
  return { total: list.length, unlocked: list.filter(a => a.unlocked).length, list };
}

module.exports = { read, parseKv };
