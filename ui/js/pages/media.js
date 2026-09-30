// Médias : captures d'écran et vidéos (Steam, Xbox Game Bar, Windows) + visionneuse plein écran.
import { t, locale } from '../i18n.js';
import { $, el, esc, icon, api, sfx, toast } from '../core.js';
import { definePage, nav, openLayer, topLayer, closeLayer, focusIn } from '../nav.js';
import { confirmDialog } from '../widgets.js';

const FILTERS = [['all', t('Tout')], ['image', t('Captures')], ['video', t('Vidéos')]];
const when = ms => new Date(ms).toLocaleString(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** Confirme puis envoie des captures à la corbeille ; renvoie les adresses réellement supprimées. */
async function removeShots(list) {
  if (!list.length) return [];
  const one = list.length === 1;
  const n = list.length;
  const ok = await confirmDialog(
    one ? t('Supprimer cette capture ?') : t('Supprimer {n} captures ?', { n }),
    one ? t('Elle est envoyée à la corbeille de Windows : vous pourrez la récupérer de là.') : t('Elles sont envoyées à la corbeille de Windows : vous pourrez les récupérer de là.'),
    t('Supprimer'), true);
  if (!ok) return [];
  try {
    const r = await api.post('/api/media/delete', { urls: list.map(m => m.url) });
    if (r.failed) toast(t('{n} capture(s) n’ont pas pu être supprimées', { n: r.failed }), { error: true });
    else toast(one ? t('Capture supprimée') : t('{n} captures supprimées', { n }));
    // Le serveur ne dit pas lesquelles : celles qui ont échoué se retrouvent à l'actualisation
    return r.failed === n ? [] : list.map(m => m.url);
  } catch (e) {
    toast(e.message, { error: true });
    return [];
  }
}

function viewer(list, start, onRemoved) {
  let i = start;
  const removed = [];
  const L = $('#viewer');
  const show = () => {
    const m = list[i];
    const stage = $('.viewer-stage', L);
    stage.innerHTML = m.kind === 'video' ? `<video src="${m.url}" controls autoplay></video>` : `<img src="${m.url}" alt="">`;
    $('.viewer-caption', L).textContent = `${m.game || m.source} · ${when(m.date)} · ${i + 1}/${list.length}`;
  };
  const remove = async () => {
    const gone = await removeShots([list[i]]);
    if (!gone.length) return;
    removed.push(...gone);
    list.splice(i, 1);
    if (!list.length) return closeLayer(topLayer());
    i = Math.min(i, list.length - 1);
    show();
  };
  const step = d => { const n = i + d; if (n < 0 || n >= list.length) return; i = n; sfx('move'); show(); };
  show();
  openLayer({
    el: L, name: 'viewer', noGlobal: true,
    onClose: () => {
      $('.viewer-stage', L).innerHTML = '';
      if (removed.length) onRemoved(removed, list[Math.min(i, list.length - 1)]);
    },
    button: k => {
      if (k === 'left' || k === 'lb') { step(-1); return true; }
      if (k === 'right' || k === 'rb') { step(1); return true; }
      if (k === 'y' || k === 'x') { remove(); return true; }
      if (k === 'up' || k === 'down') return true;
      return false;
    },
    hints: () => [[['lb', 'rb'], t('Précédente / suivante')], ['y', t('Supprimer')], ['b', t('Fermer')]],
  });
}

definePage('media', {
  title: () => t('Médias'),
  filter: 'all',
  selecting: false,
  sel: new Set(),
  render() {
    if (!this.items) {
      this.el.innerHTML = t('<div class="loading"><i class="spinner big"></i>Recherche des captures…</div>');
      api.get('/api/media').then(items => { this.items = items; if (this.el.classList.contains('active')) this.draw(); })
        .catch(() => { this.items = []; this.draw(); });
      return;
    }
    this.draw();
  },
  /** Retire des captures supprimées de la liste et de la sélection. */
  dropped(urls) {
    const gone = new Set(urls);
    this.items = this.items.filter(m => !gone.has(m.url));
    for (const u of gone) this.sel.delete(u);
  },
  /** Supprime la sélection, ou la capture sous le curseur si rien n'est sélectionné. */
  async removeSelected() {
    const focused = this.el.querySelector('.shot.focused');
    const list = this.sel.size ? this.items.filter(m => this.sel.has(m.url)) : focused && focused._m ? [focused._m] : [];
    if (!list.length) return;
    const gone = await removeShots(list);
    if (!gone.length) return;
    this.dropped(gone);
    if (!this.sel.size) this.selecting = false;
    this.draw();
  },
  toggleShot(m, shot) {
    if (this.sel.has(m.url)) this.sel.delete(m.url); else this.sel.add(m.url);
    if (!this.selecting) { this.selecting = true; return this.draw('m:' + m.url); }
    shot.classList.toggle('sel', this.sel.has(m.url));
    this.refreshBar();
  },
  /** Met à jour les boutons de la barre de sélection sans redessiner la page. */
  refreshBar() {
    const del = this.el.querySelector('[data-key="del"]'), all = this.el.querySelector('[data-key="all"]');
    const shown = this.items.filter(m => this.filter === 'all' || m.kind === this.filter);
    if (del) { del.innerHTML = t('{a}Supprimer ({n})', { a: icon('i-trash'), n: this.sel.size }); del.classList.toggle('disabled', !this.sel.size); }
    if (all) all.textContent = shown.length && shown.every(m => this.sel.has(m.url)) ? t('Tout désélectionner') : t('Tout sélectionner');
  },
  button(k) {
    const shot = this.el.querySelector('.shot.focused');
    if (k === 'y' && (shot || this.sel.size)) { this.removeSelected(); return true; }
    if (k === 'x' && shot) { this.toggleShot(shot._m, shot); return true; }
    return false;
  },
  draw(focusKey) {
    const root = this.el;
    // Des captures supprimées ailleurs ne doivent pas rester sélectionnées
    const known = new Set(this.items.map(m => m.url));
    for (const u of [...this.sel]) if (!known.has(u)) this.sel.delete(u);
    const items = this.items.filter(m => this.filter === 'all' || m.kind === this.filter);
    const bar = el('div', 'toolbar');
    for (const [id, label] of FILTERS) {
      const n = id === 'all' ? this.items.length : this.items.filter(m => m.kind === id).length;
      bar.append(nav(el('div', 'tab' + (this.filter === id ? ' active' : ''), `${label}<span class="count">${n}</span>`), () => { this.filter = id; this.draw('f:' + id); }, 'f:' + id));
    }
    bar.append(el('span', 'spacer'));
    if (this.selecting) {
      const all = items.length > 0 && items.every(m => this.sel.has(m.url));
      bar.append(
        nav(el('div', 'chip-btn', all ? t('Tout désélectionner') : t('Tout sélectionner')), () => {
          const every = items.every(m => this.sel.has(m.url));
          for (const m of items) { if (every) this.sel.delete(m.url); else this.sel.add(m.url); }
          grid.querySelectorAll('.shot').forEach(x => x.classList.toggle('sel', this.sel.has(x._m.url)));
          this.refreshBar();
        }, 'all'),
        nav(el('div', 'chip-btn danger' + (this.sel.size ? '' : ' disabled'), t('{a}Supprimer ({n})', { a: icon('i-trash'), n: this.sel.size })), () => this.removeSelected(), 'del'),
        nav(el('div', 'chip-btn', t('Terminer')), () => { this.selecting = false; this.sel.clear(); this.draw('select'); }, 'select'));
    } else {
      bar.append(nav(el('div', 'chip-btn', t('{a}Sélectionner', { a: icon('i-check') })), () => { this.selecting = true; this.draw('select'); }, 'select'));
    }
    bar.append(nav(el('div', 'chip-btn', t('{a}Actualiser', { a: icon('i-refresh') })), () => { this.items = null; this.sel.clear(); this.render(); }, 'refresh'));
    const grid = el('div', 'media-grid');
    items.forEach((m, idx) => {
      const media = m.kind === 'video' ? `<video src="${m.url}#t=1" preload="metadata" muted></video><div class="play">${icon('i-play')}</div>` : `<img src="${m.url}" alt="" loading="lazy">`;
      const shot = el('div', 'shot' + (this.sel.has(m.url) ? ' sel' : ''), `${media}<small>${esc(m.game || m.source)} · ${when(m.date)}</small>${this.selecting ? `<i class="check">${icon('i-check')}</i>` : ''}`);
      shot._m = m;
      grid.append(nav(shot, () => {
        if (this.selecting) return this.toggleShot(m, shot);
        viewer(items, idx, (urls, next) => { this.dropped(urls); this.draw(next && 'm:' + next.url); });
      }, 'm:' + m.url));
    });
    root.replaceChildren(el('div', 'page-head', t('<h1>Médias</h1><p>Vos captures d’écran et vidéos de jeu, rassemblées depuis Steam (F12), la Xbox Game Bar (Win + Alt + Impr. écran) et les captures Windows.</p>')), bar);
    if (items.length) root.append(grid);
    else root.append(el('div', 'notice', t('Aucune capture trouvée pour l’instant. Prenez une capture en jeu avec <b>F12</b> (Steam) ou <b>Win + Alt + Impr. écran</b> (Xbox Game Bar), elle apparaîtra ici.')));
    if (!topLayer()) focusIn(root, focusKey);
  },
  hints() {
    return [['a', this.selecting ? t('Sélectionner') : t('Afficher')], ['x', t('Sélectionner')], ['y', t('Supprimer')], ['b', t('Retour')]];
  },
});
