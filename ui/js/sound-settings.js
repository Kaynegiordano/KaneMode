// Migration appliquée une fois : l'utilisateur peut ensuite réactiver les sons.
export function quietInterfaceDefaults(settings) {
  return settings.quietInterfaceDefault ? settings : { ...settings, sounds: false, quietInterfaceDefault: true };
}
export function chimeEnabled(settings, kind) {
  return settings.bootSound !== 'none' && (kind === 'boot' || settings.sounds === true);
}
