// Every weapon model, built from simple boxes (no art files). The same models are used for the
// first-person view, for what other players carry, and for the 3D preview in the loadout screen.
//
// Gun-local coordinates: -Z is forward (the muzzle), +Y is up, the grip is near the origin.
import * as THREE from 'three';

// A small palette so the weapons have real colour variety instead of "dark grey everything"
const C = {
  BLACK: '#1a1c21', POLY: '#262a31', GUNMETAL: '#3c424b', MID: '#535a65', LIGHT: '#7c8591', STEEL: '#bcc4ce', CHROME: '#dfe5ec',
  TAN: '#a88f5f', DKTAN: '#6e5d3d', OLIVE: '#4d5a3a', DKOLIVE: '#34402a', WOOD: '#7a4f2e', DKWOOD: '#4a2f1b',
  BRASS: '#c9a23c', ORANGE: '#ff7a1a', RED: '#d8352a', HOLE: '#0b0c0f', WHITE: '#eceff3', PEARL: '#cfd6de',
  GLOVE: '#17181c', SLEEVE: '#46523a', CUFF: '#2c3524',
};

const mats = new Map();
function lambert(color) {
  let m = mats.get('l' + color);
  if (!m) { m = new THREE.MeshLambertMaterial({ color }); mats.set('l' + color, m); }
  return m;
}
function basic(color) {
  let m = mats.get('b' + color);
  if (!m) { m = new THREE.MeshBasicMaterial({ color, fog: false }); mats.set('b' + color, m); }
  return m;
}
function halo(color, opacity) {
  const k = 'h' + color + opacity;
  let m = mats.get(k);
  if (!m) { m = new THREE.MeshBasicMaterial({ color, fog: false, transparent: true, opacity, depthWrite: false }); mats.set(k, m); }
  return m;
}
const boxGeos = new Map();
function geo(w, h, d) {
  const k = w + ',' + h + ',' + d;
  let g = boxGeos.get(k);
  if (!g) { g = new THREE.BoxGeometry(w, h, d); boxGeos.set(k, g); }
  return g;
}

function box(w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(geo(w, h, d), lambert(color));
  m.position.set(x, y, z);
  return m;
}
/** A box that glows (ignores lighting). */
function glow(w, h, d, color, x, y, z) {
  const m = new THREE.Mesh(geo(w, h, d), basic(color));
  m.position.set(x, y, z);
  return m;
}
/** A soft see-through glow around something. */
function aura(w, h, d, color, opacity, x, y, z) {
  const m = new THREE.Mesh(geo(w, h, d), halo(color, opacity));
  m.position.set(x, y, z);
  return m;
}
/** A tube along the Z axis (scopes, barrels). */
function tube(r, len, color, x, y, z, sides = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, sides), lambert(color));
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}
function cone(r0, r1, len, color, x, y, z, sides = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, sides), lambert(color));
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}
function tilted(mesh, rx) { mesh.rotation.x = rx; return mesh; }
function add(g, ...meshes) { for (const m of meshes) g.add(m); return g; }

/** A row of small teeth (rail notches, grip ridges): n boxes spaced dz apart starting at z0. */
function teeth(g, n, w, h, d, color, x, y, z0, dz) {
  for (let i = 0; i < n; i++) g.add(box(w, h, d, color, x, y, z0 + i * dz));
}

// A box stretched between two points (forearms)
function limb(from, to, w, h, color) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  const dir = b.clone().sub(a);
  const len = dir.length();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, len), lambert(color));
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir.normalize());
  m.userData.arm = true;           // hidden while aiming
  return m;
}

function makeFlash(color, size) {
  const flash = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide, fog: false,
  });
  const p1 = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  const p2 = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
  p2.rotation.z = Math.PI / 4;
  const p3 = new THREE.Mesh(new THREE.PlaneGeometry(size * 1.5, size * 0.4), mat);
  const core = new THREE.Mesh(new THREE.BoxGeometry(size * 0.25, size * 0.25, size * 0.25), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
  flash.add(p1, p2, p3, core);
  flash.visible = false;
  return flash;
}

/** A gloved hand with knuckles and a thumb. Origin at the palm. */
function hand(parent, x, y, z, grip) {
  const h = new THREE.Group();
  h.position.set(x, y, z);
  h.add(box(0.056, 0.05, 0.075, C.GLOVE, 0, 0, 0));
  h.add(box(0.058, 0.022, 0.05, C.POLY, 0, 0.026, -0.012));                 // padded knuckles
  h.add(box(0.05, 0.016, 0.03, C.GLOVE, 0, -0.03, -0.02));                  // fingers curling under
  h.add(tilted(box(0.018, 0.02, 0.05, C.GLOVE, grip ? 0.034 : -0.034, 0.006, -0.03), 0.3));   // thumb
  parent.add(h);
  return h;
}

/** Gloves and sleeves. right/left are [x, y, z] hand positions; leftParent lets the left hand ride on a moving part. */
function addHands(g, o) {
  if (o.right) {
    const r = o.right;
    hand(g, r[0], r[1], r[2], true);
    g.add(limb([r[0], r[1] - 0.01, r[2] + 0.04], [r[0] + 0.09, r[1] - 0.17, r[2] + 0.38], 0.066, 0.064, C.SLEEVE));
    const cuffR = box(0.07, 0.07, 0.025, C.CUFF, r[0] + 0.012, r[1] - 0.022, r[2] + 0.055); cuffR.userData.arm = true; g.add(cuffR);
  }
  if (o.left) {
    const l = o.left;
    const parent = o.leftParent || g;
    const p = o.leftParent ? [0, 0, 0] : l;
    hand(parent, p[0], p[1], p[2], false);
    parent.add(limb([p[0], p[1] - 0.005, p[2] + 0.04], [p[0] - 0.1, p[1] - 0.13, p[2] + 0.46], 0.07, 0.064, C.SLEEVE));
    const cuffL = box(0.072, 0.07, 0.025, C.CUFF, p[0] - 0.012, p[1] - 0.012, p[2] + 0.06); cuffL.userData.arm = true; parent.add(cuffL);
  }
}

// ---------------------------------------------------------------------------- guns

function buildAR(c) {
  const g = new THREE.Group();
  add(g,
    box(0.062, 0.07, 0.30, C.GUNMETAL, 0, -0.005, -0.17),                    // lower receiver
    box(0.058, 0.05, 0.34, C.BLACK, 0, 0.04, -0.18),                         // upper receiver
    box(0.064, 0.016, 0.06, C.HOLE, 0, 0.04, -0.2),                          // ejection port
    box(0.018, 0.02, 0.03, C.STEEL, 0, 0.073, 0.0),                          // charging handle
    box(0.068, 0.072, 0.3, C.POLY, 0, 0.005, -0.5),                          // handguard
    box(0.012, 0.03, 0.2, c.color, 0.036, -0.012, -0.5),                     // rarity stripe
    box(0.012, 0.03, 0.2, c.color, -0.036, -0.012, -0.5),
    box(0.024, 0.024, 0.14, C.STEEL, 0, 0.012, -0.72),                       // barrel
    box(0.04, 0.04, 0.04, C.GUNMETAL, 0, 0.03, -0.655),                      // gas block
    box(0.032, 0.032, 0.07, C.BLACK, 0, 0.012, -0.8),                        // flash hider
    box(0.006, 0.04, 0.07, C.BLACK, 0.02, 0.012, -0.8),
    box(0.006, 0.04, 0.07, C.BLACK, -0.02, 0.012, -0.8),
    box(0.036, 0.04, 0.13, C.POLY, 0, 0.0, 0.05),                            // buffer tube
    box(0.05, 0.1, 0.14, C.GUNMETAL, 0, -0.02, 0.14),                        // stock
    box(0.042, 0.02, 0.1, C.DKTAN, 0, 0.04, 0.14),                           // cheek pad
    box(0.058, 0.115, 0.02, C.BLACK, 0, -0.02, 0.22),                        // butt pad
    tilted(box(0.04, 0.1, 0.05, C.POLY, 0, -0.085, -0.07), 0.3),             // pistol grip
    box(0.03, 0.012, 0.1, C.BLACK, 0, -0.045, -0.15),                        // trigger guard
    box(0.008, 0.03, 0.01, C.STEEL, 0, -0.04, -0.125),                       // trigger
    box(0.008, 0.045, 0.012, C.BLACK, -0.016, 0.068, -0.075),                // rear sight
    box(0.008, 0.045, 0.012, C.BLACK, 0.016, 0.068, -0.075),
    box(0.04, 0.012, 0.016, C.BLACK, 0, 0.048, -0.075),
    box(0.04, 0.04, 0.03, C.BLACK, 0, 0.04, -0.62),                          // front sight base
    box(0.008, 0.03, 0.008, C.STEEL, 0, 0.07, -0.62));                       // front sight post
  teeth(g, 9, 0.024, 0.008, 0.012, C.MID, 0, 0.068, -0.3, 0.03);             // top rail
  teeth(g, 4, 0.07, 0.02, 0.035, C.HOLE, 0, 0.005, -0.4, 0.06);              // handguard vents
  const mag = new THREE.Group();
  mag.add(box(0.036, 0.13, 0.056, C.DKTAN, 0, -0.065, 0));
  teeth(mag, 4, 0.038, 0.008, 0.058, C.BLACK, 0, -0.03, 0, 0.03);
  mag.add(box(0.04, 0.012, 0.06, c.color, 0, -0.134, 0));
  mag.position.set(0, -0.04, -0.23);
  mag.rotation.x = -0.12;
  g.add(mag);
  return { g, sightY: 0.08, rearZ: -0.075, muzzle: [0, 0.012, -0.84], parts: { mag }, hands: { right: [0, -0.14, -0.07], left: [0, -0.075, -0.5] }, flash: ['#ffd98a', 0.14] };
}

function buildSMG(c) {
  const g = new THREE.Group();
  add(g,
    box(0.056, 0.078, 0.3, C.POLY, 0, 0, -0.15),                              // body
    box(0.05, 0.03, 0.26, C.BLACK, 0, 0.05, -0.15),                           // top cover
    box(0.062, 0.072, 0.17, C.GUNMETAL, 0, 0, -0.38),                         // shroud
    box(0.012, 0.03, 0.14, c.color, 0.034, 0, -0.38),
    box(0.012, 0.03, 0.14, c.color, -0.034, 0, -0.38),
    box(0.022, 0.022, 0.13, C.STEEL, 0, 0.006, -0.52),                        // barrel
    box(0.04, 0.04, 0.05, C.ORANGE, 0, 0.006, -0.6),                          // orange muzzle device
    box(0.014, 0.055, 0.22, C.BLACK, -0.036, 0.004, 0.07),                    // folded wire stock
    box(0.014, 0.055, 0.22, C.BLACK, 0.036, 0.004, 0.07),
    box(0.086, 0.014, 0.02, C.BLACK, 0, 0.004, 0.185),
    tilted(box(0.04, 0.095, 0.052, C.BLACK, 0, -0.085, -0.04), 0.28),         // grip
    box(0.03, 0.012, 0.09, C.BLACK, 0, -0.048, -0.12),
    tilted(box(0.032, 0.09, 0.034, C.POLY, 0, -0.085, -0.37), -0.15),         // vertical foregrip
    box(0.044, 0.034, 0.075, C.BLACK, 0, 0.082, -0.12),                       // red dot housing
    box(0.036, 0.008, 0.075, C.GUNMETAL, 0, 0.102, -0.12),
    glow(0.007, 0.007, 0.004, '#ff3b30', 0, 0.082, -0.159),
    aura(0.03, 0.026, 0.004, '#9be8ff', 0.25, 0, 0.082, -0.158));
  teeth(g, 7, 0.052, 0.008, 0.012, C.MID, 0, 0.066, -0.06, -0.03);
  const mag = new THREE.Group();
  mag.add(box(0.034, 0.17, 0.05, C.GUNMETAL, 0, -0.085, 0));
  for (let i = 0; i < 5; i++) mag.add(box(0.036, 0.008, 0.052, C.BLACK, 0, -0.03 - i * 0.03, 0));
  mag.add(box(0.038, 0.014, 0.054, C.ORANGE, 0, -0.17, 0));
  mag.position.set(0, -0.035, -0.19);
  g.add(mag);
  return { g, sightY: 0.075, rearZ: -0.12, muzzle: [0, 0.006, -0.64], parts: { mag }, hands: { right: [0, -0.14, -0.04], left: [0, -0.085, -0.37] }, flash: ['#ffd98a', 0.11], hip: { p: [0.14, -0.16, -0.36], r: [0, 0.03, 0] } };
}

function buildShotgun(c) {
  const g = new THREE.Group();
  add(g,
    box(0.062, 0.088, 0.3, C.GUNMETAL, 0, 0, -0.15),                          // receiver
    box(0.064, 0.02, 0.07, C.HOLE, 0, 0.03, -0.13),                           // ejection port
    box(0.012, 0.032, 0.18, c.color, 0.036, 0, -0.15),
    box(0.03, 0.03, 0.64, C.STEEL, 0, 0.024, -0.62),                          // barrel
    box(0.036, 0.036, 0.52, C.MID, 0, -0.024, -0.58),                         // magazine tube
    box(0.044, 0.044, 0.025, C.GUNMETAL, 0, -0.024, -0.84),                   // tube cap
    box(0.04, 0.04, 0.03, C.BLACK, 0, 0.024, -0.945),                         // muzzle
    box(0.012, 0.024, 0.012, C.BRASS, 0, 0.056, -0.9),                        // brass bead sight
    box(0.036, 0.01, 0.34, C.MID, 0, 0.044, -0.62),                           // vent rib
    box(0.054, 0.11, 0.3, C.WOOD, 0, -0.028, 0.17),                           // wooden stock
    box(0.05, 0.03, 0.2, C.DKWOOD, 0, 0.04, 0.2),                             // comb
    box(0.058, 0.12, 0.022, C.BLACK, 0, -0.028, 0.33),                        // recoil pad
    tilted(box(0.04, 0.09, 0.05, C.WOOD, 0, -0.08, -0.04), 0.3),
    box(0.03, 0.012, 0.1, C.BLACK, 0, -0.05, -0.11),
    box(0.03, 0.012, 0.014, C.BLACK, 0, 0.05, -0.04));                        // rear notch
  for (let i = 0; i < 3; i++) g.add(box(0.012, 0.03, 0.026, C.RED, 0.034, -0.03, 0.05 + i * 0.045));   // spare shells on the stock
  const pump = new THREE.Group();
  pump.add(box(0.068, 0.056, 0.21, C.DKWOOD, 0, 0, 0));
  teeth(pump, 5, 0.072, 0.012, 0.014, C.BLACK, 0, 0, -0.08, 0.04);
  pump.position.set(0, -0.045, -0.52);
  g.add(pump);
  return { g, sightY: 0.056, rearZ: -0.04, muzzle: [0, 0.024, -0.97], parts: { pump }, hands: { right: [0, -0.14, -0.06], left: [0, -0.045, -0.52], leftParent: pump }, flash: ['#ffcf7a', 0.2], hip: { p: [0.15, -0.17, -0.38], r: [0, 0.03, 0] } };
}

function buildLMG(c) {
  const g = new THREE.Group();
  add(g,
    box(0.082, 0.112, 0.44, C.GUNMETAL, 0, 0, -0.22),                         // receiver
    box(0.074, 0.03, 0.34, C.DKTAN, 0, 0.07, -0.2),                           // top cover
    box(0.014, 0.04, 0.3, c.color, 0.046, 0, -0.22),
    box(0.014, 0.04, 0.3, c.color, -0.046, 0, -0.22),
    box(0.072, 0.082, 0.34, C.POLY, 0, 0, -0.62),                             // heat shroud
    box(0.03, 0.03, 0.2, C.STEEL, 0, 0.005, -0.88),                           // barrel
    box(0.054, 0.054, 0.08, C.BLACK, 0, 0.005, -1.0),                         // flash hider
    box(0.012, 0.06, 0.08, C.BLACK, 0.034, 0.005, -1.0),
    box(0.012, 0.06, 0.08, C.BLACK, -0.034, 0.005, -1.0),
    box(0.012, 0.012, 0.22, C.GUNMETAL, -0.034, -0.07, -0.76),                // folded bipod legs
    box(0.012, 0.012, 0.22, C.GUNMETAL, 0.034, -0.07, -0.76),
    box(0.062, 0.115, 0.26, C.POLY, 0, -0.012, 0.17),                         // stock
    box(0.068, 0.125, 0.022, C.BLACK, 0, -0.012, 0.31),
    tilted(box(0.046, 0.1, 0.056, C.BLACK, 0, -0.098, -0.02), 0.3),
    box(0.04, 0.02, 0.16, C.BLACK, 0, -0.07, -0.16),
    box(0.012, 0.075, 0.014, C.BLACK, -0.018, 0.108, -0.1),                   // rear sight
    box(0.012, 0.075, 0.014, C.BLACK, 0.018, 0.108, -0.1),
    box(0.012, 0.045, 0.012, C.STEEL, 0, 0.12, -0.83),                        // front sight
    box(0.044, 0.02, 0.03, C.BLACK, 0, 0.098, -0.83),
    box(0.012, 0.07, 0.1, C.BLACK, 0, 0.115, -0.3),                           // carry handle posts
    box(0.012, 0.014, 0.12, C.BLACK, 0, 0.152, -0.3));
  teeth(g, 5, 0.076, 0.02, 0.026, C.HOLE, 0, 0.012, -0.5, -0.066);            // heat shroud vents (side holes)
  const mag = new THREE.Group();                                              // ammo box with a visible belt
  mag.add(box(0.092, 0.16, 0.14, C.OLIVE, 0, -0.08, 0));
  mag.add(box(0.094, 0.014, 0.142, c.color, 0, -0.16, 0));
  teeth(mag, 6, 0.012, 0.03, 0.012, C.BRASS, 0, 0.012, -0.05, 0.02);
  mag.add(box(0.07, 0.03, 0.12, C.DKOLIVE, 0, 0.0, 0));
  mag.position.set(0, -0.05, -0.22);
  g.add(mag);
  return { g, sightY: 0.108, rearZ: -0.1, muzzle: [0, 0.005, -1.04], parts: { mag }, hands: { right: [0, -0.15, -0.02], left: [0, -0.08, -0.62] }, flash: ['#ffd98a', 0.18], hip: { p: [0.15, -0.18, -0.34], r: [0, 0.03, 0] } };
}

function buildSniper(c) {
  const g = new THREE.Group();
  add(g,
    box(0.058, 0.082, 0.34, C.DKOLIVE, 0, 0, -0.17),                          // receiver
    box(0.012, 0.03, 0.2, c.color, 0.034, 0, -0.2),
    box(0.026, 0.026, 0.62, C.STEEL, 0, 0.012, -0.65),                        // long barrel
    box(0.044, 0.044, 0.09, C.BLACK, 0, 0.012, -1.0),                         // muzzle brake
    box(0.05, 0.012, 0.012, C.HOLE, 0, 0.012, -1.0),
    box(0.012, 0.05, 0.012, C.HOLE, 0, 0.012, -0.97),
    box(0.054, 0.068, 0.3, C.OLIVE, 0, -0.01, -0.5),                          // fore-end
    box(0.056, 0.11, 0.3, C.OLIVE, 0, -0.01, 0.17),                           // stock
    box(0.044, 0.03, 0.15, C.DKOLIVE, 0, 0.055, 0.14),                        // cheek rest
    box(0.058, 0.115, 0.024, C.BLACK, 0, -0.01, 0.32),
    tilted(box(0.04, 0.1, 0.05, C.POLY, 0, -0.085, -0.03), 0.3),
    box(0.012, 0.012, 0.2, C.BLACK, -0.03, -0.065, -0.7),                     // bipod
    box(0.012, 0.012, 0.2, C.BLACK, 0.03, -0.065, -0.7),
    // scope: body, big front bell, rear eyepiece, adjustment turrets, lens glints
    tube(0.022, 0.26, C.BLACK, 0, 0.1, -0.16),
    cone(0.03, 0.022, 0.07, C.POLY, 0, 0.1, -0.325),
    cone(0.026, 0.022, 0.05, C.POLY, 0, 0.1, -0.015),
    glow(0.034, 0.034, 0.004, '#4aa3ff', 0, 0.1, -0.362),
    glow(0.022, 0.022, 0.004, '#0c2a4a', 0, 0.1, 0.012),
    box(0.02, 0.03, 0.03, C.BLACK, 0, 0.128, -0.17),                          // turret
    box(0.03, 0.02, 0.03, C.BLACK, 0.026, 0.1, -0.17),
    box(0.024, 0.05, 0.03, C.POLY, 0, 0.062, -0.1),                           // mounts
    box(0.024, 0.05, 0.03, C.POLY, 0, 0.062, -0.25));
  const mag = new THREE.Group();
  mag.add(box(0.032, 0.09, 0.05, C.POLY, 0, -0.045, 0));
  mag.position.set(0, -0.04, -0.2);
  g.add(mag);
  const bolt = new THREE.Group();
  bolt.add(box(0.06, 0.012, 0.012, C.STEEL, 0.03, 0, 0));
  bolt.add(box(0.026, 0.026, 0.026, C.CHROME, 0.066, -0.008, 0));
  bolt.position.set(0.03, 0.012, -0.06);
  g.add(bolt);
  return { g, sightY: 0.1, rearZ: -0.015, muzzle: [0, 0.012, -1.06], parts: { mag, bolt }, hands: { right: [0, -0.14, -0.03], left: [0, -0.08, -0.5] }, flash: ['#ffd98a', 0.22], hip: { p: [0.15, -0.18, -0.34], r: [0, 0.03, 0] } };
}

const MINT = '#7dffb0';
function buildNova(c) {
  const g = new THREE.Group();
  add(g,
    box(0.058, 0.076, 0.4, C.WHITE, 0, 0, -0.2),                              // shell
    box(0.06, 0.02, 0.28, c.color, 0, -0.008, -0.2),                          // red stripe
    glow(0.006, 0.014, 0.3, MINT, 0.0315, 0.022, -0.22),
    glow(0.006, 0.014, 0.3, MINT, -0.0315, 0.022, -0.22),
    box(0.064, 0.07, 0.16, C.PEARL, 0, -0.005, -0.46),
    glow(0.066, 0.01, 0.12, MINT, 0, 0.032, -0.46),
    box(0.03, 0.03, 0.14, C.GUNMETAL, 0, 0.012, -0.58),
    box(0.012, 0.06, 0.14, C.WHITE, 0.03, 0.012, -0.6),                       // emitter fins
    box(0.012, 0.06, 0.14, C.WHITE, -0.03, 0.012, -0.6),
    glow(0.044, 0.044, 0.03, MINT, 0, 0.012, -0.665),                         // glowing emitter
    aura(0.07, 0.07, 0.05, MINT, 0.22, 0, 0.012, -0.665),
    box(0.046, 0.082, 0.2, C.PEARL, 0, -0.005, 0.1),
    box(0.05, 0.09, 0.02, C.GUNMETAL, 0, -0.005, 0.21),
    tilted(box(0.04, 0.1, 0.05, C.POLY, 0, -0.085, -0.06), 0.3),
    box(0.044, 0.036, 0.075, C.GUNMETAL, 0, 0.058, -0.12),                    // holo sight
    glow(0.012, 0.012, 0.004, '#ff3b30', 0, 0.062, -0.159),
    aura(0.034, 0.03, 0.004, '#9be8ff', 0.25, 0, 0.062, -0.158));
  const mag = new THREE.Group();                                              // energy cell
  mag.add(box(0.036, 0.085, 0.062, C.GUNMETAL, 0, -0.042, 0));
  mag.add(glow(0.02, 0.06, 0.064, MINT, 0, -0.045, 0));
  mag.position.set(0, -0.037, -0.28);
  g.add(mag);
  return { g, sightY: 0.07, rearZ: -0.12, muzzle: [0, 0.012, -0.69], parts: { mag }, hands: { right: [0, -0.14, -0.06], left: [0, -0.07, -0.44] }, flash: [MINT, 0.16] };
}

function buildRail(c) {
  const g = new THREE.Group();
  const GOLD = '#e0ac45';
  add(g,
    box(0.072, 0.092, 0.5, C.GUNMETAL, 0, 0, -0.25),                          // body
    box(0.076, 0.03, 0.4, C.MID, 0, 0.05, -0.25),
    box(0.014, 0.036, 0.64, GOLD, 0.032, 0.02, -0.64),                        // the two rails
    box(0.014, 0.036, 0.64, GOLD, -0.032, 0.02, -0.64),
    glow(0.016, 0.016, 0.64, '#ffd36b', 0, 0.02, -0.64),                      // glowing core
    aura(0.05, 0.03, 0.64, '#ffb347', 0.18, 0, 0.02, -0.64),
    box(0.012, 0.03, 0.1, c.color, 0.04, -0.01, -0.12),
    box(0.012, 0.03, 0.1, c.color, -0.04, -0.01, -0.12),
    box(0.064, 0.1, 0.22, C.POLY, 0, -0.01, 0.13),
    box(0.068, 0.11, 0.022, GOLD, 0, -0.01, 0.255),
    tilted(box(0.04, 0.1, 0.05, C.POLY, 0, -0.09, -0.05), 0.3),
    box(0.034, 0.04, 0.11, C.BLACK, 0, 0.082, -0.12),                         // sight
    glow(0.02, 0.02, 0.004, '#ffd36b', 0, 0.086, -0.176),
    box(0.05, 0.05, 0.05, GOLD, 0, 0.02, -0.97));                             // muzzle coil
  for (let i = 0; i < 4; i++) g.add(box(0.092, 0.092, 0.022, GOLD, 0, 0.02, -0.42 - i * 0.16));     // coils
  const mag = new THREE.Group();
  mag.add(box(0.05, 0.1, 0.08, C.GUNMETAL, 0, -0.05, 0));
  mag.add(glow(0.03, 0.08, 0.082, '#ffd36b', 0, -0.05, 0));
  mag.position.set(0, -0.04, -0.22);
  g.add(mag);
  return { g, sightY: 0.085, rearZ: -0.14, muzzle: [0, 0.02, -1.0], parts: { mag }, hands: { right: [0, -0.15, -0.04], left: [0, -0.09, -0.5] }, flash: ['#ffd36b', 0.3], hip: { p: [0.15, -0.18, -0.34], r: [0, 0.03, 0] } };
}

function buildPistol(c) {
  const g = new THREE.Group();
  add(g,
    box(0.034, 0.034, 0.17, C.POLY, 0, -0.005, -0.08),                        // frame
    tilted(box(0.036, 0.105, 0.052, C.POLY, 0, -0.07, 0.0), 0.2),             // grip
    box(0.028, 0.014, 0.07, C.BLACK, 0, -0.032, -0.07),                       // trigger guard
    box(0.008, 0.024, 0.01, C.STEEL, 0, -0.026, -0.085),                      // trigger
    box(0.018, 0.02, 0.05, C.STEEL, 0, 0.006, -0.18));                        // barrel tip showing under the slide
  const slide = new THREE.Group();
  slide.add(box(0.036, 0.048, 0.21, C.GUNMETAL, 0, 0, 0));
  slide.add(box(0.038, 0.012, 0.11, c.color, 0, 0.0, -0.02));
  slide.add(box(0.038, 0.014, 0.04, C.HOLE, 0, 0.012, -0.03));              // ejection port
  teeth(slide, 5, 0.04, 0.036, 0.007, C.BLACK, 0, 0, 0.065, 0.014);         // rear serrations
  slide.add(box(0.008, 0.014, 0.01, C.BLACK, 0.011, 0.031, 0.095));         // rear sight posts
  slide.add(box(0.008, 0.014, 0.01, C.BLACK, -0.011, 0.031, 0.095));
  slide.add(box(0.008, 0.014, 0.01, C.CHROME, 0, 0.031, -0.098));           // front post
  slide.position.set(0, 0.03, -0.1);
  g.add(slide);
  const mag = new THREE.Group();
  mag.add(box(0.028, 0.06, 0.04, C.MID, 0, -0.03, 0));
  mag.add(box(0.034, 0.012, 0.05, c.color, 0, -0.062, 0));
  mag.position.set(0, -0.12, 0.003);
  g.add(mag);
  return { g, sightY: 0.0645, rearZ: -0.005, muzzle: [0, 0.03, -0.21], parts: { slide, mag }, slideHome: slide.position.z, hands: { right: [0, -0.1, 0.0], left: [-0.02, -0.125, 0.0] }, flash: ['#ffd98a', 0.09], hip: { p: [0.11, -0.13, -0.32], r: [0, 0.03, 0] }, sprint: { p: [0.1, -0.2, -0.28], r: [-0.3, 0.5, -0.2] } };
}

function buildMPistol(c) {
  const g = new THREE.Group();
  add(g,
    box(0.046, 0.062, 0.2, C.POLY, 0, 0, -0.1),                               // body
    box(0.042, 0.03, 0.2, C.BLACK, 0, 0.044, -0.1),                           // top
    box(0.048, 0.012, 0.08, c.color, 0, 0.0, -0.12),
    box(0.024, 0.024, 0.08, C.STEEL, 0, 0.022, -0.24),                        // barrel
    box(0.034, 0.034, 0.04, C.ORANGE, 0, 0.022, -0.29),                       // compensator
    box(0.05, 0.012, 0.02, C.HOLE, 0, 0.044, -0.26),
    tilted(box(0.036, 0.09, 0.046, C.BLACK, 0, -0.07, 0.01), 0.25),
    box(0.03, 0.012, 0.08, C.BLACK, 0, -0.04, -0.07),
    tilted(box(0.03, 0.07, 0.034, C.POLY, 0, -0.07, -0.19), -0.2),            // little foregrip
    box(0.008, 0.016, 0.01, C.BLACK, 0.013, 0.066, -0.01),
    box(0.008, 0.016, 0.01, C.BLACK, -0.013, 0.066, -0.01),
    box(0.008, 0.018, 0.01, C.CHROME, 0, 0.066, -0.2));
  teeth(g, 5, 0.05, 0.034, 0.006, C.BLACK, 0, 0.044, 0.0, 0.014);
  const mag = new THREE.Group();
  mag.add(box(0.03, 0.16, 0.04, C.GUNMETAL, 0, -0.08, 0));
  mag.add(box(0.034, 0.012, 0.044, C.ORANGE, 0, -0.16, 0));
  mag.position.set(0, -0.03, -0.06);
  g.add(mag);
  return { g, sightY: 0.075, rearZ: -0.01, muzzle: [0, 0.022, -0.31], parts: { mag }, hands: { right: [0, -0.1, 0.01], left: [-0.02, -0.12, -0.02] }, flash: ['#ffd98a', 0.1], hip: { p: [0.11, -0.13, -0.32], r: [0, 0.03, 0] }, sprint: { p: [0.1, -0.2, -0.28], r: [-0.3, 0.5, -0.2] } };
}

function buildRevolver(c) {
  const g = new THREE.Group();
  const POLISH = '#8d97a3';
  add(g,
    box(0.042, 0.074, 0.18, POLISH, 0, 0, -0.09),                             // frame
    box(0.036, 0.036, 0.32, POLISH, 0, 0.015, -0.34),                         // barrel
    box(0.016, 0.012, 0.3, C.LIGHT, 0, 0.042, -0.34),                         // rib
    box(0.03, 0.034, 0.22, C.MID, 0, -0.018, -0.29),                          // underlug
    box(0.038, 0.012, 0.1, c.color, 0, -0.03, -0.1),
    tilted(box(0.012, 0.042, 0.022, C.BLACK, 0, 0.054, 0.005), -0.4),         // hammer
    tilted(box(0.042, 0.115, 0.052, C.WOOD, 0, -0.08, 0.035), 0.35),          // wooden grip
    box(0.044, 0.014, 0.05, C.BRASS, 0, -0.14, 0.05),                         // grip cap
    box(0.026, 0.012, 0.06, C.BLACK, 0, -0.042, -0.05),
    box(0.03, 0.012, 0.012, C.BLACK, 0, 0.0525, -0.03),
    box(0.008, 0.022, 0.01, C.RED, 0, 0.056, -0.49),                          // red front sight
    box(0.03, 0.03, 0.02, C.BLACK, 0, 0.015, -0.505));                        // muzzle
  const cyl = new THREE.Group();                                              // the cylinder with six chambers
  cyl.add(box(0.054, 0.054, 0.085, C.LIGHT, 0, 0, 0));
  cyl.add(box(0.038, 0.066, 0.075, C.LIGHT, 0, 0, 0));
  cyl.add(box(0.066, 0.038, 0.075, C.LIGHT, 0, 0, 0));
  for (let i = 0; i < 6; i++) {
    const a = i * Math.PI / 3;
    cyl.add(box(0.016, 0.016, 0.004, C.HOLE, Math.cos(a) * 0.026, Math.sin(a) * 0.026, -0.043));
  }
  cyl.position.set(0, 0.005, -0.13);
  g.add(cyl);
  return { g, sightY: 0.0625, rearZ: -0.03, muzzle: [0, 0.015, -0.52], parts: { cylinder: cyl }, hands: { right: [0, -0.12, 0.035], left: [-0.02, -0.13, 0.04] }, flash: ['#ffcf7a', 0.17], hip: { p: [0.12, -0.14, -0.34], r: [0, 0.03, 0] }, sprint: { p: [0.1, -0.2, -0.28], r: [-0.3, 0.5, -0.2] } };
}

// ---------------------------------------------------------------------------- melee
// The origin is the palm. The blade points toward -Z.

function buildKnife(c) {
  const g = new THREE.Group();
  add(g,
    box(0.028, 0.032, 0.115, C.POLY, 0, 0, 0),                                // handle
    box(0.03, 0.034, 0.012, C.TAN, 0, 0, 0.03),
    box(0.03, 0.034, 0.012, C.TAN, 0, 0, -0.005),
    box(0.03, 0.034, 0.012, C.TAN, 0, 0, -0.04),
    box(0.024, 0.04, 0.02, C.BLACK, 0, 0, 0.07),                              // pommel
    box(0.012, 0.02, 0.02, c.color, 0.016, 0, 0.0),                           // rarity inlay
    box(0.046, 0.016, 0.014, C.LIGHT, 0, 0, -0.065),                          // guard
    box(0.007, 0.04, 0.18, C.STEEL, 0, 0.004, -0.16),                         // blade
    tilted(box(0.007, 0.026, 0.06, C.STEEL, 0, -0.006, -0.275), 0.18),        // tip
    box(0.009, 0.012, 0.15, C.MID, 0, 0.003, -0.165),                         // fuller (dark groove)
    box(0.009, 0.01, 0.18, C.CHROME, 0, 0.026, -0.16));                       // sharp edge highlight
  return { g, muzzle: [0, 0, -0.27], hands: { right: [0, 0, 0.02] }, melee: true };
}

function buildMachete(c) {
  const g = new THREE.Group();
  add(g,
    box(0.03, 0.034, 0.14, C.DKWOOD, 0, 0, 0),
    box(0.012, 0.012, 0.012, C.BRASS, 0.017, 0, 0.03),                        // rivets
    box(0.012, 0.012, 0.012, C.BRASS, 0.017, 0, -0.02),
    box(0.03, 0.04, 0.02, C.BLACK, 0, 0, 0.08),
    box(0.012, 0.02, 0.02, c.color, 0.017, 0, 0.055),
    box(0.046, 0.018, 0.016, C.GUNMETAL, 0, 0, -0.078),
    box(0.007, 0.072, 0.34, C.STEEL, 0, 0.012, -0.26),                        // broad blade
    tilted(box(0.007, 0.056, 0.1, C.STEEL, 0, -0.006, -0.49), 0.28),          // clipped tip
    box(0.009, 0.014, 0.3, C.MID, 0, 0.048, -0.25),                           // back spine
    box(0.009, 0.014, 0.32, C.CHROME, 0, -0.026, -0.26));                     // edge
  return { g, muzzle: [0, 0, -0.5], hands: { right: [0, 0, 0.02] }, melee: true };
}

function buildBlade() {
  const g = new THREE.Group();
  add(g,
    box(0.032, 0.034, 0.14, C.POLY, 0, 0, 0),                                 // hilt
    box(0.034, 0.038, 0.012, C.TAN, 0, 0, 0.03),
    box(0.034, 0.038, 0.012, C.TAN, 0, 0, -0.01),
    box(0.04, 0.046, 0.022, C.GUNMETAL, 0, 0, 0.08),
    box(0.08, 0.018, 0.022, C.LIGHT, 0, 0, -0.078),                           // guard
    glow(0.084, 0.01, 0.01, '#7ad7ff', 0, 0, -0.092),
    glow(0.02, 0.056, 0.46, '#7ad7ff', 0, 0.008, -0.33),                      // blade
    glow(0.01, 0.034, 0.46, '#f2fdff', 0, 0.008, -0.33),                      // hot white core
    glow(0.014, 0.04, 0.04, '#7ad7ff', 0, 0.006, -0.575),
    aura(0.05, 0.1, 0.5, '#4cc3ff', 0.2, 0, 0.008, -0.33));                   // glow around the blade
  return { g, muzzle: [0, 0, -0.57], hands: { right: [0, 0, 0.02] }, melee: true };
}

const BUILDERS = {
  ar: buildAR, smg: buildSMG, shotgun: buildShotgun, lmg: buildLMG, sniper: buildSniper,
  nova: buildNova, rail: buildRail, pistol: buildPistol, mpistol: buildMPistol, revolver: buildRevolver,
  knife: buildKnife, machete: buildMachete, blade: buildBlade,
};

/**
 * Builds a weapon model.
 *   weapon  - the weapon definition from shared/weapons.js
 *   rarityColor - colour of the little rarity stripe
 *   withHands - add gloves and sleeves (first person view)
 * Returns { group, sightY, rearZ, muzzle (Vector3), parts, flash, hip, sprint, melee }.
 */
export function buildWeaponModel(weapon, rarityColor, withHands) {
  const spec = BUILDERS[weapon.model]({ color: rarityColor });
  if (withHands) {
    if (spec.melee) addHands(spec.g, { right: [0, 0, 0.02] });
    else addHands(spec.g, spec.hands);
  }
  const fl = spec.flash ? makeFlash(spec.flash[0], spec.flash[1]) : null;
  if (fl) {
    fl.position.set(spec.muzzle[0], spec.muzzle[1], spec.muzzle[2] - 0.02);
    spec.g.add(fl);
  }
  return {
    group: spec.g,
    sightY: spec.sightY || 0.07,
    rearZ: spec.rearZ || -0.05,
    muzzle: new THREE.Vector3(spec.muzzle[0], spec.muzzle[1], spec.muzzle[2]),
    parts: spec.parts || {},
    slideHome: spec.slideHome,
    flash: fl,
    hip: spec.hip || null,
    sprint: spec.sprint || null,
    melee: !!spec.melee,
  };
}

// ---------------------------------------------------------------------------- grenades

/**
 * A grenade model about 10 cm tall (origin at its centre). def is a grenade from shared/weapons.js.
 * Returns { group, flame (a part that can flicker, or null) }.
 */
export function buildGrenadeModel(def) {
  const g = new THREE.Group();
  const body = def.color;
  let flame = null;
  const cyl = (r, h, color, y) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 10), lambert(color));
    m.position.set(0, y, 0);
    return m;
  };
  switch (def.kind) {
    case 'frag': {
      // olive "pineapple" body made of chunky bands
      g.add(cyl(0.036, 0.09, body, 0));
      for (let i = 0; i < 3; i++) g.add(cyl(0.039, 0.012, C.DKOLIVE, -0.03 + i * 0.03));
      g.add(cyl(0.02, 0.025, C.GUNMETAL, 0.055));
      break;
    }
    case 'flash': {
      g.add(cyl(0.032, 0.11, C.PEARL, 0));
      g.add(cyl(0.034, 0.02, C.BLACK, -0.045));
      g.add(cyl(0.034, 0.02, C.BLACK, 0.045));
      g.add(cyl(0.0335, 0.012, C.ORANGE, 0.0));
      g.add(cyl(0.018, 0.02, C.GUNMETAL, 0.065));
      break;
    }
    case 'smoke': {
      g.add(cyl(0.034, 0.11, C.MID, 0));
      g.add(cyl(0.0355, 0.016, C.WHITE, 0.012));
      g.add(cyl(0.0355, 0.016, C.RED, -0.014));
      g.add(cyl(0.018, 0.02, C.GUNMETAL, 0.065));
      break;
    }
    case 'sticky': {
      g.add(cyl(0.036, 0.085, body, 0));
      g.add(cyl(0.0385, 0.014, '#e8c34a', 0));
      const gl = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), basic('#ffe27a'));
      gl.position.set(0, -0.05, 0);
      gl.scale.set(1, 0.6, 1);
      g.add(gl);
      g.add(cyl(0.02, 0.025, C.GUNMETAL, 0.055));
      break;
    }
    case 'incendiary': {
      g.add(cyl(0.035, 0.1, body, 0));
      g.add(cyl(0.0375, 0.016, C.ORANGE, -0.02));
      g.add(cyl(0.0375, 0.012, C.BLACK, 0.025));
      flame = glow(0.018, 0.03, 0.018, '#ffb347', 0, 0.075, 0);
      g.add(flame);
      g.add(cyl(0.018, 0.02, C.GUNMETAL, 0.058));
      break;
    }
    default:
      g.add(cyl(0.035, 0.09, body, 0));
  }
  // safety lever and pin ring
  g.add(box(0.01, 0.1, 0.014, C.STEEL, 0.034, 0.0, 0));
  g.add(box(0.03, 0.012, 0.012, C.STEEL, 0.02, 0.07, 0));
  return { group: g, flame };
}

/** A simple floating symbol for an ability (used in the loadout preview). */
export function buildAbilityIcon(def) {
  const g = new THREE.Group();
  const col = def.color;
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.1, 0), lambert(col));
  gem.scale.set(1, 1.35, 1);
  g.add(gem);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.012, 6, 24), basic(col));
  ring.rotation.x = Math.PI / 2.4;
  g.add(ring);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.008, 6, 24), halo(col, 0.5));
  ring2.rotation.x = Math.PI / 1.7; ring2.rotation.y = 0.6;
  g.add(ring2);
  return { group: g };
}
