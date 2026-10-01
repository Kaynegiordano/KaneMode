// Commandes Dolby dans KaneMode ; options propriétaires dans l'application officielle.
import { t } from './i18n.js';
import { el, esc, api, toast } from './core.js';
import { nav } from './nav.js';
import { dialog } from './widgets.js';
const names = () => ({ off: t('Désactivé'), headphones: 'Dolby Atmos for Headphones', homeTheater: 'Dolby Atmos for Home Theater',
  speakers: 'Dolby Atmos for Speakers', sonic: 'Windows Sonic', other: t('Autre format spatial') });
export async function renderDolby(s, { h2, infoRow, actionRow, rerender }) {
  h2(s, 'i-volume', 'Dolby Atmos');
  const state = await api.get('/api/dolby?refresh=1');
  infoRow(s, 'Dolby Access', state.installed ? t('Installé · version {a}', { a: esc(state.appVersion || '') }) : t('Non installé'));
  infoRow(s, t('Licence Dolby'), t('Achat et licence existante vérifiés dans Dolby Access avec votre compte Microsoft'));
  const open = async action => {
    try {
      const result = await api.post('/api/dolby/open', { action });
      if (!result.ok) throw new Error(result.error || t('Ouverture impossible'));
      toast(t('Ouverture…'));
    } catch (error) { toast(error.message, { error: true }); }
  };
  actionRow(s, 'i-store', state.installed ? t('Acheter ou activer Atmos') : t('Installer Dolby Access'),
    state.installed ? t('Essai, achat ou récupération de votre licence dans l’application officielle') : t('Installation officielle depuis le Microsoft Store'), () => open(state.installed ? 'license' : 'store'), 'dolby-license');
  if (state.installed) actionRow(s, 'i-palette', t('Profils et égaliseur Dolby'), t('Jeu, musique, cinéma et profils personnalisés dans Dolby Access'), () => open('app'), 'dolby-options');
  actionRow(s, 'i-refresh', t('Actualiser'), t('Relire les sorties audio et l’installation de Dolby Access'), () => rerender('dolby-refresh'), 'dolby-refresh');

  h2(s, 'i-volume', t('Son spatial par sortie audio'));
  s.append(el('div', 'notice', t('Chaque changement est vérifié dans Windows. Le format sélectionné et le format actif peuvent différer selon la sortie et sa configuration.')));
  if (!state.available || !state.devices.length) infoRow(s, t('Son spatial'), t('Son spatial Windows indisponible'));
  const labels = names();
  for (const device of state.devices) {
    const box = el('div', 'dolby-device'); s.append(box);
    infoRow(box, esc(device.name), (device.default ? t('Sortie Windows par défaut') + ' · ' : '') + t('Sélectionné : {a} · actif : {b}', { a: esc(labels[device.selected] || labels.other), b: esc(labels[device.active] || labels.other) }));
    if (state.controllable) {
      actionRow(box, 'i-volume', t('Changer le format spatial'), t('Dolby nécessite une licence valide et une sortie compatible'), async () => {
        const mode = await dialog({ title: device.name, buttons: [...device.supported.filter(key => labels[key]).map(key => ({ label: labels[key], value: key })), { label: t('Annuler'), value: null }] });
        if (mode == null) return;
        try {
          const result = await api.post('/api/dolby', { device: device.id, mode });
          if (result.verified) toast(t('Format spatial vérifié dans Windows'));
        } catch (error) { toast(error.message, { error: true }); }
        rerender('dolby-format:' + device.id);
      }, 'dolby-format:' + device.id);
    }
  }
  actionRow(s, 'i-volume', t('Réglages audio Windows'), t('Choisir la sortie audio et vérifier sa configuration'), () => open('sound'), 'dolby-windows');
}
