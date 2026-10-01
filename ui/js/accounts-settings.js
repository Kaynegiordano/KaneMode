// Bibliothèques possédées : KaneMode affiche les fiches, les connecteurs gardent leurs comptes.
import { t, tn, locale } from './i18n.js';
import { el, esc, api, lib, native, toast, busy } from './core.js';
import { switchRow } from './widgets.js';
import { pickFile } from './pages/add.js';

export async function renderAccounts(s, { h2, infoRow, actionRow, rerender }) {
  h2(s, 'i-store', t('Comptes et boutiques'));
  s.append(el('div', 'notice', t('Importez aussi les jeux possédés qui ne sont pas installés. La passerelle Playnite utilise les connecteurs de vos boutiques ; les comptes et mots de passe restent dans Playnite.')));
  const state = await api.get('/api/accounts');
  const task = async (url, body = {}, external = false) => {
    if (external) native.send('foreground');
    busy(t('Connexion aux bibliothèques…'));
    try {
      const result = await api.post(url, body);
      if (result.ok === false) throw new Error(result.error || t('Ouverture impossible'));
      await lib.load(); await rerender(); return result;
    } catch (error) { if (external) native.send('external-cancel'); toast(error.message, { error: true }); }
    finally { busy(null); }
  };
  infoRow(s, 'Playnite', state.installed ? esc(state.exe || '') : t('Non installé'));
  if (!state.installed) {
    actionRow(s, 'i-download2', t('Télécharger Playnite'), t('Gestionnaire gratuit et open source · site officiel'), () => task('/api/accounts/download', {}, true), 'accounts-download');
  }
  actionRow(s, 'i-folder', t('Choisir Playnite portable'), t('Sélectionnez Playnite.DesktopApp.exe si sa version portable n’est pas détectée'), async () => {
    const exe = await pickFile('exe');
    if (exe) await task('/api/accounts/config', { exe, enabled: true });
  }, 'accounts-path');
  if (!state.installed) return;
  s.append(switchRow({ title: t('Importer mes bibliothèques de comptes'), desc: t('Tous les jeux renvoyés par les connecteurs, installés ou non · aucune sélection limitée aux jeux déjà joués'),
    key: 'accounts-enabled', on: !!state.enabled, onToggle: enabled => task('/api/accounts/config', { enabled }) }));
  if (!state.enabled) return;
  infoRow(s, t('Passerelle de comptes'), state.online ? t('Connectée') : t('Fermée · la bibliothèque enregistrée reste disponible'));
  infoRow(s, t('Bibliothèque importée'), t('{total} jeux · {ready} prêts à installer', { total: state.count || 0, ready: state.installable || 0 }));
  if (state.updated) infoRow(s, t('Dernière importation'), new Date(state.updated).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }));
  actionRow(s, 'i-store', t('Connecter mes boutiques dans Playnite'), t('Connectez vos comptes, activez l’import des jeux non installés et mettez à jour les bibliothèques (F5)'), () => task('/api/accounts/open', {}, true), 'accounts-open');
  s.append(el('div', 'notice', t('Après l’activation de la passerelle, fermez puis rouvrez Playnite. Ajoutez les connecteurs souhaités dans ses extensions. Les connecteurs chargés apparaissent ici après la première synchronisation.')));
  actionRow(s, 'i-refresh', t('Synchroniser avec Playnite'), t('Importe la bibliothèque actuelle de Playnite ; les nouveaux achats doivent d’abord être synchronisés par leurs connecteurs'), async () => {
    const result = await task('/api/accounts/sync', { start: true }, !state.online);
    if (result) toast(tn(result.count || 0, '{n} jeu importé', '{n} jeux importés'));
  }, 'accounts-sync');
  h2(s, 'i-library', t('Connecteurs de boutiques'));
  for (const p of state.providers || []) {
    const desc = tn(p.count, '{n} jeu', '{n} jeux');
    if (p.settings) actionRow(s, 'i-store', esc(p.name), desc + ' · ' + t('Configurer ce compte'), () => task('/api/accounts/open', { provider: p.id }, true), 'account:' + p.id);
    else infoRow(s, esc(p.name), desc);
  }
  s.append(el('div', 'notice', t('Les vendeurs de clés comme Instant Gaming ne sont pas des bibliothèques de jeux : après activation, leurs jeux sont importés depuis Steam, Epic, Ubisoft ou la boutique indiquée sur la clé.')));
}
