// Low-Poly Arena, Stage 3A: weapons and loadouts.
// This file ties everything together: input, movement, shooting, HUD and drawing.
// It runs in two modes: practice (alone, with target dummies) and online (the server decides).
import * as THREE from 'three';
import { loadSettings, saveSettings } from './settings.js';
import { Sfx } from './audio.js';
import { buildWorld } from './world.js';
import { Viewmodel } from './viewmodel.js';
import { Hud } from './hud.js';
import { Dummies } from './dummies.js';
import { Effects } from './effects.js';
import { Net } from './net.js';
import { RemotePlayers, SLOT_COLORS } from './players.js';
import { LoadoutScreen } from './loadout.js';
import { Keybinds, buildKeybindUi, keyName } from './keybinds.js';
import { GrenadeWorld } from './grenadeFx.js';
import { AbilityFx } from './abilityFx.js';
import { AbilityWorld } from './abilityWorld.js';
import { ZillaFx } from './zillaFx.js';
import { ZillaView } from './zillaModel.js';

const $ = (id) => document.getElementById(id);
const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const INTERP_DELAY = 100;     // ms: other players are drawn this far in the past so their movement is smooth

function showError(message) {
  const box = $('loadError');
  box.textContent = message;
  box.classList.remove('hidden');
  $('playBtn').disabled = true;
  $('loadoutBtn').disabled = true;
  $('joinBtn').disabled = true;
  $('joinBtn').textContent = 'Cannot start';
}

function start() {
  const Shared = window.ArenaShared;
  if (!Shared || !Shared.Physics || !Shared.Maps || !Shared.Weapons || !Shared.Combat || !Shared.Grenades || !Shared.Abilities || !Shared.Zilla) {
    throw new Error('The shared game files (/shared/*.js) did not load. Make sure you started the game with "npm start" and opened the address it printed.');
  }
  const P = Shared.Physics;
  const Weapons = Shared.Weapons;
  const C = Shared.Combat;
  const G = Shared.Grenades;
  const Abil = Shared.Abilities;
  const Zilla = Shared.Zilla;
  const map = Shared.Maps.get('container_yard');
  const mapBoxes = P.prepareBoxes(map.boxes);
  const FIXED = P.C.FIXED_DT;
  const rarityOf = (w) => Weapons.RARITY[w.rarity].color;

  // ------------------------------------------------------------ settings
  const settings = loadSettings();
  const binds = new Keybinds();
  const isDown = (action) => !!keys[binds.get(action)];
  settings.loadout = Weapons.validateLoadout(settings.loadout);   // only real weapons in the right slots
  let wpn = Weapons.get(settings.loadout.primary);                // the weapon in hand (kept up to date by syncWeaponUi)

  // ------------------------------------------------------------ renderer and scene
  const canvas = $('game');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    throw new Error('Your browser could not start WebGL (3D graphics). Try an up to date Chrome, Edge or Firefox and make sure hardware acceleration is turned on.');
  }
  renderer.autoClear = false;
  renderer.info.autoReset = false;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const camera = new THREE.PerspectiveCamera(settings.fov, window.innerWidth / window.innerHeight, 0.05, 400);
  camera.rotation.order = 'YXZ';

  const world = buildWorld(map);
  const effects = new Effects(world.scene);
  const abilityFx = new AbilityFx(world.scene);
  const abilityWorld = new AbilityWorld(world.scene, (a) => addShake(a));
  const grenWorld = new GrenadeWorld(world.scene, Weapons, effects, (a) => addShake(a));
  const dummies = new Dummies(world.scene, map.dummies);
  const viewmodel = new Viewmodel(window.innerWidth / window.innerHeight);
  const zfx = new ZillaFx(world.scene);
  const zview = new ZillaView();            // your claws and jaw when you are Godzilla
  viewmodel.scene.add(zview.root);
  const _zp = new THREE.Vector3(), _zd = new THREE.Vector3();
  let zBreathSnd = 0, zUiOn = false;
  const hud = new Hud(map);
  const sfx = new Sfx();
  sfx.setVolume(settings.volume);

  function applyQuality() {
    const q = settings.quality;
    const dpr = window.devicePixelRatio || 1;
    const pixelRatio = q === 'low' ? Math.min(dpr, 0.7) : q === 'medium' ? Math.min(dpr, 1) : Math.min(dpr, 2);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    viewmodel.resize(camera.aspect);
    world.setQuality(q);
    effects.setLowQuality(q === 'low');
    document.querySelectorAll('#setQuality button').forEach((b) => b.classList.toggle('on', b.dataset.q === q));
  }
  window.addEventListener('resize', applyQuality);

  // ------------------------------------------------------------ settings panel
  function syncSettingsUi() {
    $('setSens').value = settings.sensitivity;
    $('outSens').textContent = settings.sensitivity.toFixed(2);
    $('setFov').value = settings.fov;
    $('outFov').textContent = settings.fov;
    $('setVol').value = settings.volume;
    $('outVol').textContent = settings.volume + '%';
  }
  $('setSens').addEventListener('input', (e) => { settings.sensitivity = parseFloat(e.target.value); syncSettingsUi(); saveSettings(settings); });
  $('setFov').addEventListener('input', (e) => { settings.fov = parseInt(e.target.value, 10); syncSettingsUi(); saveSettings(settings); });
  $('setVol').addEventListener('input', (e) => {
    settings.volume = parseInt(e.target.value, 10);
    sfx.setVolume(settings.volume);
    syncSettingsUi();
    saveSettings(settings);
  });
  $('setVol').addEventListener('change', () => { sfx.ensure(); sfx.click(); });
  document.querySelectorAll('#setQuality button').forEach((b) => {
    b.addEventListener('click', () => {
      settings.quality = b.dataset.q;
      applyQuality();
      saveSettings(settings);
      sfx.ensure();
      sfx.click();
    });
  });
  syncSettingsUi();
  applyQuality();

  // ------------------------------------------------------------ game state
  const spawns = map.spawns;
  let spawnIndex = 0;
  const me = {
    phys: P.newPlayer(spawns[0].x, spawns[0].y, spawns[0].z),
    weapon: C.newWeaponState(settings.loadout),
  };
  const player = me.phys;          // shortcut (the objects are never replaced, only updated)
  const ws = me.weapon;            // ammo, reload, aim and bloom (shared with the server)
  const prev = { x: player.x, y: player.y, z: player.z };
  let yaw = spawns[0].yaw;
  let pitch = 0;
  let acc = 0;
  let alpha = 0;

  const keys = {};
  const mouse = { left: false, right: false };
  let playing = false;                    // pointer is captured and the game has the keyboard
  let mode = 'menu';                      // 'menu' | 'solo' (practice) | 'online'
  let online = null;                      // set while connected to a server

  const MAX_HEALTH = C.MAX_HEALTH;
  let health = MAX_HEALTH;                // practice mode health (online health comes from the server)
  const soloSalt = (Math.random() * 0x7fffffff) | 0;

  // These look like plain numbers to the rest of the code but live in the weapon state.
  const ammo = {
    get mag() { return ws.slots[ws.cur].mag; }, set mag(v) { ws.slots[ws.cur].mag = v; },
    get reserve() { return ws.slots[ws.cur].reserve; }, set reserve(v) { ws.slots[ws.cur].reserve = v; },
  };

  let lastShotTime = -10;
  let triggerFresh = false;     // true right after a click (used by semi-automatic guns)
  let clickPending = false;     // a click that has not been handled yet (so very quick clicks still fire)
  let reloadPressed = false;
  let slotRequest = -1;         // weapon slot asked for by a key or the mouse wheel (sent with the next command)
  let quickPressed = false;     // V: quick knife
  let reloadTotal = 0;          // seconds the current reload will take in all
  let grenadeHeld = false;      // G is down: showing the throw arc
  let throwPressed = false;     // G was released: throw in the next command
  let soloSim = new G.Sim(mapBoxes);   // grenades in practice mode (online, the server does this)
  let abilityPressed = false;          // the ability key was pressed: use it in the next command
  let soloWorld = new Abil.World(mapBoxes);    // domes, mines and strikes in practice mode
  let soloAbil = Abil.newState();      // timed ability effects on you in practice mode (the server keeps them online)
  let speedFx = 0, fovKick = 0;        // dash screen effects
  let flashLeft = 0, flashTotal = 0;   // blinded by a flashbang
  let shakeAmt = 0;                    // camera shake from nearby explosions
  function addShake(a) { shakeAmt = Math.min(1.2, shakeAmt + a); }
  function flashScreen(seconds) {
    if (seconds <= 0) return;
    flashTotal = Math.max(seconds, flashLeft); flashLeft = flashTotal;
    sfx.ring(seconds * 1.3);
  }
  const distToCamera = (x, y, z) => Math.hypot(x - camera.position.x, y - camera.position.y, z - camera.position.z);
  let sprintEff = false;
  let recoilDebt = 0;           // how far the recoil has pushed the view up (radians)
  let recoilQ = 0, recoilYawQ = 0, recoilDrift = 0;   // recoil waiting to be applied smoothly over the next few frames

  let eyeH = P.C.EYE;
  let stepOffset = 0;           // smooths the camera when stepping up stairs
  let landDip = 0;
  let stepDist = 0;
  let sprintT = 0;
  let deadRoll = 0;
  const viewOff = { x: 0, y: 0, z: 0 };   // hides small corrections from the server
  let lookX = 0, lookY = 0;     // how far the view turned this frame, for gun sway

  // ------------------------------------------------------------ small helpers
  const _from = new THREE.Vector3();
  const _to = new THREE.Vector3();
  const _pt = new THREE.Vector3();
  const _nor = new THREE.Vector3();
  const _proj = new THREE.Vector3();
  const _dir = new THREE.Vector3();

  const now = () => performance.now() / 1000;
  const reloadProgress = () => {
    if (!ws.reloading) return -1;
    const slot = ws.slots[ws.cur];
    if (wpn.reloadMode === 'shell') {
      const remaining = Math.min(wpn.mag - slot.mag, slot.reserve);
      const left = Math.max(0, remaining - 1) * wpn.shellTime + ws.reloadLeft;
      return clamp(1 - left / Math.max(reloadTotal, left, 0.001), 0, 1);
    }
    return clamp(1 - ws.reloadLeft / wpn.reloadTime, 0, 1);
  };

  /** Keeps the viewmodel, weapon name and slot bar in step with the weapon in hand. */
  let shownWeaponKey = '';
  function syncWeaponUi() {
    wpn = C.curWeapon(ws);
    const key = ws.ids.join(',') + ':' + ws.cur + ':' + ws.grenade;
    if (key === shownWeaponKey) return;
    shownWeaponKey = key;
    viewmodel.setWeapon(wpn, rarityOf(wpn));
    viewmodel.setGrenade(Weapons.grenade(ws.grenade));
    hud.setWeapon(wpn.name, rarityOf(wpn));
    hud.setSlots(ws.ids.map((id, i) => { const w = Weapons.get(id); return { name: w.shortName || w.name, color: rarityOf(w), key: keyName(binds.get('slot' + (i + 1))) }; }), ws.cur);
  }
  const isMetal = (kind) => kind === 'container' || kind === 'platform' || kind === 'rail' || kind === 'post' || kind === 'stair';

  function releaseInputs() {
    for (const k of Object.keys(keys)) keys[k] = false;
    mouse.left = mouse.right = false;
    clickPending = false;
    triggerFresh = false;
    sprintEff = false;
    slotRequest = -1;
    quickPressed = false;
    grenadeHeld = false;
    throwPressed = false;
    abilityPressed = false;
  }

  function refreshMenu() {
    const on = mode === 'online';
    $('joinBtn').textContent = on ? 'Resume' : 'Join game';
    $('playBtn').textContent = mode === 'solo' ? 'Resume practice' : 'Practice alone';
    $('playBtn').classList.toggle('hidden', on);
    $('leaveBtn').classList.toggle('hidden', !on);
    $('nameInput').classList.toggle('hidden', on);
    $('joinBtn').disabled = false;
    $('playBtn').disabled = false;
    $('loadoutBtn').disabled = false;
  }

  function setPlaying(on) {
    playing = on;
    if (on && mode === 'menu') mode = 'solo';
    $('overlay').classList.toggle('hidden', on);
    hud.show(on);
    if (!on) {
      releaseInputs();
      if (mode === 'solo') { ws.reloading = false; ws.reloadLeft = 0; cancelReload(); }   // pausing cancels a reload
      refreshMenu();
    }
  }

  function showMenuMessage(text) {
    const box = $('loadError');
    box.textContent = text || '';
    box.classList.toggle('hidden', !text);
  }

  // ------------------------------------------------------------ health (practice mode)
  function respawnPlayer() {
    spawnIndex = (spawnIndex + 1 + Math.floor(Math.random() * (spawns.length - 1))) % spawns.length;
    const sp = spawns[spawnIndex];
    Object.assign(player, P.newPlayer(sp.x, sp.y, sp.z));
    prev.x = player.x; prev.y = player.y; prev.z = player.z;
    yaw = sp.yaw; pitch = 0; recoilDebt = 0; recoilQ = 0; recoilYawQ = 0; recoilDrift = 0;
    health = MAX_HEALTH;
    C.copyWeaponState(C.newWeaponState(settings.loadout), ws);
    soloAbil = Abil.newState();
    soloWorld = new Abil.World(mapBoxes);
    abilityWorld.clear();
    syncWeaponUi();
    cancelReload();
  }

  function takeDamage(amount) {
    if (amount > 0) amount = Abil.mitigate(soloAbil, amount);      // Armor Plate soaks it up, damage cancels a heal
    health -= amount;
    hud.damageFlash(0.7);
    sfx.hurt();
    if (health <= 0 && ws.abl === 'secondwind' && ws.acd <= 0) {
      const sw = Weapons.ability('secondwind');
      health = sw.hp; ws.acd = sw.cd; ws.boost = sw.boostDur;     // Second Wind: survive
      sfx.ability('secondwind');
      abilityFx.ring(player.x, player.y, player.z, '#f59e0b', 5, 0.8);
      hud.feed('Second Wind saved you!', '#f59e0b', now());
    } else if (health <= 0) {
      hud.feed('You were eliminated. Respawning...', '#ef4444', now());
      respawnPlayer();
    }
    hud.setHealth(health, MAX_HEALTH);
  }

  function cancelReload() {
    sfx.cancelReload();
    hud.notice('', 0, now());
  }

  /** Practice mode: put everything back to how it is at the start. */
  function resetPractice() {
    spawnIndex = 0;
    const sp = spawns[0];
    Object.assign(player, P.newPlayer(sp.x, sp.y, sp.z));
    prev.x = player.x; prev.y = player.y; prev.z = player.z;
    yaw = sp.yaw; pitch = 0; recoilDebt = 0; recoilQ = 0; recoilYawQ = 0; recoilDrift = 0;
    health = MAX_HEALTH;
    C.copyWeaponState(C.newWeaponState(wpn), ws);
    viewOff.x = viewOff.y = viewOff.z = 0;
    deadRoll = 0;
    soloSim = new G.Sim(mapBoxes);
    grenWorld.clear();
    flashLeft = flashTotal = 0;
    cancelReload();
  }

  // ------------------------------------------------------------ shooting
  function currentSpread() {
    return C.spreadDeg(wpn, ws, { speed: Math.hypot(player.vx, player.vz), crouching: player.crouching, onGround: player.onGround });
  }

  function applyRecoil(w) {
    // The kick is not applied in one jump: it is queued and eased in over a few frames (see updateRecoil),
    // and the sideways push is a slow drift instead of a new random number every shot.
    const r = w.recoil;
    const damp = 1 - 0.35 * ws.ads;                       // aiming tames the recoil a little
    recoilQ += r.up * DEG * damp;
    recoilDrift = clamp(recoilDrift * 0.8 + (Math.random() - 0.5) * 2 * r.side * DEG * damp * 0.55, -r.side * DEG * 1.6, r.side * DEG * 1.6);
    recoilYawQ += recoilDrift;
  }

  function floaterAt(point, text, color) {
    _proj.copy(point).project(camera);
    if (_proj.z > 1) return;
    hud.floater(text, color, (_proj.x * 0.5 + 0.5) * window.innerWidth, (-_proj.y * 0.5 + 0.5) * window.innerHeight);
  }

  function wallImpact(wall, o, dir) {
    _pt.set(dir.x, dir.y, dir.z).multiplyScalar(wall.t).add(o);
    _nor.set(wall.nx, wall.ny, wall.nz);
    const kind = wall.box ? wall.box.kind : 'floor';
    effects.impact(_pt, _nor, wall.box ? wall.box.c : map.theme.ground, isMetal(kind));
    effects.hole(_pt, _nor);
  }

  /** Everything you see and hear when your gun fires (the server decides what really got hit). */
  function fireEffects(cmd, ev) {
    const t = now();
    const fw = Weapons.get(ws.ids[ev.slot]);
    lastShotTime = t;
    const eye = C.eyePos(player, cmd.yaw);           // leaning moves the eye sideways
    const eyeY = eye.y;
    const salt = online ? online.salt : soloSalt;
    const o = new THREE.Vector3(eye.x, eye.y, eye.z);
    const solo = mode === 'solo';
    const targets = online ? online.remote.targets(cmd.vt) : [];

    // Where the tracers start: the muzzle you can see
    camera.rotation.set(cmd.pitch, cmd.yaw, 0);
    camera.updateMatrixWorld(true);
    viewmodel.muzzleInCameraSpace(_from, camera.fov);
    camera.localToWorld(_from);
    const beam = fw.id === 'rail' ? 4 : 1;

    let soloDmg = 0, soloHead = false, soloKilled = false, soloPt = null, soloHits = 0;
    for (let k = 0; k < fw.pellets; k++) {
      const dir = C.shotDirection(cmd.yaw, cmd.pitch, ev.spreadDeg, salt, C.pelletSeed(ev.shotIndex, k));
      // Walls (and, online, other players as you currently see them)
      const res = C.traceShot(o.x, o.y, o.z, dir, fw.maxRange, mapBoxes, targets, fw.pierceWalls || 0, online ? online.domes : soloWorld.domes);
      let endT = res ? res.t : fw.maxRange;

      if (solo) {
        const hit = dummies.raycast(o.x, o.y, o.z, dir.x, dir.y, dir.z, endT);
        if (hit) {
          endT = hit.t;
          _pt.set(dir.x, dir.y, dir.z).multiplyScalar(hit.t).add(o);
          _nor.set(hit.nx, hit.ny, hit.nz);
          const dmg = Math.round(Weapons.damageFor(fw, hit.t, hit.head) * Abil.damageMult(soloAbil));
          const killed = dummies.damage(hit.dummy, dmg, t);
          effects.impact(_pt, _nor, hit.head ? '#f0f0f0' : '#e8772e', false);
          soloDmg += Math.min(dmg, 200); soloHead = soloHead || hit.head; soloKilled = soloKilled || killed; soloHits++;
          soloPt = soloPt || _pt.clone();
        } else if (res && res.kind === 'wall') {
          wallImpact(res, o, dir);
        }
      } else if (res) {
        if (res.kind === 'player') {
          _pt.set(dir.x, dir.y, dir.z).multiplyScalar(res.t).add(o);
          _nor.set(res.nx, res.ny, res.nz);
          effects.impact(_pt, _nor, '#b3262b', false);
        } else if (res.kind === 'dome') {
          _pt.set(dir.x, dir.y, dir.z).multiplyScalar(res.t).add(o);
          abilityWorld.ripple([_pt.x, _pt.y, _pt.z], [res.nx, res.ny, res.nz]);
        } else {
          wallImpact(res, o, dir);
        }
      }
      _to.set(dir.x, dir.y, dir.z).multiplyScalar(endT).add(o);
      effects.tracer(_from, _to, fw.tracerColor, beam);
    }

    if (soloHits) {
      hud.hitMarker(soloKilled ? 'kill' : soloHead ? 'head' : 'body');
      if (soloKilled) sfx.kill();
      else if (soloHead) sfx.headshot();
      else sfx.hitTick();
      floaterAt(soloPt, String(soloDmg), soloKilled ? '#ef4444' : soloHead ? '#ff9a3c' : '#ffffff');
      if (soloKilled) hud.feed('You > Target dummy' + (soloHead ? '  (headshot)' : ''), '#ef4444', t);
    }

    applyRecoil(fw);
    viewmodel.fire();
    sfx.shot(fw.soundClass);
    sfx.afterShot(fw.soundClass);
  }

  /** Your own melee swing: the animation and sound now, the damage is decided by the server. */
  function meleeEffects(cmd, ev) {
    const t = now();
    const fw = Weapons.get(ws.ids[ev.slot]);
    viewmodel.swing(fw.swing);
    sfx.swing(fw.id === 'blade' ? 'energy' : 'blade');
    if (mode === 'solo') {
      const eyeY = player.y + C.eyeHeight(player);
      const dir = P.forwardVector(cmd.yaw, cmd.pitch);
      const hit = dummies.raycast(player.x, eyeY, player.z, dir.x, dir.y, dir.z, fw.range + 0.45);
      if (hit) {
        _pt.set(dir.x, dir.y, dir.z).multiplyScalar(hit.t).add(_from.set(player.x, eyeY, player.z));
        const killed = dummies.damage(hit.dummy, Math.round(fw.damage * Abil.damageMult(soloAbil)), t);
        effects.impact(_pt, _nor.set(-dir.x, -dir.y, -dir.z), '#e8772e', false);
        sfx.meleeHit();
        hud.hitMarker(killed ? 'kill' : 'body');
        if (killed) { sfx.kill(); hud.feed('You > Target dummy', '#ef4444', t); }
        floaterAt(_pt, String(fw.damage), killed ? '#ef4444' : '#ffffff');
      }
    }
  }

  function handleEvents(ev, cmd) {
    const t = now();
    if (ev.reloadCancelled) { sfx.cancelReload(); hud.notice('', 0, t); }
    if (ev.switched) sfx.equip();
    if (ev.reloadStarted) {
      const slot = ws.slots[ws.cur];
      reloadTotal = wpn.reloadMode === 'shell' ? Math.min(wpn.mag - slot.mag, slot.reserve) * wpn.shellTime : wpn.reloadTime;
      sfx.reload(wpn.reloadTime, wpn.soundClass);
      hud.notice('RELOADING', reloadTotal, t);
    }
    if (ev.shellLoaded) sfx.shell();
    if (ev.reloadDone) hud.notice('', 0, t);
    if (ev.empty) { sfx.empty(); hud.notice('NO AMMO', 1.2, t); }
    if (ev.fired) fireEffects(cmd, ev);
    if (ev.swung) meleeEffects(cmd, ev);
    if ((ev.fired || ev.swung || ev.threw) && mode === 'solo') Abil.revealCloak(soloAbil);
    if (ev.ability) useAbilityEffects(ev.ability, cmd);
    if (ev.threw) {
      viewmodel.throwNow();
      sfx.throwGrenade();
      if (mode === 'solo') {
        soloSim.spawn(-1, ev.grenade, G.launch(player, cmd.yaw, cmd.pitch, C.eyeHeight(player), mapBoxes));
      }
    }
  }

  // A red grenade icon for every dangerous grenade near you (on screen, or on the edge pointing towards it)
  function updateGrenadeWarnings() {
    const items = [];
    const alive = mode === 'solo' || (!!online && online.alive);
    if (playing && alive) {
      const W = window.innerWidth, H = window.innerHeight, margin = 70;
      for (const e of grenWorld.meshes.values()) {
        const def = Weapons.grenade(e.type);
        if (def.kind === 'smoke') continue;                          // smoke cannot hurt you
        const p = e.group.position;
        const dist = distToCamera(p.x, p.y, p.z);
        const limit = e.mine ? 7 : 14;
        if (dist > limit) continue;
        if (e.mine && grenWorld.t - e.born < 1.2) continue;          // the one you just threw
        _proj.set(p.x, p.y + 0.2, p.z).project(camera);
        const behind = _proj.z > 1;
        let sx = (_proj.x * 0.5 + 0.5) * W, sy = (-_proj.y * 0.5 + 0.5) * H;
        let dx = sx - W / 2, dy = sy - H / 2;
        if (behind) { dx = -dx; dy = -dy; }
        let on = !behind && sx > margin && sx < W - margin && sy > margin && sy < H - margin - 40;
        if (!on) {
          const k = Math.min((W / 2 - margin) / Math.max(Math.abs(dx), 1e-3), (H / 2 - margin - 40) / Math.max(Math.abs(dy), 1e-3));
          sx = W / 2 + dx * k; sy = H / 2 + dy * k;
          if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) sy = H - margin;
        }
        items.push({ x: sx, y: sy, on, angle: Math.atan2(dy, dx), dist, close: dist < (def.radius || 4) + 1 });
      }
      items.sort((a, b) => a.dist - b.dist);
    }
    hud.setGrenadeWarnings(items);
  }

  /** You used your ability (predicted here; online the server confirms and everyone sees the effect). */
  function useAbilityEffects(fired, cmd) {
    sfx.ability(fired.id);
    const def = Weapons.ability(fired.id);
    if (fired.id === 'dash' || fired.id === 'airdash') { speedFx = 1; fovKick = 1; }
    if (mode === 'solo') {
      if (['heal', 'armor', 'surge', 'scan', 'cloak'].includes(fired.id)) Abil.activate(soloAbil, fired.id);
      else if (fired.id === 'shield') soloWorld.placeDome(-1, fired.target[0], fired.target[1], fired.target[2]);
      else if (fired.id === 'mine') soloWorld.placeMine(-1, fired.target[0], fired.target[1], fired.target[2]);
      else if (fired.id === 'orbital') soloWorld.markStrike(-1, fired.target[0], fired.target[1], fired.target[2]);
      abilityWorldFx(fired.id, { x: player.x, y: player.y, z: player.z }, fired.target, [player.vx, player.vz], -1);
    }
  }

  /** The world part of an ability effect: rings, streaks, ropes. who = player id (-1 for you in practice). */
  function abilityWorldFx(id, pos, target, dir, who) {
    const def = Weapons.ability(id);
    if (id === 'dash' || id === 'airdash') abilityFx.streaks(pos.x, pos.y, pos.z, dir[0], dir[1], def.color);
    else if (id === 'heal') abilityFx.pluses(pos.x, pos.y, pos.z);
    else if (id === 'scan') abilityFx.ring(pos.x, pos.y, pos.z, def.color, def.range, 0.9, 0.12);
    else if (id === 'armor') abilityFx.ring(pos.x, pos.y, pos.z, def.color, 1.8, 0.5, 0.25);
    else if (id === 'surge') abilityFx.ring(pos.x, pos.y, pos.z, def.color, 2.2, 0.6, 0.25);
    else if (id === 'shield') abilityFx.ring(target ? target[0] : pos.x, pos.y, target ? target[2] : pos.z, def.color, def.radius, 0.5, 0.15);
    else if (id === 'cloak') abilityFx.ring(pos.x, pos.y, pos.z, def.color, 2.0, 0.6, 0.2);
    else if (id === 'secondwind') { abilityFx.ring(pos.x, pos.y, pos.z, def.color, 5, 0.9, 0.3); abilityFx.pillar(pos.x, pos.y, pos.z, def.color, 0.9); }
    else if (id === 'grapple' && target) {
      const mine = who === -1 || (online && who === online.id);
      abilityFx.rope(() => {
        if (mine) return [camera.position.x + Math.cos(yaw) * 0.25, camera.position.y - 0.3, camera.position.z - Math.sin(yaw) * 0.25];
        const q = online && online.remote.get(who);
        return q ? [q.x, q.y + 1.2, q.z] : target;
      }, target, 0.9, def.color);
    }
  }

  // Practice mode: what grenades do to the dummies and to you
  function soloTargets() {
    const out = [{ id: -1, x: player.x, y: player.y, z: player.z, height: P.playerHeight(player), yaw, pitch }];
    for (const d of dummies.list) if (d.alive) out.push({ id: d.id, x: d.x, y: d.y, z: d.z, height: P.C.HEIGHT });
    return out;
  }

  function soloHurtDummy(d, dmg, t) {
    if (dmg <= 0) return;
    dmg = Math.round(dmg * Abil.damageMult(soloAbil));
    const killed = dummies.damage(d, dmg, t);
    hud.hitMarker(killed ? 'kill' : 'body');
    if (killed) { sfx.kill(); hud.feed('You > Target dummy (grenade)', '#ef4444', t); } else sfx.hitTick();
    floaterAt(_pt.set(d.x, d.y + 1.1, d.z), String(dmg), killed ? '#ef4444' : '#ffffff');
  }

  function soloGrenadeEvents(events, targets) {
    const t = now();
    for (const e of events) {
      if (e.kind === 'boom') {
        const g = e.g, def = g.def;
        const dist = distToCamera(g.x, g.y, g.z);
        grenWorld.boom(def.id, g.x, g.y, g.z, def.radius || 0, def.duration || 0, dist);
        sfx.grenadeBoom(def.kind, Math.pow(Math.max(0, 1 - dist / 80), 1.3));
        const at = { x: g.x, y: g.y, z: g.z };
        if (def.kind === 'frag' || def.kind === 'sticky') {
          for (const tg of targets) {
            const direct = !!(g.stuck && g.stuck !== 'wall' && g.stuck.id === tg.id);
            const dmg = G.blastDamage(def, at, tg, mapBoxes, direct);
            if (tg.id === -1) { if (dmg > 0) takeDamage(dmg); }
            else soloHurtDummy(dummies.list[tg.id], dmg, t);
          }
        } else if (def.kind === 'flash') {
          flashScreen(G.flashDuration(def, at, targets[0], mapBoxes));
        }
      }
    }
    for (const z of soloSim.zones) {
      if (z.kind !== 'incendiary') continue;
      for (const hit of soloSim.fireDamage(z, targets)) {
        if (hit.id === -1) takeDamage(hit.dmg); else soloHurtDummy(dummies.list[hit.id], hit.dmg, t);
      }
    }
  }

  // ------------------------------------------------------------ one simulation tick
  let allColliders = mapBoxes;

  function buildCmd() {
    if (online && online.zilla) grenadeHeld = false;
    const moveZ = (isDown('forward') ? 1 : 0) - (isDown('back') ? 1 : 0);
    const moveX = (isDown('right') ? 1 : 0) - (isDown('left') ? 1 : 0);
    const shift = isDown('sprint');
    // Melee weapons can sprint while crouched (that is what makes the bunny hop possible)
    const melee = wpn.type === 'melee';
    sprintEff = !!shift && moveZ > 0 && !mouse.right && (melee || (!isDown('crouch') && !mouse.left));
    const fire = mouse.left || clickPending;
    const cmd = {
      // angles are rounded the same way as on the wire, so the server repeats our movement exactly
      seq: 0, epoch: 0, moveX, moveZ, yaw: Math.round(yaw * 1e4) / 1e4, pitch: Math.round(pitch * 1e4) / 1e4,
      jump: isDown('jump'), crouch: isDown('crouch'), sprint: sprintEff,
      leanL: isDown('leanLeft'), leanR: isDown('leanRight'),
      aim: mouse.right, fire, fresh: fire && triggerFresh, reload: reloadPressed,
      slot: slotRequest, quick: quickPressed, throw: throwPressed, ability: abilityPressed,
    };
    clickPending = false;
    reloadPressed = false;
    slotRequest = -1;
    quickPressed = false;
    throwPressed = false;
    abilityPressed = false;
    return cmd;
  }

  function stepSimulation(dt) {
    acc += dt;
    let guard = 0;
    while (acc >= FIXED && guard++ < 8) {
      const cmd = buildCmd();
      if (online) {
        cmd.seq = ++online.seq;
        cmd.epoch = online.epoch;
        cmd.vt = online.net.serverNow() - INTERP_DELAY;
      }
      prev.x = player.x; prev.y = player.y; prev.z = player.z;
      const wasOnGround = player.onGround;
      const isZ = !!(online && online.zilla);
      const ev = (online && online.gb) ? {} : C.stepTick(me, isZ ? Zilla.maskCmd(cmd) : cmd, allColliders);       // held in his hand: no walking
      wpn = C.curWeapon(ws);
      stepOffset -= player.stepRise;

      if (player.landed > 3.5 && isZ) { sfx.zilla('step', 1); addShake(Math.min(0.9, player.landed * 0.08)); }
      else if (player.landed > 3.5) {
        sfx.land(player.landed);
        landDip = Math.min(0.1, player.landed * 0.008);
        viewmodel.landBump(Math.min(0.05, player.landed * 0.004));
      }
      if (wasOnGround && !player.onGround && player.vy > 1) sfx.jump();

      if (player.onGround) {
        const speed = Math.hypot(player.vx, player.vz);
        if (speed > 0.6) {
          stepDist += speed * FIXED;
          const every = isZ ? 3.2 : player.crouching ? 1.7 : sprintEff ? 2.5 : 1.9;
          if (stepDist >= every) {
            stepDist -= every;
            if (isZ) { sfx.zilla('step', 0.8); addShake(0.35); }
            else sfx.step(player.crouching ? 0.35 : sprintEff ? 1 : 0.7);
          }
        }
      }

      handleEvents(ev, cmd);
      syncWeaponUi();
      if (ev.fired || ev.swung || !mouse.left) triggerFresh = false;

      if (online) {
        online.pending.push(cmd);
        online.outbox.push(cmd);
        if (online.pending.length > 180) online.pending.shift();
      }
      acc -= FIXED;
    }
    if (guard >= 8) acc = 0;
    alpha = acc / FIXED;
  }

  function updateRecoil(t, dt) {
    // ease the queued recoil into the view
    if (recoilQ !== 0 || recoilYawQ !== 0) {
      const k = 1 - Math.exp(-dt * 20);
      const up = recoilQ * k, side = recoilYawQ * k;
      pitch = clamp(pitch + up, -1.5, 1.5);
      yaw += side;
      recoilDebt += up;
      recoilQ -= up; recoilYawQ -= side;
      if (Math.abs(recoilQ) < 1e-6) recoilQ = 0;
      if (Math.abs(recoilYawQ) < 1e-6) recoilYawQ = 0;
    }
    // then it settles back down once you stop firing
    if (t - lastShotTime > wpn.recoil.recoverDelay && recoilDebt > 0 && recoilQ === 0) {
      const amount = Math.min(recoilDebt, wpn.recoil.recover * 0.8 * DEG * dt);
      pitch -= amount;
      recoilDebt -= amount;
    }
    recoilDrift *= Math.exp(-dt * 6);
  }

  function updateCamera(dt) {
    const x = prev.x + (player.x - prev.x) * alpha;
    const y = prev.y + (player.y - prev.y) * alpha;
    const z = prev.z + (player.z - prev.z) * alpha;

    stepOffset *= Math.exp(-12 * dt);
    if (Math.abs(stepOffset) < 0.0005) stepOffset = 0;
    landDip *= Math.exp(-10 * dt);
    const k = Math.exp(-10 * dt);
    viewOff.x *= k; viewOff.y *= k; viewOff.z *= k;

    const dead = !!online && !online.alive;
    const targetEye = dead ? 0.35 : (online && online.zilla) ? Zilla.EYE : player.crouching ? P.C.CROUCH_EYE : P.C.EYE;
    eyeH += (targetEye - eyeH) * (1 - Math.exp(-(dead ? 6 : 14) * dt));
    deadRoll += ((dead ? 0.55 : 0) - deadRoll) * (1 - Math.exp(-6 * dt));

    const lean = player.lean || 0;
    const lsh = P.leanShift(yaw, lean);
    camera.position.set(x + viewOff.x + lsh.x, y + eyeH + stepOffset - landDip + viewOff.y - 0.05 * Math.abs(lean), z + viewOff.z + lsh.z);
    camera.rotation.set(pitch, yaw, deadRoll - lean * 0.2);
    if (shakeAmt > 0.01) {
      shakeAmt *= Math.exp(-5 * dt);
      camera.rotation.x += (Math.random() - 0.5) * shakeAmt * 0.06;
      camera.rotation.y += (Math.random() - 0.5) * shakeAmt * 0.06;
      camera.position.y += (Math.random() - 0.5) * shakeAmt * 0.05;
    } else shakeAmt = 0;

    const ease = ws.ads * ws.ads * (3 - 2 * ws.ads);
    const fov = lerp(settings.fov, settings.fov * wpn.adsFov, ease) + fovKick * 9;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  // ------------------------------------------------------------ online play
  function nameOf(id) {
    if (online && id === online.id) return 'You';
    const p = online && online.names.get(id);
    return p ? p.name : 'Someone';
  }

  function startOnline(name) {
    mode = 'online';
    dummies.setActive(false);
    showMenuMessage('');
    const remote = new RemotePlayers(world.scene, Weapons);
    const net = new Net({
      message: (m) => onNetMessage(m),
      close: (reason) => endOnline(reason),
    });
    online = {
      net, remote, ready: false, alive: true, ab: Abil.newState(), domes: [],
      id: 0, slot: 0, salt: 0, epoch: 1, seq: 0, zilla: false, zl: null, gb: 0, zflags: 0,
      pending: [], outbox: [], names: new Map(),
      hp: MAX_HEALTH, kills: 0, deaths: 0, respawnLeft: 0, killedBy: '',
      invuln: 0, sbSig: '',
    };
    hud.setNetNote('Connecting...');
    hud.setKD('');
    refreshMenu();
    const mine = online;
    net.connect(name, settings.loadout).catch((e) => { if (online === mine) endOnline(e.message); });
    setTimeout(() => {
      if (online === mine && !mine.ready) endOnline('The server did not answer. Check that it is running and try again.');
    }, 8000);
  }

  function endOnline(message) {
    if (!online) return;
    const o = online;
    online = null;
    o.net.close();
    o.remote.clear();
    grenWorld.clear();
    abilityFx.clear();
    abilityWorld.clear();
    zfx.clear();
    hud.setZilla(null); hud.setBoss(null); zUiOn = false;
    zview.root.visible = false; viewmodel.root.visible = true;
    mode = 'menu';
    dummies.setActive(true);
    resetPractice();
    hud.setDeath(null);
    hud.setNetNote('');
    hud.setKD('');
    hud.showScoreboard(false);
    hud.notice('', 0, now());
    if (document.pointerLockElement) document.exitPointerLock();
    setPlaying(false);
    showMenuMessage(message || '');
    $('playHint').textContent = 'Join the room to play with friends (up to 4 players), or practice alone on the shooting range.';
    refreshMenu();
  }

  function physFrom(p) {
    return { x: p.x, y: p.y, z: p.z, vx: p.vx, vy: p.vy, vz: p.vz, onGround: !!p.g, crouching: !!p.c, jumpLatch: !!p.j, lean: p.ln || 0,
      dashT: p.dt || 0, dvx: p.dx || 0, dvz: p.dz || 0, dashLift: !!p.dl, gT: p.gt || 0, gx: p.gx || 0, gy: p.gy || 0, gz: p.gz || 0 };
  }
  /** Copies the server's weapon state (and loadout) onto ours. */
  function weaponFrom(y) {
    C.copyWeaponState(C.newWeaponState(y.lo || settings.loadout), ws);
    C.applyWeaponPacket(y.wp, ws);
  }

  /** The server says you respawned (or this is the first state): start fresh from its numbers. */
  function hardReset(y, self) {
    const o = online;
    o.epoch = y.ep;
    o.pending.length = 0;
    o.outbox.length = 0;
    o.alive = true;
    if (y.ab) Abil.unpack(y.ab, o.ab);
    C.copyPhysState(physFrom(y.ph), player);
    weaponFrom(y);
    syncWeaponUi();
    prev.x = player.x; prev.y = player.y; prev.z = player.z;
    viewOff.x = viewOff.y = viewOff.z = 0;
    if (self) { yaw = self.a; pitch = self.b; }
    recoilDebt = 0; recoilQ = 0; recoilYawQ = 0; recoilDrift = 0;
    sfx.cancelReload();
    hud.notice('', 0, now());
    hud.setDeath(null);
    clickPending = false; triggerFresh = false; reloadPressed = false; grenadeHeld = false; throwPressed = false;
  }

  /** Compare the server's state with what we predicted, and quietly fix any difference. */
  function reconcile(y) {
    const o = online;
    o.hp = y.hp;
    if (y.ab) Abil.unpack(y.ab, o.ab);
    o.invuln = y.inv;
    if (!y.al) { o.alive = false; o.respawnLeft = y.rt / 1000; return; }
    if (!o.alive) return;
    while (o.pending.length && o.pending[0].seq <= y.ack) o.pending.shift();

    const ox = player.x, oy = player.y, oz = player.z;
    C.copyPhysState(physFrom(y.ph), player);
    C.applyWeaponPacket(y.wp, ws);
    if (!y.gb) for (let i = 0; i < o.pending.length; i++) C.stepTick(me, o.zilla ? Zilla.maskCmd(o.pending[i]) : o.pending[i], mapBoxes);
    syncWeaponUi();

    const ex = ox - player.x, ey = oy - player.y, ez = oz - player.z;
    const err = Math.hypot(ex, ey, ez);
    o.lastError = err;
    if (err > 3) {                       // way off (for example teleported): just jump there
      prev.x = player.x; prev.y = player.y; prev.z = player.z;
      viewOff.x = viewOff.y = viewOff.z = 0;
    } else if (err > 1e-5) {             // small difference: slide the view over it
      prev.x -= ex; prev.y -= ey; prev.z -= ez;
      viewOff.x += ex; viewOff.y += ey; viewOff.z += ez;
    }
  }

  function updateScoreboard(list) {
    const o = online;
    const sig = list.map((e) => e.i + ':' + e.k + ':' + e.d).join(',') + '|' + o.names.size;
    if (sig === o.sbSig) return;
    o.sbSig = sig;
    const rows = list.map((e) => {
      const n = o.names.get(e.i);
      return { name: e.i === o.id ? (n ? n.name : 'You') : (n ? n.name : '?'), kills: e.k, deaths: e.d, color: SLOT_COLORS[(n ? n.slot : 0) % SLOT_COLORS.length], me: e.i === o.id };
    });
    rows.sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    hud.setScoreboard(rows);
    const mineRow = list.find((e) => e.i === o.id);
    if (mineRow) { o.kills = mineRow.k; o.deaths = mineRow.d; hud.setKD('KILLS ' + mineRow.k + '   DEATHS ' + mineRow.d); }
  }

  function onNetMessage(m) {
    const o = online;
    if (!o) return;
    const t = now();
    switch (m.t) {
      case 'welcome': {
        o.id = m.id; o.slot = m.slot; o.salt = m.salt; o.epoch = m.epoch; o.zilla = !!m.z;
        o.names.set(m.id, { name: m.name, slot: m.slot });
        for (const q of m.players) { o.names.set(q.id, { name: q.name, slot: q.slot }); o.remote.add(q.id, q.name, q.slot, q.lo, q.z); }
        Object.assign(player, P.newPlayer(m.spawn.x, m.spawn.y, m.spawn.z));
        prev.x = player.x; prev.y = player.y; prev.z = player.z;
        yaw = m.spawn.yaw; pitch = 0; recoilDebt = 0; recoilQ = 0; recoilYawQ = 0; recoilDrift = 0;
        C.copyWeaponState(C.newWeaponState(m.lo || settings.loadout), ws);
        syncWeaponUi();
        o.ready = true;
        hud.setNetNote('');
        hud.feed(m.z ? 'You are GODZILLA' : 'Joined as ' + m.name, m.z ? '#ef4444' : '#4ade80', t);
        if (m.z) sfx.zilla('roar', 1);
        break;
      }
      case 'join':
        o.names.set(m.id, { name: m.name, slot: m.slot });
        o.remote.add(m.id, m.name, m.slot, m.lo, m.z);
        hud.feed(m.z ? m.name + ' joined. Run!' : m.name + ' joined', m.z ? '#ef4444' : '#4ade80', t);
        if (m.z) sfx.zilla('roar', 0.7);
        break;
      case 'leave': {
        const n = o.names.get(m.id);
        o.remote.remove(m.id);
        o.names.delete(m.id);
        if (n) hud.feed(n.name + ' left', '#8b93a1', t);
        break;
      }
      case 'snap': {
        o.domes = (m.ds || []).map((d) => ({ id: d[0], owner: d[1], x: d[2], y: d[3], z: d[4], r: d[5], left: d[6] }));
        abilityWorld.syncDomes(o.domes);
        abilityWorld.syncMines((m.mn || []).map((q) => ({ id: q[0], owner: q[1], x: q[2], y: q[3], z: q[4], armed: q[5] })), o.id);
        abilityWorld.syncStrikes((m.sk || []).map((q) => ({ id: q[0], owner: q[1], x: q[2], y: q[3], z: q[4], left: q[5] })));
        if (m.g) grenWorld.sync(m.g.map((q) => ({ id: q[0], type: Weapons.GRENADE_ORDER[q[1]] || 'frag', x: q[2], y: q[3], z: q[4], stuck: q[5], mine: q[6] === o.id })), true);
        for (const e of m.p) if (e.i !== o.id) o.remote.push(m.st, e);
        updateScoreboard(m.p);
        if (!o.ready) break;
        const self = m.p.find((e) => e.i === o.id);
        o.zl = m.you.zl || null; o.gb = m.you.gb || 0; o.zflags = self ? self.f || 0 : 0;
        if (m.you.ep !== o.epoch) { hardReset(m.you, self); if (o.zilla) sfx.zilla('roar', 0.8); }
        else reconcile(m.you);
        break;
      }
      case 'lo':
        o.remote.setLoadout(m.id, m.lo);
        break;
      case 'thr': {
        const q = o.remote.get(m.id);
        if (q) sfx.throwGrenade(Math.pow(Math.max(0, 1 - Math.hypot(q.x - camera.position.x, q.z - camera.position.z) / 40), 1.5));
        break;
      }
      case 'boom': {
        const dist = distToCamera(m.p[0], m.p[1], m.p[2]);
        const kind = Weapons.grenade(m.k).kind;
        grenWorld.boom(m.k, m.p[0], m.p[1], m.p[2], m.r, m.d, dist);
        sfx.grenadeBoom(kind, Math.pow(Math.max(0, 1 - dist / 80), 1.3));
        break;
      }
      case 'flash':
        flashScreen(m.d);
        break;
      case 'mine': {
        abilityWorld.mineBoom(m.p[0], m.p[1], m.p[2]);
        const dist = distToCamera(m.p[0], m.p[1], m.p[2]);
        sfx.grenadeBoom('frag', Math.pow(Math.max(0, 1 - dist / 70), 1.3));
        break;
      }
      case 'orb': {
        const dist = distToCamera(m.p[0], m.p[1], m.p[2]);
        abilityWorld.strikeBoom(m.p[0], m.p[1], m.p[2], m.r, dist);
        sfx.grenadeBoom('frag', Math.min(1.4, 1.6 * Math.pow(Math.max(0, 1 - dist / 120), 1.2)));
        break;
      }
      case 'abl': {
        const who = m.i;
        const mine = who === o.id;
        const pos = { x: m.p[0], y: m.p[1], z: m.p[2] };
        if (!mine || m.a === 'secondwind') {
          const dist = distToCamera(pos.x, pos.y, pos.z);
          sfx.ability(m.a, mine ? 1 : Math.pow(Math.max(0, 1 - dist / 40), 1.5));
        }
        if (mine && m.a === 'secondwind') { flashScreen(0.35); hud.feed('Second Wind saved you!', '#f59e0b', t); }
        if (!mine && m.a === 'secondwind') hud.feed(nameOf(who) + ' survived with Second Wind', '#f59e0b', t);
        abilityWorldFx(m.a, pos, m.tg, m.d || [0, 0], who);
        break;
      }
      case 'shot': {
        const fw = Weapons.exists(m.w) ? Weapons.get(m.w) : Weapons.get('ar7');
        const beam = fw.id === 'rail' ? 4 : 1;
        for (const pel of m.p) {
          const dx = pel.e[0] - m.o[0], dy = pel.e[1] - m.o[1], dz = pel.e[2] - m.o[2];
          const len = Math.hypot(dx, dy, dz) || 1;
          _from.set(m.o[0] + dx / len * 0.7, m.o[1] - 0.2 + dy / len * 0.7, m.o[2] + dz / len * 0.7);
          _to.set(pel.e[0], pel.e[1], pel.e[2]);
          effects.tracer(_from, _to, fw.tracerColor, beam);
          if (pel.k === 1 || pel.k === 2) {
            _nor.set(pel.n[0], pel.n[1], pel.n[2]);
            const box = pel.b >= 0 ? map.boxes[pel.b] : null;
            effects.impact(_to, _nor, box ? box.c : map.theme.ground, pel.k === 1);
            effects.hole(_to, _nor);
          } else if (pel.k === 4) {
            abilityWorld.ripple([pel.e[0], pel.e[1], pel.e[2]], [pel.n[0], pel.n[1], pel.n[2]]);
          } else if (pel.k === 3) {
            _nor.set(pel.n[0], pel.n[1], pel.n[2]);
            effects.impact(_to, _nor, '#b3262b', false);
          }
        }
        const dist = Math.hypot(m.o[0] - camera.position.x, m.o[1] - camera.position.y, m.o[2] - camera.position.z);
        const gain = Math.pow(Math.max(0, 1 - dist / 70), 1.5) * 0.85;
        sfx.shot(fw.soundClass, gain);
        break;
      }
      case 'swing': {
        o.remote.swing(m.id);
        const q = o.remote.get(m.id);
        const fw = Weapons.exists(m.w) ? Weapons.get(m.w) : Weapons.get('knife');
        if (q) {
          const dist = Math.hypot(q.x - camera.position.x, q.z - camera.position.z);
          const gain = Math.pow(Math.max(0, 1 - dist / 35), 1.5);
          sfx.swing(fw.id === 'blade' ? 'energy' : 'blade', gain);
          if (m.h) sfx.meleeHit(gain);
        }
        break;
      }
      case 'hit': {
        hud.hitMarker(m.k ? 'kill' : m.h ? 'head' : 'body');
        if (m.bs) { sfx.backstab(); hud.notice('BACKSTAB', 1.0, t); }
        else if (m.m) sfx.meleeHit();
        if (m.k) sfx.kill(); else if (m.h) sfx.headshot(); else if (!m.m) sfx.hitTick();
        _pt.set(m.p[0], m.p[1], m.p[2]);
        floaterAt(_pt, String(m.d), m.k ? '#ef4444' : m.h ? '#ff9a3c' : '#ffffff');
        o.remote.flash(m.v);
        break;
      }
      case 'dmg':
        hud.damageFlash(Math.min(1, 0.35 + m.d / 60));
        sfx.hurt();
        break;
      case 'kill': {
        const mine = m.k === o.id, died = m.v === o.id;
        const via = m.w === 'breath' ? ' (Fire)' : m.w === 'eaten' ? ' (Eaten)' : m.w === 'stomp' ? ' (Stomp)' : m.w && Weapons.grenadeExists(m.w) ? ' (' + Weapons.grenade(m.w).shortName + ')' : m.w === 'mine' ? ' (Mine)' : m.w === 'orbital' ? ' (Orbital Strike)' : '';
        const feedText = m.k === m.v ? nameOf(m.v) + ' blew themselves up' + via
          : !m.k ? nameOf(m.v) + ' was blown up' + via
          : nameOf(m.k) + ' > ' + nameOf(m.v) + via + (m.h ? '  (headshot)' : '');
        hud.feed(feedText, died ? '#ef4444' : mine ? '#4ade80' : '#8b93a1', t);
        if (died) {
          o.alive = false;
          o.killedBy = m.k === m.v ? 'your own ' + (m.w === 'orbital' ? 'strike' : m.w === 'mine' ? 'mine' : 'grenade') : m.k ? nameOf(m.k) : 'an explosion';
          o.respawnLeft = C.RESPAWN_TIME;
          sfx.cancelReload();
          hud.notice('', 0, t);
          releaseInputs();
        }
        break;
      }
      case 'zil': {
        const gp = o.remote.get(m.z);
        const px = m.p ? m.p[0] : (m.z === o.id ? player.x : gp ? gp.x : 0), pz = m.p ? m.p[2] : (m.z === o.id ? player.z : gp ? gp.z : 0);
        const dist = Math.hypot(px - camera.position.x, pz - camera.position.z);
        const gain = Math.pow(Math.max(0, 1 - dist / 70), 1.3);
        const mineZ = m.z === o.id;
        const anim = (kind) => { if (mineZ) zview.trigger(kind === 'eat' ? 'bite' : kind === 'grab' ? 'whiff' : kind); else o.remote.zillaEvent(m.z, kind); };
        if (m.k === 'grab') { sfx.zilla('grab', gain); anim('grab'); hud.feed(nameOf(m.z) + ' grabbed ' + nameOf(m.v) + '!', '#f59e0b', t); if (m.v === o.id) sfx.zilla('grab', 1); }
        else if (m.k === 'whiff') { sfx.zilla('whiff', gain); anim('whiff'); }
        else if (m.k === 'stomp') { sfx.zilla('windup', gain); anim('stomp'); }
        else if (m.k === 'quake') {
          sfx.zilla('stomp', gain); anim('quake');
          zfx.quake(m.p[0], m.p[1], m.p[2], m.r);
          addShake(Math.min(1.2, 2.2 * gain));
        } else if (m.k === 'eat') {
          sfx.zilla('chomp', Math.max(gain, m.v === o.id ? 1 : 0)); anim('eat');
          zfx.chomp(m.p[0], m.p[1] + 0.8, m.p[2]);
          hud.feed(nameOf(m.z) + ' ate ' + nameOf(m.v) + '!', '#ef4444', t);
        }
        break;
      }
      case 'error':
        endOnline(m.msg);
        break;
      default: break;
    }
  }

  function flushOutbox() {
    const o = online;
    if (!o || !o.outbox.length) return;
    if (o.net.connected) o.net.send({ t: 'cmds', c: o.outbox.map(C.packCmd) });
    o.outbox.length = 0;
  }

  // ------------------------------------------------------------ input
  function requestLock() {
    try {
      const p = canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && typeof p.catch === 'function') {
        p.catch(() => { try { canvas.requestPointerLock(); } catch (e) { /* ignored */ } });
      }
    } catch (e) {
      try { canvas.requestPointerLock(); } catch (e2) { /* ignored */ }
    }
  }

  function saveName() {
    const v = $('nameInput').value.replace(/\s+/g, ' ').trim().slice(0, 14);
    settings.name = v;
    saveSettings(settings);
    return v;
  }

  $('nameInput').value = settings.name;
  $('nameInput').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') $('joinBtn').click();
  });

  $('playBtn').addEventListener('click', () => {
    sfx.ensure();
    sfx.click();
    if (mode === 'menu') mode = 'solo';
    showMenuMessage('');
    requestLock();
  });

  $('joinBtn').addEventListener('click', () => {
    sfx.ensure();
    sfx.click();
    if (mode !== 'online') {
      if (mode === 'solo') { ws.reloading = false; ws.reloadLeft = 0; cancelReload(); }
      startOnline(saveName());
    }
    requestLock();
  });

  $('leaveBtn').addEventListener('click', () => {
    sfx.click();
    endOnline('');
  });

  document.addEventListener('pointerlockchange', () => {
    setPlaying(document.pointerLockElement === canvas);
  });
  document.addEventListener('pointerlockerror', () => {
    $('playHint').textContent = 'Your browser did not allow mouse capture. Click the button again (browsers sometimes need a second click after pressing Esc).';
  });

  document.addEventListener('mousemove', (e) => {
    if (!playing) return;
    const mx = clamp(e.movementX || 0, -250, 250);
    const my = clamp(e.movementY || 0, -250, 250);
    // Aiming makes the mouse slower in proportion to the zoom, so it feels the same
    const zoomScale = lerp(1, wpn.adsFov, ws.ads);
    const k = 0.0015 * settings.sensitivity * zoomScale;
    yaw -= mx * k;
    const dp = my * k;
    pitch = clamp(pitch - dp, -1.5, 1.5);
    if (dp > 0) recoilDebt = Math.max(0, recoilDebt - dp);   // pulling down counters recoil
    lookX += mx * k;
    lookY += dp;
  });

  // Keys and mouse buttons both go through the same bindings (a mouse button is the code "Mouse0", "Mouse2"...)
  function pressCode(code, repeat) {
    keys[code] = true;
    const action = binds.actionFor(code);
    if (action === 'fire') { if (!mouse.left) { triggerFresh = true; clickPending = true; } mouse.left = true; }
    if (action === 'aim') mouse.right = true;
    if (action === 'scoreboard' && online) hud.showScoreboard(true);
    if ((action === 'grenade' || code === 'Digit4') && !repeat) startGrenade();
    if (repeat || !action) return;
    if (action === 'ability') pressAbility();
    switch (action) {
      case 'reload': reloadPressed = true; break;
      case 'slot1': slotRequest = 0; break;
      case 'slot2': slotRequest = 1; break;
      case 'slot3': slotRequest = 2; break;
      case 'quick': quickPressed = true; break;
      case 'minimap': hud.toggleMinimap(); break;
      case 'stats': hud.toggleStats(); break;
      default: break;
    }
  }
  function releaseCode(code) {
    keys[code] = false;
    const action = binds.actionFor(code);
    if (action === 'fire') mouse.left = false;
    if (action === 'aim') mouse.right = false;
    if (action === 'scoreboard') hud.showScoreboard(false);
    if ((action === 'grenade' || code === 'Digit4') && grenadeHeld) { grenadeHeld = false; throwPressed = true; }
  }

  function pressAbility() {
    const alive = mode === 'solo' || (!!online && online.alive);
    if (!alive) return;
    const def = Weapons.ability(ws.abl);
    if (def.passive) { hud.notice('SECOND WIND WORKS BY ITSELF', 1.2, now()); return; }
    if (ws.acd > 0) { sfx.noGrenade(); hud.notice('ABILITY NOT READY', 0.9, now()); return; }
    abilityPressed = true;
  }

  function startGrenade() {
    const alive = mode === 'solo' || (!!online && online.alive);
    if (!alive) return;
    if (ws.gcount <= 0 || ws.gcd > 0.3) { sfx.noGrenade(); hud.notice(ws.gcount <= 0 ? 'NO GRENADES' : '', 1.0, now()); return; }
    grenadeHeld = true;
  }

  document.addEventListener('mousedown', (e) => {
    if (!playing) return;
    pressCode('Mouse' + e.button, false);
    e.preventDefault();
  });
  document.addEventListener('mouseup', (e) => releaseCode('Mouse' + e.button));
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // Mouse wheel cycles through the three weapons
  window.addEventListener('wheel', (e) => {
    if (!playing) return;
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 : -1;
    const base = slotRequest >= 0 ? slotRequest : ws.cur;
    slotRequest = (base + dir + 3) % 3;
  }, { passive: false });

  const BLOCKED_KEYS = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F3']);
  window.addEventListener('keydown', (e) => {
    if (!playing) return;
    if (BLOCKED_KEYS.has(e.code) || binds.actionFor(e.code)) e.preventDefault();
    pressCode(e.code, e.repeat);
    if (e.repeat) return;
    switch (e.code) {
      case 'KeyH': if (mode === 'solo') takeDamage(15); break;          // practice: test the health bar
      case 'KeyB':                                                       // practice: refill ammo
        if (mode === 'solo') {
          ws.slots.forEach((sl, i) => { const d = Weapons.get(ws.ids[i]); sl.mag = d.mag; sl.reserve = d.reserve; });
          ws.reloading = false; ws.reloadLeft = 0;
          cancelReload();
          hud.feed('Ammo refilled', '#4ade80', now());
        }
        break;
      default: break;
    }
  });
  window.addEventListener('keyup', (e) => releaseCode(e.code));
  window.addEventListener('blur', () => { releaseInputs(); hud.showScoreboard(false); });

  // ------------------------------------------------------------ keybinds panel
  buildKeybindUi($('keybinds'), binds, (t) => { $('kbNote').textContent = t || ''; });
  binds.onChange(() => { shownWeaponKey = ''; syncWeaponUi(); });

  // ------------------------------------------------------------ loadout screen
  const loadoutScreen = new LoadoutScreen({
    Weapons,
    getLoadout: () => settings.loadout,
    onChange: (lo) => {
      settings.loadout = Weapons.validateLoadout(lo);
      saveSettings(settings);
      sfx.ensure();
      sfx.click();
      if (online) {
        online.net.send({ t: 'loadout', lo: settings.loadout });
        loadoutScreen.setNote('Playing online: your new loadout is used the next time you respawn.');
      } else {
        C.copyWeaponState(C.newWeaponState(settings.loadout), ws);   // practice: switches over at once with full ammo
        syncWeaponUi();
      }
    },
    onClose: () => { sfx.click(); },
  });
  $('loadoutBtn').addEventListener('click', () => {
    sfx.ensure();
    sfx.click();
    loadoutScreen.setNote(online ? 'Playing online: a new loadout is used the next time you respawn.' : '');
    loadoutScreen.open();
  });

  dummies.onRespawn = () => { if (playing && mode === 'solo') sfx.dummyRespawn(); };

  // ------------------------------------------------------------ main loop
  let lastT = now();
  let fps = 0, fpsFrames = 0, fpsTimer = 0, frameMs = 0;
  let statsTimer = 0;
  let lastCalls = 0, lastTris = 0;

  function frame(ms) {
    requestAnimationFrame(frame);
    const t = ms / 1000;
    let dt = t - lastT;
    lastT = t;
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(dt, 0.1);

    fpsFrames++; fpsTimer += dt;
    if (fpsTimer >= 0.5) { fps = fpsFrames / fpsTimer; frameMs = 1000 * fpsTimer / fpsFrames; fpsFrames = 0; fpsTimer = 0; }

    renderer.info.reset();
    allColliders = mode === 'solo' ? mapBoxes.concat(dummies.colliders()) : mapBoxes;
    const alive = mode === 'online' ? !!online && online.alive : true;
    const simulate = mode === 'solo' ? playing : (mode === 'online' && !!online && online.ready && online.alive);
    if (simulate) stepSimulation(dt);
    else acc = 0;
    updateCamera(dt);
    if (simulate) updateRecoil(t, dt);
    flushOutbox();

    if (mode === 'solo') dummies.update(dt, t, camera, player);
    if (online) {
      online.remote.update(dt, online.net.serverNow() - INTERP_DELAY);
      if (!online.alive) {
        online.respawnLeft = Math.max(0, online.respawnLeft - dt);
        hud.setDeath({ by: online.killedBy, seconds: online.respawnLeft });
      }
    }
    effects.update(dt);

    // Grenades: your aiming arc, practice mode physics, and the effects
    if (grenadeHeld && (!playing || ws.gcount <= 0 || (online && !online.alive))) { grenadeHeld = false; }
    if (grenadeHeld) {
      const def = Weapons.grenade(ws.grenade);
      const start = G.launch(player, yaw, pitch, C.eyeHeight(player), mapBoxes);
      const hand = [camera.position.x + Math.cos(yaw) * 0.25, camera.position.y - 0.25, camera.position.z - Math.sin(yaw) * 0.25];
      grenWorld.showArc(hand, G.previewImpact(start, mapBoxes, !!def.sticky), def.radius || 3, def.color === '#4b5d3a' ? '#9fe870' : def.color);
    } else grenWorld.showArc(null);
    if (mode === 'solo' && playing) {
      const targets = soloTargets();
      soloGrenadeEvents(soloSim.step(dt, targets.slice(1).concat(targets[0])), targets);
      grenWorld.sync(soloSim.list.map((g) => ({ id: g.id, type: g.type, x: g.x, y: g.y, z: g.z, stuck: !!g.stuck, mine: g.owner === -1 })), false);
    }
    grenWorld.update(dt);
    updateGrenadeWarnings();
    abilityFx.update(dt);
    zfx.update(dt, camera.position);
    {
      // Godzilla: your own claws, the fire from your mouth, the fire from everyone else's, and the HUD
      const isZ = !!(online && online.zilla);
      zBreathSnd -= dt;
      if (isZ) {
        const alive = online.alive;
        const fl = online.zflags || 0;
        viewmodel.root.visible = false; viewmodel.grenRoot.visible = false;
        zview.root.visible = alive;
        zview.update(dt, { breathing: !!(fl & 128), holding: !!(fl & 256), speed: Math.hypot(player.vx, player.vz), air: !player.onGround });
        if ((fl & 128) && alive) {
          const f = P.forwardVector(yaw, pitch);
          _zd.set(f.x, f.y, f.z);
          _zp.set(camera.position.x + f.x * 1.6, camera.position.y + f.y * 1.6 - 0.55, camera.position.z + f.z * 1.6);
          zfx.breath(online.id, _zp, _zd, dt);
          if (zBreathSnd <= 0) { sfx.zilla('breath', 0.8); zBreathSnd = 0.33; }
        } else zfx.stopBreath(online.id);
        hud.setZilla(alive ? online.zl : null, Zilla, keyName(binds.get('ability')));
        zUiOn = true;
      } else if (zUiOn) { hud.setZilla(null); zview.root.visible = false; viewmodel.root.visible = true; zUiOn = false; }
      let boss = null;
      if (online) {
        for (const p of online.remote.map.values()) {
          if (!p.zilla) continue;
          if (p.alive) boss = p.hp || 0;
          if (p.breathing && online.remote.zillaMouth(p.id, _zp, _zd)) {
            zfx.breath(p.id, _zp, _zd, dt);
            const dist = Math.hypot(p.x - camera.position.x, p.z - camera.position.z);
            if (zBreathSnd <= 0) { sfx.zilla('breath', Math.pow(Math.max(0, 1 - dist / 60), 1.3)); zBreathSnd = 0.33; }
          } else zfx.stopBreath(p.id);
        }
        if (isZ && online.alive) boss = online.hp;
      }
      hud.setBoss(boss, Zilla.MAX_HP);
    }
    if (mode === 'solo' && playing) {
      const tg = soloTargets();
      for (const e of soloWorld.step(dt, tg)) {
        if (e.kind === 'mine') {
          abilityWorld.mineBoom(e.mine.x, e.mine.y, e.mine.z);
          sfx.grenadeBoom('frag', 0.8);
          for (const v of e.victims) { if (v.id !== -1) soloHurtDummy(dummies.list[v.id], v.dmg, now()); }
        } else if (e.kind === 'strike') {
          abilityWorld.strikeBoom(e.strike.x, e.strike.y, e.strike.z, 6, distToCamera(e.strike.x, e.strike.y, e.strike.z));
          sfx.grenadeBoom('frag', 1.2);
          for (const v of e.victims) { if (v.id === -1) takeDamage(v.dmg); else soloHurtDummy(dummies.list[v.id], v.dmg, now()); }
        }
      }
      abilityWorld.syncDomes(soloWorld.domes);
      abilityWorld.syncMines(soloWorld.mines.map((q) => ({ id: q.id, owner: q.owner, x: q.x, y: q.y, z: q.z, armed: q.age >= Weapons.ability('mine').arm })), -1);
      abilityWorld.syncStrikes(soloWorld.strikes);
    }
    abilityWorld.update(dt);

    // Abilities: practice-mode timers, scan x-ray, the HUD ring and screen effects
    const abState = mode === 'online' && online ? online.ab : soloAbil;
    if (mode === 'solo' && playing) {
      const healed = Abil.step(soloAbil, dt);
      if (healed > 0) health = Math.min(MAX_HEALTH, health + healed);
    }
    const scanning = abState.scan > 0 && alive;
    if (mode === 'online' && online) online.remote.setXray(scanning ? { x: player.x, z: player.z } : null, 30);
    dummies.setXray(mode === 'solo' && scanning ? { x: player.x, z: player.z } : null, 30);
    speedFx = Math.max(0, speedFx - dt * 3.5);
    fovKick = Math.max(0, fovKick - dt * 4);
    {
      const ad = Weapons.ability(ws.abl);
      hud.setAbility(ad, ad.color, ws.acd, keyName(binds.get('ability')));
      const chips = [];
      if (abState.armor > 0) chips.push({ text: 'ARMOR ' + Math.ceil(abState.armor), color: '#60a5fa' });
      if (abState.heal > 0) chips.push({ text: 'HEALING', color: '#4ade80' });
      if (abState.surge > 0) chips.push({ text: 'SURGE +30%', color: '#fb923c' });
      if (abState.scan > 0) chips.push({ text: 'SCAN', color: '#c084fc' });
      if (abState.cloak > 0) chips.push({ text: abState.reveal > 0 ? 'CLOAK (SEEN)' : 'CLOAKED', color: '#a78bfa' });
      if (ws.boost > 0) chips.push({ text: 'SPEED UP', color: '#f59e0b' });
      if (online && online.gb) chips.push({ text: 'GRABBED!', color: '#ef4444' });
      hud.setAbilityEffects(chips);
      hud.setAbilityScreenFx(speedFx * 0.7, abState.heal > 0 ? 0.35 + 0.15 * Math.sin(t * 6) : 0);
    }
    if (flashLeft > 0) flashLeft = Math.max(0, flashLeft - dt);
    hud.setScreenFx(flashLeft > 0 ? Math.min(1, flashLeft / (flashTotal * 0.45)) : 0, Math.min(0.92, grenWorld.smokeAt(camera.position.x, camera.position.y, camera.position.z) * 1.5));

    syncWeaponUi();
    const slotNow = ws.slots[ws.cur];
    const isMelee = wpn.type === 'melee';
    const interval = isMelee ? 0 : Weapons.shotInterval(wpn);
    const cycling = (wpn.fireMode === 'pump' || wpn.fireMode === 'bolt') && slotNow.cd > 0 ? Math.min(1, slotNow.cd / interval) : 0;
    const scoped = wpn.scope && ws.ads > 0.9;
    viewmodel.update(dt, {
      ads: ws.ads,
      sprint: sprintT,
      reload: reloadProgress(),
      shells: wpn.reloadMode === 'shell' ? Math.max(1, Math.round(reloadTotal / wpn.shellTime)) : 1,
      equip: ws.switchLeft > 0 ? Math.min(1, ws.switchLeft / Math.max(0.01, wpn.equipTime)) : 0,
      cycle: cycling,
      grenadeHeld,
      crouch: clamp((P.C.EYE - eyeH) / (P.C.EYE - P.C.CROUCH_EYE), 0, 1),
      speed: Math.min(1, Math.hypot(player.vx, player.vz) / P.C.SPRINT),
      onGround: player.onGround,
      lookX, lookY,
    });
    if (online && online.zilla) { viewmodel.root.visible = false; viewmodel.grenRoot.visible = false; }
    lookX = 0; lookY = 0;
    sprintT = clamp(sprintT + ((sprintEff ? 1 : 0) - sprintT) * Math.min(1, dt * 9), 0, 1);

    // HUD
    const spreadDeg = currentSpread();
    const pxPerRad = (window.innerHeight / 2) / Math.tan(camera.fov * DEG / 2);
    hud.setCrosshair(4 + Math.tan(spreadDeg * DEG) * pxPerRad, ws.ads > 0.5, sprintT > 0.5);
    hud.el.crosshair.style.visibility = scoped ? 'hidden' : 'visible';
    hud.el.crosshair.classList.toggle('melee', isMelee);
    hud.setScope(wpn.scope ? ws.ads : 0, wpn.id === 'rail' ? '#f59e0b' : '#ff5a4d');
    hud.setReload(ws.reloading ? reloadProgress() : null);
    {
      const gd = Weapons.grenade(ws.grenade);
      hud.setGrenade(gd.shortName, Weapons.RARITY[gd.rarity].color, ws.gcount, Weapons.GRENADE_MAX, Weapons.GRENADE_REGEN - ws.gregen, keyName(binds.get('grenade')));
    }
    hud.setAmmo(slotNow.mag, slotNow.reserve, wpn.mag, isMelee);
    hud.setHealth(mode === 'online' && online ? online.hp : health, online && online.zilla ? Zilla.MAX_HP : MAX_HEALTH);
    if (online && online.zilla) { hud.setCrosshair(8, false, false); hud.setScope(0, '#fff'); hud.el.crosshair.style.visibility = 'visible'; hud.el.crosshair.classList.remove('melee'); }
    hud.drawMinimap(player.x, player.z, yaw);
    hud.tick(dt, t);

    statsTimer += dt;
    if (statsTimer > 0.25) {
      statsTimer = 0;
      let text =
        'FPS ' + fps.toFixed(0) + '  (' + frameMs.toFixed(1) + ' ms)\n' +
        'draw calls ' + lastCalls + '  triangles ' + lastTris + '\n' +
        'x ' + player.x.toFixed(1) + '  y ' + player.y.toFixed(1) + '  z ' + player.z.toFixed(1);
      if (online) {
        text += '\nping ' + Math.round(online.net.rtt) + ' ms  players ' + (online.remote.map.size + 1) +
          '\ncorrection ' + ((online.lastError || 0) * 100).toFixed(1) + ' cm';
      }
      hud.setStats(text);
    }

    // Draw the world, then the gun on top (with a fresh depth buffer)
    renderer.clear();
    renderer.render(world.scene, camera);
    if (alive && !scoped) {
      renderer.clearDepth();
      renderer.render(viewmodel.scene, viewmodel.camera);
    }
    lastCalls = renderer.info.render.calls;
    lastTris = renderer.info.render.triangles;
  }

  syncWeaponUi();
  hud.setHealth(health, MAX_HEALTH);
  hud.setAmmo(ws.slots[0].mag, ws.slots[0].reserve, wpn.mag, false);

  // Hooks used by the automatic tests (harmless otherwise)
  window.__lpa = {
    P, C, map, player, camera, ammo, dummies, hud, sfx, renderer, world, viewmodel, effects, settings,
    keys, mouse, me, ws, Weapons, loadoutScreen, grenWorld, G, abilityFx, abilityWorld, zfx, zview, Zilla,
    get soloWorld() { return soloWorld; },
    get soloAbil() { return soloAbil; },
    get soloSim() { return soloSim; },
    get flashLeft() { return flashLeft; },
    get recoilQueue() { return recoilQ; },
    setPlaying,
    selectSlot(n) { slotRequest = n; },
    binds,
    get mode() { return mode; },
    get online() { return online; },
    get yaw() { return yaw; }, set yaw(v) { yaw = v; },
    get pitch() { return pitch; }, set pitch(v) { pitch = v; },
    get health() { return health; },
    get reloading() { return ws.reloading; },
    get wpn() { return wpn; },
    get adsT() { return ws.ads; },
    get bloom() { return ws.bloom; },
    teleport(x, y, z) { Object.assign(player, P.newPlayer(x, y, z)); prev.x = x; prev.y = y; prev.z = z; },
    startReload() { reloadPressed = true; },
    takeDamage,
  };

  refreshMenu();
  $('joinBtn').textContent = 'Join game';
  requestAnimationFrame(frame);
}

try {
  start();
  window.__lpaReady = true;
} catch (err) {
  console.error(err);
  showError(err && err.message ? err.message : String(err));
}
