// WebView2 peut conserver un état de manette figé quand une autre fenêtre prend la main.
export function createMouseFreshness() {
  const samples = new Map();
  return {
    reset() { samples.clear(); },
    fresh(pad, now, foreground) {
      const id = pad.index + ':' + pad.id;
      const key = JSON.stringify([pad.axes, pad.buttons.map(b => !!b.pressed)]);
      const timestamp = Number(pad.timestamp) || 0;
      let sample = samples.get(id);
      if (!sample) { sample = { key, timestamp, at: now }; samples.set(id, sample); }
      else if (foreground || sample.key !== key || timestamp > sample.timestamp) sample.at = now;
      sample.key = key; sample.timestamp = timestamp;
      return now - sample.at < 300;
    },
  };
}
