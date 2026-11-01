// Player settings, saved in the browser (localStorage).
const KEY = 'lowPolyArena.settings.v1';

export const DEFAULTS = {
  sensitivity: 1.0,   // multiplier on the base mouse speed
  fov: 90,            // vertical field of view, 70 to 110
  volume: 70,         // 0 to 100
  quality: 'medium',  // low | medium | high
  name: '',           // player name for online games
  loadout: { primary: 'ar7', secondary: 'sidekick', melee: 'knife', grenade: 'frag', ability: 'dash' },   // checked again against the real weapon list
};

function clamp(v, lo, hi, fallback) {
  v = Number(v);
  if (!isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}

function sanitize(s) {
  return {
    sensitivity: clamp(s.sensitivity, 0.2, 3, DEFAULTS.sensitivity),
    fov: Math.round(clamp(s.fov, 70, 110, DEFAULTS.fov)),
    volume: Math.round(clamp(s.volume, 0, 100, DEFAULTS.volume)),
    quality: ['low', 'medium', 'high'].includes(s.quality) ? s.quality : DEFAULTS.quality,
    name: typeof s.name === 'string' ? s.name.slice(0, 14) : '',
    loadout: {
      primary: String((s.loadout && s.loadout.primary) || DEFAULTS.loadout.primary),
      secondary: String((s.loadout && s.loadout.secondary) || DEFAULTS.loadout.secondary),
      melee: String((s.loadout && s.loadout.melee) || DEFAULTS.loadout.melee),
      grenade: String((s.loadout && s.loadout.grenade) || DEFAULTS.loadout.grenade),
      ability: String((s.loadout && s.loadout.ability) || DEFAULTS.loadout.ability),
    },
  };
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    return sanitize(Object.assign({}, DEFAULTS, raw ? JSON.parse(raw) : {}));
  } catch (e) {
    return sanitize(Object.assign({}, DEFAULTS));
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch (e) {
    // Private mode or storage full: settings just will not be remembered.
  }
}
