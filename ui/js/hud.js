// Réglages partagés du widget KaneMode (widget.js) et du moniteur en direct (monitor.js). Les deux
// pages ont la même origine dans la Game Bar, donc le même stockage local : le widget choisit les
// mesures du moniteur et lui signale chaque réglage fait, que le moniteur affiche un instant sur le jeu.
import { store } from './core.js';

// Mesures du moniteur, dans l'ordre d'affichage
export const MONITOR_ITEMS = [
  ['fps', 'Images/s'], ['gpu', 'GPU'], ['cpu', 'Processeur'],
  ['power', 'Consommation'], ['limit', 'Puissance'], ['badges', 'Réglages actifs'],
];
// chart : graphique du widget KaneMode (pas une mesure du moniteur), désactivé par défaut
export const monitorPrefs = () => ({ fps: true, gpu: true, cpu: true, power: true, limit: true, badges: true, chart: false, ...store.get('monitor', {}) });
export const setMonitorPref = (key, on) => store.set('monitor', { ...monitorPrefs(), [key]: on });

/** Dernier réglage fait dans le widget, vérifié (ok) ou non : le moniteur l'affiche quelques secondes. */
export const noteChange = (text, ok = true) => store.set('change', { text, ok, t: Date.now() });
export const lastChange = () => store.get('change', null);
