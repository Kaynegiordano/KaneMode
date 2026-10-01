// Les réglages de personnalisation et leurs aperçus, accessibles à la manette.
import { t } from './i18n.js';
import { $, el, esc, icon, settings, saveSettings, effectiveSettings, setAppearance, displayState, applyTheme, previewSounds, stopSoundPreview, api, lib, favs, toast } from './core.js';
import { nav, openLayer, closeLayer, refresh } from './nav.js';
import { dialog, segmented, switchRow, openKeyboard } from './widgets.js';
import { AMBIENCES, DISPLAY_PROFILES, normalizePins, activeDisplayProfile } from './personalization.js';

const ambienceNames = { calm: t('Sobre'), retro: t('Console rétro'), night: t('Nuit') };
const ambienceDescs = {
  calm: t('Fond uni, tons clairs, sons ronds et animations discrètes'),
  retro: t('Dégradé ambré, coins carrés, sons graves et animations rapides'),
  night: t('Fond illustré, violet doux, sons feutrés et animations discrètes'),
};
const profileNames = { manual: t('Personnel'), portable: t('Console portable'), tv: t('TV'), auto: t('Automatique par écran') };
const soundNames = { round: t('Rond'), retro: t('Rétro grave'), soft: t('Feutré') };

export function previewAmbiences() {
  return new Promise(resolve => {
    const box = $('#dialog .dialog-box');
    box.replaceChildren(el('h2', '', t('Packs d’ambiance')));
    const preview = el('div', 'ambience-preview');
    const description = el('p');
    let chosen = AMBIENCES[0], layer;
    const paint = pack => {
      chosen = pack;
      applyTheme(pack);
      preview.style.setProperty('--preview-accent', pack.accent);
      preview.dataset.background = pack.background;
      preview.innerHTML = `<span class="ambience-orb"></span><span class="ambience-cover">${icon('i-gamepad')}</span><span class="ambience-caption"><b>${esc(ambienceNames[pack.id])}</b><small>${esc(t('Votre bibliothèque'))}</small></span>`;
      description.textContent = ambienceDescs[pack.id];
    };
    const choices = el('div', 'ambience-choices');
    for (const pack of AMBIENCES) {
      const button = nav(el('button', 'chip-btn', esc(ambienceNames[pack.id])), () => { paint(pack); previewSounds(pack.soundTheme); }, 'ambience:' + pack.id);
      button.dataset.pack = pack.id;
      choices.append(button);
    }
    const actions = el('div', 'dialog-actions inline');
    actions.append(
      nav(el('div', 'dbtn', t('Écouter')), () => previewSounds(chosen.soundTheme), 'ambience-listen'),
      nav(el('div', 'dbtn primary', t('Appliquer')), () => closeLayer(layer, chosen), 'ambience-apply'),
      nav(el('div', 'dbtn', t('Annuler')), () => closeLayer(layer), 'ambience-cancel'),
    );
    box.append(preview, description, choices, actions);
    layer = openLayer({ el: $('#dialog'), name: 'dialog', scrim: true, focusKey: 'ambience:calm',
      onFocus: target => { const pack = AMBIENCES.find(p => p.id === target.dataset.pack); if (pack) paint(pack); },
      onClose: result => {
        stopSoundPreview(); applyTheme();
        if (result) { const { id, ...values } = result; Object.assign(settings, values, { ambience: id }); saveSettings(); refresh(); }
        resolve(result || null);
      }, hints: () => [['a', t('Écouter / appliquer')], ['b', t('Annuler')]],
    });
  });
}

export function pinItem(type, id) {
  const pins = Array.isArray(settings.homePins) ? settings.homePins : [];
  const index = pins.findIndex(p => p.type === type && p.id === id);
  if (index >= 0) pins.splice(index, 1);
  else { if (pins.length >= 32) { toast(t('L’accueil peut contenir 32 épingles au maximum')); return; } pins.push({ type, id }); }
  settings.homePins = pins; saveSettings();
  toast(index >= 0 ? t('Épingle retirée de l’accueil') : t('Épinglé sur l’accueil'));
}

async function choosePin() {
  const type = await dialog({ title: t('Épingler sur l’accueil'), buttons: [
    { label: t('Un jeu'), value: 'game' }, { label: t('Une collection'), value: 'collection' }, { label: t('Annuler'), value: null },
  ] });
  if (!type) return;
  let items;
  if (type === 'game') {
    const query = await openKeyboard({ title: t('Rechercher un jeu à épingler'), placeholder: t('Nom du jeu · vide pour les favoris et jeux récents') });
    if (query == null) return;
    const term = query.trim().toLocaleLowerCase();
    items = lib.visible().filter(g => g.type === 'game' && (!term || g.name.toLocaleLowerCase().includes(term)))
      .sort((a, b) => Number(favs.has(b.id)) - Number(favs.has(a.id)) || b.lastPlayed - a.lastPlayed || a.name.localeCompare(b.name)).slice(0, 12);
  } else items = lib.collections;
  if (!items.length) return toast(t('Aucun élément à épingler'));
  const id = await dialog({ title: t('Épingler sur l’accueil'), buttons: [...items.map(item => ({ label: item.name, value: item.id })), { label: t('Annuler'), value: null }] });
  if (id) pinItem(type, id);
}

export async function renderPersonalization(s, { h2, infoRow, actionRow, rerender, orderList, homeRows }) {
  const pick = (title, desc, key, options, view = false) => infoRow(s, title, desc, segmented(options.map(([value, label]) => ({ value, label })), (view ? effectiveSettings() : settings)[key], value => {
    if (view) setAppearance(key, value); else { settings[key] = value; saveSettings(); if (key === 'displayMode') refresh(); }
  }, key));
  const toggle = (key, title, desc) => s.append(switchRow({ key, title, desc, on: settings[key], onToggle: value => { settings[key] = value; saveSettings(); } }));
  h2(s, 'i-palette', t('Packs d’ambiance'));
  actionRow(s, 'i-palette', t('Aperçu des ambiances'), t('Comparez les couleurs, fonds, sons et animations avant d’appliquer'), previewAmbiences, 'ambience-preview');
  pick(t('Animations'), t('Les réglages d’accessibilité restent prioritaires'), 'motionStyle', [['normal', t('Classiques')], ['calm', t('Discrètes')], ['snappy', t('Rapides')]]);

  h2(s, 'i-home', t('Accueil personnel'));
  toggle('homeResume', t('Grande tuile de reprise'), t('Reprendre le jeu en cours ou retrouver votre dernière partie'));
  actionRow(s, 'i-plus', t('Ajouter une épingle'), t('Jeux et collections affichés dans l’ordre de votre choix'), async () => { await choosePin(); rerender('pin-add'); }, 'pin-add');
  const pins = normalizePins(settings.homePins, lib.visible(), lib.collections);
  const pinBox = el('div', 'order-list'); s.append(pinBox);
  for (const [index, pin] of pins.entries()) {
    const item = pin.type === 'game' ? lib.byId(pin.id) : lib.collections.find(c => c.id === pin.id);
    const row = el('div', 'set-row pin-row', `<div class="txt"><b>${esc(item.name)}</b><small>${esc(pin.type === 'game' ? t('Jeu') : t('Collection'))}</small></div>`);
    for (const delta of [-1, 1]) row.append(nav(el('button', 'chip-btn', delta < 0 ? '▲' : '▼'), () => {
      const to = index + delta; if (to < 0 || to >= pins.length) return;
      [pins[index], pins[to]] = [pins[to], pins[index]]; settings.homePins = pins; saveSettings(); rerender('pin-add');
    }, `pin:${index}:${delta}`));
    row.append(nav(el('button', 'chip-btn', t('Retirer')), () => { pinItem(pin.type, pin.id); rerender('pin-add'); }, `pin:${index}:remove`)); pinBox.append(row);
  }
  pick(t('Densité de l’accueil'), t('Espacement entre les rangées et les jaquettes'), 'homeDensity', [['compact', t('Compacte')], ['comfortable', t('Confortable')], ['spacious', t('Aérée')]], true);
  orderList(s, homeRows, 'homeRows', 'homeHidden', 'home');

  h2(s, 'i-image', t('Jaquettes harmonisées'));
  const cfg = await api.get('/api/config').catch(() => null);
  if (cfg) infoRow(s, t('Style de jaquettes'), t('Suggestions SteamGridDB prioritaires · les images personnalisées sont conservées'), segmented([
    { value: '', label: t('Tous') }, { value: 'no_logo', label: t('Illustrations seules') }, { value: 'white_logo', label: t('Titres intégrés') }, { value: 'alternate', label: t('Affiches alternatives') },
  ], cfg.sgdb.style, async value => {
    try { await api.post('/api/config', { sgdbStyle: value }); await lib.load(); toast(t('Préférence de jaquettes enregistrée')); }
    catch (e) { toast(e.message, { error: true }); }
  }, 'cover-style'));
  actionRow(s, 'i-image', t('Choisir une jaquette'), t('Ouvrir la bibliothèque, puis Visuels sur la fiche du jeu'), () => import('./nav.js').then(({ go }) => go('library')), 'cover-library');

  h2(s, 'i-desktop', t('Profils d’interface'));
  const active = activeDisplayProfile(settings, displayState.id);
  infoRow(s, t('Profil actif'), esc(profileNames[active]));
  infoRow(s, t('Écran actuel'), esc(displayState.name));
  pick(t('Choix du profil'), t('Chaque écran associé retrouve son profil automatiquement'), 'displayMode', Object.entries(profileNames), false);
  actionRow(s, 'i-desktop', t('Associer cet écran'), t('Mémoriser Console portable ou TV pour cet écran'), async () => {
    const id = await dialog({ title: t('Associer cet écran'), buttons: [
      { label: t('Console portable'), value: 'portable' }, { label: t('TV'), value: 'tv' }, { label: t('Personnel'), value: 'manual' }, { label: t('Annuler'), value: null },
    ] });
    if (!id) return;
    settings.displayBindings = { ...settings.displayBindings, [displayState.id]: id }; settings.displayMode = 'auto'; saveSettings(); refresh();
  }, 'display-bind');
  for (const id of Object.keys(DISPLAY_PROFILES)) {
    const values = { ...DISPLAY_PROFILES[id], ...settings.displayProfiles?.[id] };
    infoRow(s, profileNames[id], t('Taille de l’interface'), segmented([90, 100, 110, 125, 150].map(value => ({ value, label: value + ' %' })), values.uiScale, value => {
      settings.displayProfiles = { ...settings.displayProfiles, [id]: { ...settings.displayProfiles?.[id], uiScale: +value } }; saveSettings();
    }, 'profile-scale:' + id));
    actionRow(s, 'i-restart', t('Réinitialiser le profil {name}', { name: profileNames[id] }), '', () => {
      const profiles = { ...settings.displayProfiles }; delete profiles[id]; settings.displayProfiles = profiles; saveSettings(); rerender('display-bind');
    }, 'profile-reset:' + id);
  }

  h2(s, 'i-volume', t('Ambiance sonore'));
  toggle('sounds', t('Sons de l’interface'), t('Indépendants du son de démarrage'));
  pick(t('Timbre'), t('Trois ambiances graves, sans clic aigu'), 'soundTheme', Object.entries(soundNames));
  infoRow(s, t('Volume de l’interface'), t('Ne modifie pas le volume de Windows ni celui des jeux'), segmented([0, 25, 50, 75, 100].map(value => ({ value, label: value + ' %' })), settings.soundVolume, value => { settings.soundVolume = +value; saveSettings(); }, 'sound-volume'));
  toggle('soundMoves', t('Sons de déplacement'), t('Vous pouvez garder uniquement les validations et notifications'));
  actionRow(s, 'i-volume', t('Écouter les sons'), t('Déplacement, validation, retour et notification au volume choisi'), () => previewSounds(), 'sound-preview');

  h2(s, 'i-eye-off', t('Mode immersif'));
  toggle('immersive', t('Masquer les indications au repos'), t('Sur l’accueil, la bibliothèque et les fiches de jeu · chaque action les fait réapparaître'));
  pick(t('Délai avant masquage'), t('Les menus, dialogues et réglages restent visibles'), 'immersiveDelay', [[3, t('3 secondes')], [6, t('6 secondes')], [10, t('10 secondes')]]);
}
