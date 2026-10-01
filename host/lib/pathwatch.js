'use strict';
const fs = require('node:fs'), path = require('node:path');

// Un dossier créé après KaneMode reste détectable : suivre son premier parent existant,
// puis descendre au fil de la création des sous-dossiers. Aucun parcours récursif du disque.
function createPathWatch(target, onChange) {
  target = path.resolve(target);
  let watched = '', watcher = null, next = '', closed = false;
  function refresh() {
    if (closed) return;
    let dir = target;
    while (true) {
      try { if (fs.statSync(dir).isDirectory()) break; } catch { /* pas encore créé */ }
      const parent = path.dirname(dir);
      if (parent === dir) { dir = ''; break; }
      dir = parent;
    }
    if (dir === watched && watcher) return;
    const previous = watched;
    watcher?.close(); watcher = null; watched = ''; next = '';
    if (!dir) return;
    next = dir === target ? '' : path.relative(dir, target).split(path.sep)[0].toLowerCase();
    try {
      const current = fs.watch(dir, (event, filename) => {
        if (closed || watcher !== current) return;
        const name = String(filename || '');
        if (next && name && name.toLowerCase() !== next) return;
        const wasTarget = watched === target;
        refresh();
        if (!wasTarget || !name || /\.item$/i.test(name)) onChange();
      });
      watcher = current; watched = dir;
      current.on('error', () => { if (watcher === current) { current.close(); watcher = null; watched = ''; } });
      if (previous && previous !== dir) onChange();
    } catch { /* nouvel essai au prochain contrôle */ }
  }
  refresh();
  return { refresh, close() { closed = true; watcher?.close(); watcher = null; } };
}
module.exports = { createPathWatch };
