// Composants réutilisables : clavier virtuel, dialogues, sélecteurs, interrupteurs.
import { t } from './i18n.js';
import { $, el, esc, icon, sfx } from './core.js';
import { nav, openLayer, closeLayer, focusIn } from './nav.js';

// ---------- Clavier virtuel (AZERTY) ----------
const LAYOUTS = {
  abc: ['1234567890', 'azertyuiop', 'qsdfghjklm', "wxcvbn,.'-"],
  sym: ['1234567890', '@#&_/:;?!=', '()[]{}%*+"', '<>|\\~^$€£§'],
  acc: [t('éèêëàâäîïô'), t('öùûüçœæÿ«»'), t('ÉÈÊÀÂÇÎÔÙÛ'), '’…–—·°²³µ¤'],
};

export function keyboard({ onChar, onBackspace, onSubmit, submitLabel = 'OK' }) {
  const root = el('div', 'kb');
  let layout = 'abc', shift = false;
  const key = (label, fn, k, cls = '') => {
    const b = el('div', 'key ' + cls, label);
    b.dataset.sfx = 'key';
    nav(b, () => { fn(); b.classList.add('pressed'); setTimeout(() => b.classList.remove('pressed'), 90); }, k);
    return b;
  };
  const render = keep => {
    root.innerHTML = '';
    LAYOUTS[layout].forEach((row, ri) => {
      const r = el('div', 'kb-row');
      [...row].forEach((ch, ci) => {
        const c = shift ? ch.toUpperCase() : ch;
        r.append(key(esc(c), () => { onChar(c); if (shift) { shift = false; render(`k${ri}-${ci}`); } }, `k${ri}-${ci}`));
      });
      root.append(r);
    });
    const last = el('div', 'kb-row');
    last.append(
      key(icon('i-shift'), () => { shift = !shift; render('shift'); }, 'shift', 'mod w2' + (shift ? ' on' : '')),
      key(layout === 'sym' ? 'abc' : '&amp;123', () => { layout = layout === 'sym' ? 'abc' : 'sym'; render('sym'); }, 'sym', 'mod w2'),
      key(layout === 'acc' ? 'abc' : t('àé'), () => { layout = layout === 'acc' ? 'abc' : 'acc'; render('acc'); }, 'acc', 'mod'),
      key('espace', () => onChar(' '), 'space', 'mod w5'),
      key(icon('i-backspace'), onBackspace, 'bksp', 'mod w2'),
      key(esc(submitLabel), onSubmit, 'ok', 'ok w2'),
    );
    root.append(last);
    if (keep) focusIn(root, keep, { scroll: false });
  };
  render();
  return root;
}

/** Champ de texte affiché (valeur + curseur clignotant). */
export function textField(placeholder, iconId = 'i-edit') {
  const f = el('div', 'search-field');
  f.paint = v => {
    f.innerHTML = `${icon(iconId)}<span class="value">${v ? esc(v) : `<span class="placeholder">${esc(placeholder)}</span>`}<i class="caret"></i></span>`;
  };
  return f;
}

/** Gestion de la saisie au clavier physique pour un champ. */
export function typingHandler(get, set, submit) {
  let typed = false;
  return e => {
    if (e.key.length === 1) { set(get() + e.key); typed = true; sfx('key'); return true; }
    if (e.key === 'Backspace') { set(get().slice(0, -1)); typed = true; return true; }
    if (e.key === 'Enter' && typed && submit) { submit(); return true; }
    if (e.key.startsWith('Arrow')) typed = false;
    return false;
  };
}

/** Clavier virtuel en feuille modale. Renvoie le texte saisi, ou null si annulé. */
export function openKeyboard({ title, value = '', placeholder = '', submitLabel = 'OK' }) {
  return new Promise(resolve => {
    const host = $('#osk');
    let v = value;
    const field = textField(placeholder);
    const set = nv => { v = nv; field.paint(v); };
    let layer;
    const done = () => closeLayer(layer, v);
    const kb = keyboard({ onChar: c => set(v + c), onBackspace: () => set(v.slice(0, -1)), onSubmit: done, submitLabel });
    const sheet = el('div', 'osk-sheet');
    sheet.append(el('div', 'osk-title', esc(title)), field, kb);
    host.replaceChildren(sheet);
    set(v);
    layer = openLayer({
      el: host, name: 'osk', noGlobal: true, focusKey: 'k1-0',
      onClose: r => resolve(r === undefined ? null : r),
      hints: () => [['x', t('Effacer')], ['y', t('Espace')], ['view', t('Valider')], ['a', t('Saisir')], ['b', t('Annuler')]],
      button: k => {
        if (k === 'x') { set(v.slice(0, -1)); sfx('key'); return true; }
        if (k === 'y') { set(v + ' '); sfx('key'); return true; }
        if (k === 'view') { done(); return true; }
        return false;
      },
      typing: typingHandler(() => v, set, done),
      onPaste: text => set(v + text),
    });
  });
}

// ---------- Dialogues ----------
/** buttons : [{ label, value, icon, primary, danger }]. Renvoie la valeur choisie ou null. */
export function dialog({ title, text = '', buttons, inline = false }) {
  return new Promise(resolve => {
    const box = $('#dialog .dialog-box');
    box.innerHTML = `<h2>${esc(title)}</h2>${text ? `<p>${text}</p>` : ''}`;
    const actions = el('div', 'dialog-actions' + (inline ? ' inline' : ''));
    let layer;
    buttons.forEach((b, i) => {
      const btn = el('div', 'dbtn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : ''), `${b.icon ? icon(b.icon) : ''}<span>${esc(b.label)}</span>`);
      nav(btn, () => closeLayer(layer, b.value), 'b' + i);
      actions.append(btn);
    });
    box.append(actions);
    const primary = buttons.findIndex(b => b.primary);
    layer = openLayer({
      el: $('#dialog'), name: 'dialog', focusKey: 'b' + Math.max(0, primary),
      onClose: r => resolve(r === undefined ? null : r),
      hints: () => [['a', t('Valider')], ['b', t('Annuler')]],
    });
  });
}
export async function confirmDialog(title, text, okLabel = t('Confirmer'), danger = false) {
  const r = await dialog({
    title, text, inline: true,
    buttons: [{ label: t('Annuler'), value: false }, { label: okLabel, value: true, primary: !danger, danger }],
  });
  return r === true;
}

// ---------- Sélecteur segmenté ----------
export function segmented(options, current, onChange, keyPrefix) {
  const s = el('div', 'segmented');
  for (const o of options) {
    const b = el('button', String(o.value) === String(current) ? 'active' : '', esc(o.label));
    nav(b, () => {
      s.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === b));
      onChange(o.value);
    }, `${keyPrefix}-${o.value}`);
    s.append(b);
  }
  return s;
}

// ---------- Ligne de réglage avec interrupteur ----------
export function switchRow({ lead = '', title, desc = '', on, onToggle, key }) {
  const r = el('div', 'set-row nav', `${lead}<div class="txt"><b>${esc(title)}</b>${desc ? `<small>${desc}</small>` : ''}</div><div class="switch${on ? ' on' : ''}"></div>`);
  if (!lead) r.style.gridTemplateColumns = '1fr auto';
  nav(r, () => {
    const sw = r.querySelector('.switch');
    sw.classList.toggle('on');
    onToggle(sw.classList.contains('on'));
  }, key);
  return r;
}
