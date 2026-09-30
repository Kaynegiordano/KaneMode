// Médias : captures d'écran et vidéos (Steam, Xbox Game Bar, Windows) + visionneuse plein écran.
import { t, locale } from '../i18n.js';
import { $, el, esc, icon, api, sfx } from '../core.js';
import { definePage, nav, openLayer, topLayer, focusIn } from '../nav.js';

const FILTERS = [['all', t('Tout')], ['image', t('Captures')], ['video', t('Vidéos')]];
const when = ms => new Date(ms).toLocaleString(locale, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function viewer(list, start) {
  let i = start;
  const L = $('#viewer');
  const show = () => {
    const m = list[i];
    const stage = $('.viewer-stage', L);
    stage.innerHTML = m.kind === 'video' ? `<video src="${m.url}" controls autoplay></video>` : `<img src="${m.url}" alt="">`;
    $('.viewer-caption', L).textContent = `${m.game || m.source} · ${when(m.date)} · ${i + 1}/${list.length}`;
  };
  const step = d => { const n = i + d; if (n < 0 || n >= list.length) return; i = n; sfx('move'); show(); };
  show();
  openLayer({
    el: L, name: 'viewer', noGlobal: true,
    onClose: () => { $('.viewer-stage', L).innerHTML = ''; },
    button: k => {
      if (k === 'left' || k === 'lb') { step(-1); return true; }
      if (k === 'right' || k === 'rb') { step(1); return true; }
      if (k === 'up' || k === 'down') return true;
      return false;
    },
    hints: () => [[['lb', 'rb'], t('Précédente / suivante')], ['b', t('Fermer')]],
  });
}

definePage('media', {
  title: () => t('Médias'),
  filter: 'all',
  render() {
    if (!this.items) {
      this.el.innerHTML = t('<div class="loading"><i class="spinner big"></i>Recherche des captures…</div>');
      api.get('/api/media').then(items => { this.items = items; if (this.el.classList.contains('active')) this.draw(); })
        .catch(() => { this.items = []; this.draw(); });
      return;
    }
    this.draw();
  },
  draw(focusKey) {
    const root = this.el;
    const items = this.items.filter(m => this.filter === 'all' || m.kind === this.filter);
    const bar = el('div', 'toolbar');
    for (const [id, label] of FILTERS) {
      const n = id === 'all' ? this.items.length : this.items.filter(m => m.kind === id).length;
      bar.append(nav(el('div', 'tab' + (this.filter === id ? ' active' : ''), `${label}<span class="count">${n}</span>`), () => { this.filter = id; this.draw('f:' + id); }, 'f:' + id));
    }
    bar.append(el('span', 'spacer'), nav(el('div', 'chip-btn', t('{a}Actualiser', { a: icon('i-refresh') })), () => { this.items = null; this.render(); }, 'refresh'));
    const grid = el('div', 'media-grid');
    items.forEach((m, idx) => {
      const media = m.kind === 'video' ? `<video src="${m.url}#t=1" preload="metadata" muted></video><div class="play">${icon('i-play')}</div>` : `<img src="${m.url}" alt="" loading="lazy">`;
      const shot = el('div', 'shot', `${media}<small>${esc(m.game || m.source)} · ${when(m.date)}</small>`);
      grid.append(nav(shot, () => viewer(items, idx), 'm:' + m.url));
    });
    root.replaceChildren(el('div', 'page-head', t('<h1>Médias</h1><p>Vos captures d’écran et vidéos de jeu, rassemblées depuis Steam (F12), la Xbox Game Bar (Win + Alt + Impr. écran) et les captures Windows.</p>')), bar);
    if (items.length) root.append(grid);
    else root.append(el('div', 'notice', t('Aucune capture trouvée pour l’instant. Prenez une capture en jeu avec <b>F12</b> (Steam) ou <b>Win + Alt + Impr. écran</b> (Xbox Game Bar), elle apparaîtra ici.')));
    if (!topLayer()) focusIn(root, focusKey);
  },
  hints: () => [['a', t('Afficher')], ['b', t('Retour')]],
});
