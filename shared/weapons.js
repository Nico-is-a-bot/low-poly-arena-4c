/*
 * shared/weapons.js
 *
 * Every weapon in the game. Shared so the server uses the exact same numbers as the browser.
 *
 * Fire modes:
 *   auto   holds fire while the button is held
 *   semi   one shot per click
 *   pump   one shot per click, then a pump cycle (the cooldown)
 *   bolt   one shot per click, then a bolt cycle (the cooldown)
 *   burst  one click fires a short burst
 *   single one slow powerful shot per click
 *   melee  a swing
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.ArenaShared = root.ArenaShared || {};
    root.ArenaShared.Weapons = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RARITY = {
    common:    { name: 'Common',    color: '#9aa0a6' },
    rare:      { name: 'Rare',      color: '#3b82f6' },
    epic:      { name: 'Epic',      color: '#a855f7' },
    mythic:    { name: 'Mythic',    color: '#ef4444' },
    legendary: { name: 'Legendary', color: '#f59e0b' },
  };

  const SLOTS = ['primary', 'secondary', 'melee'];
  const DEFAULT_LOADOUT = { primary: 'ar7', secondary: 'sidekick', melee: 'knife', grenade: 'frag', ability: 'dash' };

  // Settings every gun starts from; each weapon overrides what is different.
  const GUN = {
    type: 'gun',
    headMult: 1.5,
    pellets: 1,
    fireMode: 'auto',
    reloadMode: 'mag',        // 'mag' = one reload for the whole magazine, 'shell' = one shell at a time
    recoil: { up: 0.3, side: 0.12, recover: 14, recoverDelay: 0.12 },
    spread: { hip: 1.1, ads: 0.1, perShot: 0.18, max: 2.0, recoverDelay: 0.14, decay: 7, move: 1.0, air: 2.0 },
    falloffStart: 35, falloffEnd: 90, minMult: 0.65,
    maxRange: 200,
    adsTime: 0.18, adsFov: 0.8, adsMoveMult: 0.75,
    scope: false,             // true shows a scope overlay when aiming
    weight: 1.0,              // walking speed multiplier (lighter weapons are a little faster)
    equipTime: 0.35,          // seconds before you can fire after switching to it
    soundClass: 'rifle',
    model: 'ar',
  };

  const MELEE = {
    type: 'melee',
    headMult: 1,
    fireMode: 'melee',
    mag: 0, reserve: 0, reloadTime: 0,
    backstabDamage: 100,
    arc: 90,                  // degrees, how wide the swing reaches in front of you
    adsTime: 0.2, adsFov: 1, adsMoveMult: 1,
    equipTime: 0.25,
    bunnyHop: true,           // hold crouch + jump + sprint to bunny hop
    soundClass: 'blade',
    recoil: { up: 0, side: 0, recover: 14, recoverDelay: 0.12 },
    spread: { hip: 0, ads: 0, perShot: 0, max: 0, recoverDelay: 0.14, decay: 7, move: 0, air: 0 },
    maxRange: 0,
  };

  function gun(o) {
    return Object.assign({}, GUN, o, {
      recoil: Object.assign({}, GUN.recoil, o.recoil || {}),
      spread: Object.assign({}, GUN.spread, o.spread || {}),
    });
  }
  function melee(o) {
    return Object.assign({}, MELEE, o, {
      recoil: Object.assign({}, MELEE.recoil, o.recoil || {}),
      spread: Object.assign({}, MELEE.spread, o.spread || {}),
    });
  }

  const WEAPONS = {
    // ------------------------------------------------------------ primaries
    ar7: gun({
      id: 'ar7', name: 'AR-7 Assault Rifle', shortName: 'AR-7', slot: 'primary', rarity: 'common',
      note: 'Balanced, medium recoil',
      damage: 22, rpm: 600, fireMode: 'auto', mag: 30, reserve: 120, reloadTime: 2.2,
      spread: { move: 3.0 },
      model: 'ar', soundClass: 'rifle',
    }),

    viper: gun({
      id: 'viper', name: 'Viper SMG', shortName: 'Viper', slot: 'primary', rarity: 'common',
      note: 'Fast, short range, low recoil',
      damage: 16, rpm: 900, fireMode: 'auto', mag: 35, reserve: 140, reloadTime: 1.8,
      recoil: { up: 0.18, side: 0.1, recover: 16 },
      spread: { hip: 1.3, ads: 0.25, perShot: 0.12, max: 1.6, decay: 8, move: 2.2, air: 2.5 },
      falloffStart: 15, falloffEnd: 45, minMult: 0.55, maxRange: 120,
      adsTime: 0.12, adsFov: 0.85, adsMoveMult: 0.85, weight: 1.04, equipTime: 0.25,
      model: 'smg', soundClass: 'smg',
    }),

    breaker: gun({
      id: 'breaker', name: 'Breaker Shotgun', shortName: 'Breaker', slot: 'primary', rarity: 'rare',
      note: 'Deadly up close, spread',
      damage: 9, pellets: 8, rpm: 70, fireMode: 'pump', mag: 6, reserve: 30,
      reloadMode: 'shell', reloadTime: 0.6 * 6, shellTime: 0.6,
      recoil: { up: 3.0, side: 0.5, recover: 18, recoverDelay: 0.25 },
      spread: { hip: 4.4, ads: 3.2, perShot: 0, max: 0, decay: 8, move: 1.5, air: 1.5 },
      falloffStart: 6, falloffEnd: 22, minMult: 0.2, maxRange: 60,
      adsTime: 0.22, adsFov: 0.9, adsMoveMult: 0.8, weight: 0.92, equipTime: 0.4,
      model: 'shotgun', soundClass: 'shotgun',
    }),

    hammer: gun({
      id: 'hammer', name: 'Hammer LMG', shortName: 'Hammer', slot: 'primary', rarity: 'epic',
      note: 'High recoil, slow aim speed',
      damage: 18, rpm: 700, fireMode: 'auto', mag: 100, reserve: 200, reloadTime: 5.0,
      recoil: { up: 0.45, side: 0.22, recover: 11, recoverDelay: 0.16 },
      spread: { hip: 1.6, ads: 0.4, perShot: 0.12, max: 3.0, decay: 4, move: 4.5, air: 2.5 },
      falloffStart: 30, falloffEnd: 80, minMult: 0.6,
      adsTime: 0.4, adsFov: 0.8, adsMoveMult: 0.55, weight: 0.8, equipTime: 0.6,
      model: 'lmg', soundClass: 'lmg',
    }),

    longshot: gun({
      id: 'longshot', name: 'Longshot Sniper', shortName: 'Longshot', slot: 'primary', rarity: 'epic',
      note: 'Scoped, big recoil, long range. Headshots always kill.',
      damage: 90, headMult: 1.5, killOnHead: true, rpm: 45, fireMode: 'bolt', mag: 5, reserve: 20, reloadTime: 3.0,
      recoil: { up: 3.5, side: 0.4, recover: 10, recoverDelay: 0.4 },
      spread: { hip: 4.0, ads: 0.0, perShot: 0, max: 0, decay: 8, move: 12, air: 5.0 },
      falloffStart: 400, falloffEnd: 401, minMult: 1, maxRange: 250,
      adsTime: 0.35, adsFov: 0.22, adsMoveMult: 0.6, scope: true, weight: 0.85, equipTime: 0.55,
      model: 'sniper', soundClass: 'sniper',
    }),

    nova: gun({
      id: 'nova', name: 'Nova Carbine', shortName: 'Nova', slot: 'primary', rarity: 'mythic',
      note: 'Laser rifle: 3-round burst, zero recoil. Falls off with distance.',
      damage: 28, headMult: 1.5, rpm: 900, fireMode: 'burst', burst: { count: 3, delay: 0.38 },
      mag: 30, reserve: 90, reloadTime: 2.4,
      recoil: { up: 0, side: 0, recover: 14, recoverDelay: 0.12 },
      spread: { hip: 0.9, ads: 0.05, perShot: 0, max: 0, decay: 8, move: 3.0, air: 1.5 },
      falloffStart: 22, falloffEnd: 70, minMult: 0.45, maxRange: 150,
      adsTime: 0.15, adsFov: 0.8, adsMoveMult: 0.85, weight: 1.0, equipTime: 0.3,
      model: 'nova', soundClass: 'laser', tracerColor: '#7dffb0',
    }),

    rail: gun({
      id: 'rail', name: 'Rail Cannon', shortName: 'Rail', slot: 'primary', rarity: 'legendary',
      note: 'One huge shot every 2 seconds. Goes through one wall.',
      damage: 85, headMult: 2.0, rpm: 30, fireMode: 'single', mag: 3, reserve: 9, reloadTime: 3.2,
      pierceWalls: 1,
      recoil: { up: 4.5, side: 0.4, recover: 9, recoverDelay: 0.5 },
      spread: { hip: 3.0, ads: 0.0, perShot: 0, max: 0, decay: 8, move: 14, air: 4.0 },
      falloffStart: 400, falloffEnd: 401, minMult: 1, maxRange: 250,
      adsTime: 0.4, adsFov: 0.35, adsMoveMult: 0.6, scope: true, weight: 0.85, equipTime: 0.6,
      model: 'rail', soundClass: 'rail', tracerColor: '#ffd36b',
    }),

    // ------------------------------------------------------------ secondaries
    sidekick: gun({
      id: 'sidekick', name: 'Sidekick Pistol', shortName: 'Sidekick', slot: 'secondary', rarity: 'common',
      note: 'Reliable',
      damage: 20, rpm: 400, fireMode: 'semi', mag: 12, reserve: 60, reloadTime: 1.3,
      recoil: { up: 0.8, side: 0.2, recover: 16, recoverDelay: 0.15 },
      spread: { hip: 1.0, ads: 0.1, perShot: 0.5, max: 1.8, recoverDelay: 0.2, decay: 5, move: 2.4, air: 2.0 },
      falloffStart: 25, falloffEnd: 60, minMult: 0.65, maxRange: 150,
      adsTime: 0.12, adsFov: 0.88, adsMoveMult: 0.9, weight: 1.04, equipTime: 0.22,
      model: 'pistol', soundClass: 'pistol',
    }),

    stinger: gun({
      id: 'stinger', name: 'Stinger Machine Pistol', shortName: 'Stinger', slot: 'secondary', rarity: 'rare',
      note: 'Close-range spray',
      damage: 11, rpm: 800, fireMode: 'auto', mag: 20, reserve: 80, reloadTime: 1.5,
      recoil: { up: 0.35, side: 0.25, recover: 15 },
      spread: { hip: 1.8, ads: 0.5, perShot: 0.25, max: 2.5, decay: 7, move: 2.0, air: 2.5 },
      falloffStart: 12, falloffEnd: 35, minMult: 0.5, maxRange: 100,
      adsTime: 0.12, adsFov: 0.88, adsMoveMult: 0.9, weight: 1.04, equipTime: 0.22,
      model: 'mpistol', soundClass: 'mpistol',
    }),

    cannon: gun({
      id: 'cannon', name: 'Cannon Revolver', shortName: 'Cannon', slot: 'secondary', rarity: 'epic',
      note: 'Two-shot kill to the body',
      damage: 55, rpm: 120, fireMode: 'semi', mag: 6, reserve: 24, reloadTime: 2.4,
      recoil: { up: 2.4, side: 0.4, recover: 12, recoverDelay: 0.3 },
      spread: { hip: 1.0, ads: 0.05, perShot: 0.8, max: 1.5, recoverDelay: 0.3, decay: 4, move: 4.0, air: 2.0 },
      falloffStart: 30, falloffEnd: 80, minMult: 0.7, maxRange: 180,
      adsTime: 0.16, adsFov: 0.85, adsMoveMult: 0.85, weight: 1.03, equipTime: 0.3,
      model: 'revolver', soundClass: 'revolver',
    }),

    // ------------------------------------------------------------ melee
    knife: melee({
      id: 'knife', name: 'Combat Knife', shortName: 'Knife', slot: 'melee', rarity: 'common',
      note: 'Backstab is an instant kill. You move faster with it out.',
      damage: 40, rpm: 120, swing: 0.5, range: 2.0, weight: 1.08, model: 'knife',
    }),

    machete: melee({
      id: 'machete', name: 'Machete', shortName: 'Machete', slot: 'melee', rarity: 'rare',
      note: 'A little more reach than the knife.',
      damage: 45, rpm: 109, swing: 0.55, range: 2.3, weight: 1.06, model: 'machete',
    }),

    blade: melee({
      id: 'blade', name: 'Energy Blade', shortName: 'Energy Blade', slot: 'melee', rarity: 'legendary',
      note: 'Glowing and the fastest melee weapon.',
      damage: 55, rpm: 150, swing: 0.4, range: 2.3, weight: 1.07, model: 'blade', tracerColor: '#7ad7ff',
    }),
  };


  // ------------------------------------------------------------ grenades
  // You carry 2 and get 1 back every 30 seconds. Throw with G (hold to see where it will land).
  const GRENADE_MAX = 2;
  const GRENADE_REGEN = 30;       // seconds to get one back
  const GRENADE_COOLDOWN = 0.7;   // seconds between throws

  const GRENADES = {
    frag: {
      id: 'frag', name: 'Frag Grenade', shortName: 'Frag', rarity: 'common', kind: 'frag',
      fuse: 2, damage: 70, radius: 5, color: '#4b5d3a',
      note: 'Explodes after 2 s. 70 damage in the centre, fading to 0 at 5 m. Walls block the blast.',
    },
    flash: {
      id: 'flash', name: 'Flashbang', shortName: 'Flash', rarity: 'rare', kind: 'flash',
      fuse: 1.3, maxBlind: 3, range: 20, color: '#d9dde3',
      note: 'Blinds the screen white for up to 3 s. Worse the closer you are and the more you look at it.',
    },
    smoke: {
      id: 'smoke', name: 'Smoke Grenade', shortName: 'Smoke', rarity: 'rare', kind: 'smoke',
      fuse: 1.2, radius: 4, duration: 8, color: '#8a929c',
      note: 'A cloud with a 4 m radius for 8 s that blocks the view.',
    },
    sticky: {
      id: 'sticky', name: 'Sticky Grenade', shortName: 'Sticky', rarity: 'epic', kind: 'sticky',
      fuse: 1.5, damage: 80, radius: 4, maxFlight: 5, color: '#3b82f6', sticky: true,
      note: 'Sticks to walls and players. Explodes 1.5 s after it sticks. 80 damage at the centre, fading to 0 at 4 m.',
    },
    incendiary: {
      id: 'incendiary', name: 'Incendiary Grenade', shortName: 'Incendiary', rarity: 'mythic', kind: 'incendiary',
      fuse: 1.2, radius: 4, duration: 5, dps: 12, tick: 0.5, color: '#ef4444',
      note: 'Leaves fire in a 4 m radius for 5 s. 12 damage per second to anyone standing in it.',
    },
  };
  const GRENADE_ORDER = ['frag', 'flash', 'smoke', 'sticky', 'incendiary'];

  function grenade(id) {
    const g = GRENADES[id];
    if (!g) throw new Error('Unknown grenade: ' + id);
    return g;
  }
  function grenadeExists(id) { return Object.prototype.hasOwnProperty.call(GRENADES, id); }
  function allGrenades() { return GRENADE_ORDER.map((id) => GRENADES[id]); }

  // ------------------------------------------------------------ abilities
  // One ability per player, on its own key. Passive ones (Second Wind) have no button.
  const ABILITIES = {
    dash: {
      id: 'dash', name: 'Dash', shortName: 'Dash', rarity: 'common', cd: 8, speed: 16, dur: 0.2, color: '#9aa0a6',
      note: 'A quick burst of speed in the direction you are moving (forward if you are standing still).',
    },
    heal: {
      id: 'heal', name: 'Heal Pulse', shortName: 'Heal', rarity: 'common', cd: 30, amount: 25, dur: 3, color: '#4ade80',
      note: 'Restores 25 HP over 3 s. Taking any damage cancels it.',
    },
    airdash: {
      id: 'airdash', name: 'Air Dash', shortName: 'Air Dash', rarity: 'rare', cd: 10, speed: 13, dur: 0.3, color: '#7dd3fc', airOnly: true,
      note: 'A burst of speed in mid-air that also carries you across small gaps. Only works while you are in the air.',
    },
    armor: {
      id: 'armor', name: 'Armor Plate', shortName: 'Armor', rarity: 'rare', cd: 35, amount: 30, dur: 10, color: '#60a5fa',
      note: 'Absorbs the next 30 damage you take within 10 s.',
    },
    scan: {
      id: 'scan', name: 'Scan Pulse', shortName: 'Scan', rarity: 'rare', cd: 25, range: 30, dur: 3, color: '#c084fc',
      note: 'Shows every enemy within 30 m through walls for 3 s (they are not told).',
    },
    grapple: {
      id: 'grapple', name: 'Grapple Hook', shortName: 'Grapple', rarity: 'epic', cd: 12, range: 25, speed: 24, maxTime: 1.6, color: '#f472b6',
      note: 'Fires a hook where you look and pulls you to that surface (up to 25 m away).',
    },
    surge: {
      id: 'surge', name: 'Damage Surge', shortName: 'Surge', rarity: 'epic', cd: 40, mult: 1.3, dur: 8, color: '#fb923c',
      note: '+30% damage for 8 s with every weapon and grenade.',
    },
    shield: {
      id: 'shield', name: 'Shield Bubble', shortName: 'Shield', rarity: 'epic', cd: 40, dur: 6, radius: 3, color: '#38bdf8',
      note: 'Places a dome (3 m radius) just in front of you for 6 s. Bullets from outside are stopped by it. You can shoot out from inside.',
    },
    mine: {
      id: 'mine', name: 'Proximity Mine', shortName: 'Mine', rarity: 'mythic', cd: 20, max: 2, damage: 60, trigger: 2.5, radius: 3, arm: 1, color: '#ef4444',
      note: 'Places a mine on the floor. It arms after 1 s and explodes for 60 damage when an enemy gets within 2.5 m. Two at a time.',
    },
    cloak: {
      id: 'cloak', name: 'Phase Cloak', shortName: 'Cloak', rarity: 'mythic', cd: 45, dur: 5, reveal: 1, color: '#a78bfa',
      note: 'Nearly invisible for 5 s. You show up for 1 s every time you shoot, swing or throw. Scan Pulse sees through it.',
    },
    orbital: {
      id: 'orbital', name: 'Orbital Strike', shortName: 'Orbital', rarity: 'legendary', cd: 90, delay: 2, damage: 100, radius: 6, range: 60, color: '#fbbf24',
      note: 'Marks the spot you are looking at (up to 60 m). After 2 s a strike hits for 100 damage in a 6 m radius. Everyone sees the marker, and it hurts you too.',
    },
    secondwind: {
      id: 'secondwind', name: 'Second Wind', shortName: '2nd Wind', rarity: 'legendary', cd: 60, hp: 50, boost: 1.3, boostDur: 3, color: '#f59e0b', passive: true,
      note: 'Passive. The next time you would die, you survive with 50 HP and a short speed boost. Re-arms 60 s later.',
    },
  };
  const ABILITY_ORDER = ['dash', 'heal', 'airdash', 'armor', 'scan', 'grapple', 'shield', 'surge', 'mine', 'cloak', 'orbital', 'secondwind'];
  function ability(id) {
    const a = ABILITIES[id];
    if (!a) throw new Error('Unknown ability: ' + id);
    return a;
  }
  function abilityExists(id) { return Object.prototype.hasOwnProperty.call(ABILITIES, id); }
  function allAbilities() { return ABILITY_ORDER.map((id) => ABILITIES[id]); }

  const ORDER = ['ar7', 'viper', 'breaker', 'hammer', 'longshot', 'nova', 'rail',
    'sidekick', 'stinger', 'cannon', 'knife', 'machete', 'blade'];

  function get(id) {
    const w = WEAPONS[id];
    if (!w) throw new Error('Unknown weapon: ' + id);
    return w;
  }

  function exists(id) {
    return Object.prototype.hasOwnProperty.call(WEAPONS, id);
  }

  /** Weapons that fit a slot, in menu order. */
  function forSlot(slot) {
    return ORDER.map((id) => WEAPONS[id]).filter((w) => w.slot === slot);
  }

  /**
   * Cleans up a loadout from an untrusted source: every slot must hold a real weapon that fits it,
   * otherwise it falls back to the default. Returns { primary, secondary, melee, grenade, ability }.
   */
  function validateLoadout(lo) {
    const out = {};
    for (const slot of SLOTS) {
      const id = lo && typeof lo === 'object' ? lo[slot] : undefined;
      out[slot] = (typeof id === 'string' && exists(id) && WEAPONS[id].slot === slot) ? id : DEFAULT_LOADOUT[slot];
    }
    const gid = lo && typeof lo === 'object' ? lo.grenade : undefined;
    out.grenade = (typeof gid === 'string' && grenadeExists(gid)) ? gid : DEFAULT_LOADOUT.grenade;
    const aid = lo && typeof lo === 'object' ? lo.ability : undefined;
    out.ability = (typeof aid === 'string' && abilityExists(aid)) ? aid : DEFAULT_LOADOUT.ability;
    return out;
  }

  /** The loadout as a list in slot order: [primary, secondary, melee]. */
  function loadoutIds(lo) {
    const v = validateLoadout(lo);
    return SLOTS.map((s) => v[s]);
  }

  /** Damage multiplier for a hit at this distance (metres). */
  function distanceMult(w, dist) {
    if (dist <= w.falloffStart) return 1;
    if (dist >= w.falloffEnd) return w.minMult;
    const k = (dist - w.falloffStart) / (w.falloffEnd - w.falloffStart);
    return 1 + (w.minMult - 1) * k;
  }

  /** Damage dealt by one bullet or pellet. */
  function damageFor(w, dist, head) {
    if (head && w.killOnHead) return 999;
    const base = w.damage * distanceMult(w, dist) * (head ? w.headMult : 1);
    return Math.round(base);
  }

  /** Seconds between shots (or between swings). */
  function shotInterval(w) {
    if (w.type === 'melee') return w.swing;
    return 60 / w.rpm;
  }

  /** Time between the shots inside a burst. */
  function burstInterval(w) {
    return 60 / w.rpm;
  }

  /** Bars shown in the loadout screen, each 0 to 100 (bigger is better, except recoil). */
  function statBars(w) {
    const clamp = (v) => Math.max(0, Math.min(100, Math.round(v)));
    if (w.type === 'melee') {
      return {
        damage: clamp(w.damage), fireRate: clamp(100 / w.swing / 3), magazine: 0, reserve: 0,
        reload: 0, recoil: 0, range: clamp(w.range / 3 * 100), aimSpeed: 100,
        speed: clamp((w.weight - 0.75) / 0.35 * 100),
      };
    }
    const perShot = w.damage * w.pellets;
    // effective shots per minute (a burst weapon pauses between bursts)
    const rpm = w.fireMode === 'burst'
      ? w.burst.count * 60 / ((w.burst.count - 1) * 60 / w.rpm + w.burst.delay)
      : w.rpm;
    return {
      damage: clamp(perShot),
      fireRate: clamp(rpm / 9),
      magazine: clamp(Math.sqrt(w.mag / 100) * 100),
      reserve: clamp(Math.sqrt(w.reserve / 200) * 100),
      reload: clamp((1 - w.reloadTime / 6.5) * 100),
      recoil: clamp(w.recoil.up * Math.sqrt(w.rpm / 60) * 18),
      range: clamp((w.falloffEnd > 300 ? 200 : w.falloffEnd) / 1.2),
      aimSpeed: clamp((1 - w.adsTime / 0.5) * 100),
      speed: clamp((w.weight - 0.75) / 0.35 * 100),
    };
  }

  return {
    RARITY, SLOTS, DEFAULT_LOADOUT, WEAPONS, ORDER,
    ABILITIES, ABILITY_ORDER, ability, abilityExists, allAbilities,
    GRENADES, GRENADE_ORDER, GRENADE_MAX, GRENADE_REGEN, GRENADE_COOLDOWN, grenade, grenadeExists, allGrenades,
    get, exists, forSlot, validateLoadout, loadoutIds,
    distanceMult, damageFor, shotInterval, burstInterval, statBars,
  };
});
