// Godzilla: the big low-poly body other players see, and the claws and jaw you see as Godzilla.
// Both are built from boxes and cones. All the movement (walking, jumping, fire breath, grab, bite, stomp, roar) is here.
import * as THREE from 'three';

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cone = (r, h, n) => new THREE.ConeGeometry(r, h, n);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (k) => k * k * (3 - 2 * k);
const smooth = (cur, target, dt, rate) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

function makeMats() {
  return {
    body: new THREE.MeshLambertMaterial({ color: '#46674f' }),
    dark: new THREE.MeshLambertMaterial({ color: '#2f4a3a' }),
    belly: new THREE.MeshLambertMaterial({ color: '#97a67c' }),
    fin: new THREE.MeshLambertMaterial({ color: '#25332b', emissive: new THREE.Color('#000000') }),
    eye: new THREE.MeshBasicMaterial({ color: '#ffd23f', fog: false }),
    tooth: new THREE.MeshLambertMaterial({ color: '#f3f1e6' }),
    mouth: new THREE.MeshLambertMaterial({ color: '#7a2630', emissive: new THREE.Color('#000000') }),
  };
}

/** A claw hand: a palm and three white claws. */
function makeClaw(mats, s) {
  const g = new THREE.Group();
  const palm = new THREE.Mesh(box(0.34 * s, 0.3 * s, 0.38 * s), mats.dark);
  palm.position.set(0, -0.05 * s, -0.12 * s);
  g.add(palm);
  const claws = [];
  for (let i = -1; i <= 1; i++) {
    const c = new THREE.Mesh(cone(0.07 * s, 0.34 * s, 4), mats.tooth);
    c.rotation.x = -Math.PI / 2 - 0.35;
    c.position.set(i * 0.11 * s, -0.12 * s, -0.4 * s);
    g.add(c);
    claws.push(c);
  }
  g.userData.claws = claws;
  return g;
}

export class ZillaRig {
  /** `s` is a size multiplier (1 = the full Godzilla; the first-person arms use a smaller one). */
  constructor() {
    const M = this.mats = makeMats();
    this.root = new THREE.Group();
    this.root.rotation.order = 'YXZ';

    // ---- legs (hip pivots, knees)
    const makeLeg = (x) => {
      const hip = new THREE.Group(); hip.position.set(x, 2.05, 0.05);
      const thigh = new THREE.Mesh(box(0.8, 1.05, 0.95), M.body); thigh.position.set(0, -0.5, 0);
      const knee = new THREE.Group(); knee.position.set(0, -1.0, 0);
      const shin = new THREE.Mesh(box(0.62, 0.92, 0.72), M.dark); shin.position.set(0, -0.42, 0.04);
      const foot = new THREE.Mesh(box(0.78, 0.24, 1.15), M.dark); foot.position.set(0, -0.86, -0.28);
      const toes = [];
      for (let i = -1; i <= 1; i++) { const t = new THREE.Mesh(box(0.2, 0.16, 0.26), M.tooth); t.position.set(i * 0.26, -0.9, -0.92); toes.push(t); }
      knee.add(shin, foot, ...toes);
      hip.add(thigh, knee);
      return { hip, knee };
    };
    this.legL = makeLeg(-0.62);
    this.legR = makeLeg(0.62);

    // ---- the body above the hips (leans, bobs)
    this.hips = new THREE.Group(); this.hips.position.set(0, 2.05, 0);
    this.upper = new THREE.Group();
    this.hips.add(this.upper);
    const pelvis = new THREE.Mesh(box(1.5, 0.7, 1.2), M.dark); pelvis.position.set(0, 0.1, 0.05);
    const torso = new THREE.Mesh(box(1.8, 1.7, 1.3), M.body); torso.position.set(0, 1.0, 0);
    const belly = new THREE.Mesh(box(1.15, 1.5, 0.12), M.belly); belly.position.set(0, 0.95, -0.68);
    const chest = new THREE.Mesh(box(1.9, 0.7, 1.15), M.body); chest.position.set(0, 1.75, -0.05);
    this.upper.add(pelvis, torso, belly, chest);
    this.torso = torso;

    // dorsal fins down the back, bright blue-white when he breathes fire
    this.fins = [];
    const finSpots = [[1.95, 0.62, 0.55], [1.5, 0.74, 0.62], [1.05, 0.8, 0.66], [0.6, 0.7, 0.66], [0.2, 0.55, 0.62]];
    for (const [y, h, z] of finSpots) {
      const f = new THREE.Mesh(cone(0.36, h * 1.15, 4), M.fin);
      f.position.set(0, y, z); f.rotation.x = 0.55; f.rotation.y = Math.PI / 4;
      this.upper.add(f); this.fins.push(f);
      for (const sx of [-0.55, 0.55]) {
        const g = new THREE.Mesh(cone(0.26, h * 0.8, 4), M.fin);
        g.position.set(sx, y - 0.1, z - 0.05); g.rotation.x = 0.5; g.rotation.y = Math.PI / 4;
        this.upper.add(g); this.fins.push(g);
      }
    }

    // ---- arms (short, like the real one): shoulder pivot, claw at the end
    const makeArm = (x) => {
      const sh = new THREE.Group(); sh.position.set(x, 2.45, -0.4);
      const up = new THREE.Mesh(box(0.38, 0.8, 0.4), M.body); up.position.set(0, -0.35, 0);
      const fore = new THREE.Group(); fore.position.set(0, -0.72, 0);
      const lower = new THREE.Mesh(box(0.32, 0.65, 0.34), M.dark); lower.position.set(0, -0.28, 0);
      const claw = makeClaw(M, 1.35); claw.position.set(0, -0.62, 0);
      claw.rotation.x = -Math.PI / 2;            // claws point along the arm
      fore.add(lower, claw);
      sh.add(up, fore);
      this.upper.add(sh);
      return { sh, fore, claw };
    };
    this.armL = makeArm(-1.05);
    this.armR = makeArm(1.05);

    // ---- neck, head and jaw
    this.neck = new THREE.Group(); this.neck.position.set(0, 2.45, -0.45);
    const neckBox = new THREE.Mesh(box(0.95, 0.9, 0.9), M.body); neckBox.position.set(0, 0.2, -0.1);
    this.neck.add(neckBox);
    this.head = new THREE.Group(); this.head.position.set(0, 0.7, -0.35);
    const skull = new THREE.Mesh(box(1.05, 0.62, 1.25), M.body); skull.position.set(0, 0.2, -0.45);
    const snout = new THREE.Mesh(box(0.8, 0.38, 0.8), M.body); snout.position.set(0, 0.1, -1.25);
    const brow = new THREE.Mesh(box(1.15, 0.14, 0.45), M.dark); brow.position.set(0, 0.55, -0.55);
    this.head.add(skull, snout, brow);
    for (const sx of [-0.4, 0.4]) {
      const eye = new THREE.Mesh(box(0.18, 0.12, 0.1), M.eye); eye.position.set(sx, 0.42, -0.95);
      this.head.add(eye);
    }
    for (let i = 0; i < 6; i++) {            // upper teeth
      const t = new THREE.Mesh(cone(0.06, 0.2, 3), M.tooth);
      t.rotation.x = Math.PI; t.position.set(-0.3 + i * 0.12, -0.14, -1.55 + (i % 2) * 0.05);
      this.head.add(t);
    }
    this.jaw = new THREE.Group(); this.jaw.position.set(0, -0.02, -0.55);       // hinge at the back of the mouth
    const jawBox = new THREE.Mesh(box(0.85, 0.22, 1.35), M.dark); jawBox.position.set(0, -0.12, -0.55);
    const tongue = new THREE.Mesh(box(0.55, 0.06, 1.0), M.mouth); tongue.position.set(0, 0.0, -0.55);
    this.jaw.add(jawBox, tongue);
    for (let i = 0; i < 6; i++) {            // lower teeth
      const t = new THREE.Mesh(cone(0.05, 0.18, 3), M.tooth);
      t.position.set(-0.3 + i * 0.12, 0.08, -1.05 - (i % 2) * 0.05);
      this.jaw.add(t);
    }
    this.head.add(this.jaw);
    // where the fire starts (the front of the mouth) and where a bitten player would be
    this.mouth = new THREE.Object3D(); this.mouth.position.set(0, -0.05, -1.55);
    this.head.add(this.mouth);
    this.neck.add(this.head);
    this.upper.add(this.neck);

    // ---- tail: five segments, each smaller, swaying
    this.tail = [];
    let parent = this.upper;
    let w = 1.0, len = 0.95;
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Group();
      seg.position.set(0, i === 0 ? 0.1 : 0, i === 0 ? 0.55 : len * 0.95);
      const m = new THREE.Mesh(box(w, w * 0.8, len), i % 2 ? M.dark : M.body);
      m.position.set(0, 0, len * 0.5);
      seg.add(m);
      if (i < 4) {
        const f = new THREE.Mesh(cone(w * 0.3, w * 0.75, 4), M.fin);
        f.position.set(0, w * 0.55, len * 0.5); f.rotation.y = Math.PI / 4;
        seg.add(f); this.fins.push(f);
      }
      parent.add(seg);
      this.tail.push(seg);
      parent = seg;
      w *= 0.74; len *= 1.0;
    }

    this.root.add(this.legL.hip, this.legR.hip, this.hips);

    // ---- animation state
    this.phase = 0;
    this.t = Math.random() * 10;
    this.air = 0;              // 0..1 in the air
    this.reach = 0;            // arms out (0..1)
    this.jawOpen = 0;
    this.glow = 0;             // fins
    this.lunge = 0;            // head pushed forward
    this.timers = { whiff: 0, bite: 0, wind: 0, slam: 0, roar: 0, land: 0 };
    this.wasAir = false;
    this.flash = 0;
  }

  /** Start a one-off move: 'whiff' (an empty swipe), 'bite', 'stomp' (the wind-up), 'quake' (the slam), 'roar'. */
  trigger(kind) {
    const T = this.timers;
    if (kind === 'whiff') T.whiff = 0.55;
    else if (kind === 'bite') T.bite = 0.55;
    else if (kind === 'stomp') { T.wind = 0.35; T.slam = 0; }
    else if (kind === 'quake') { T.wind = 0; T.slam = 0.45; }
    else if (kind === 'roar') T.roar = 1.6;
  }

  /** Where the fire comes from, and which way it goes (world space). */
  mouthPose(pos, dir) {
    this.mouth.getWorldPosition(pos);
    this.mouth.getWorldDirection(dir);
    dir.negate();
    return pos;
  }

  /**
   * One frame. st: { speed (m/s on the ground), air (bool), pitch (look up/down), breathing, holding, stompWind (server flag) }
   */
  update(dt, st) {
    const T = this.timers, M = this.mats;
    this.t += dt;
    for (const k of Object.keys(T)) if (T[k] > 0) T[k] = Math.max(0, T[k] - dt);
    const speed = clamp(st.speed || 0, 0, 9);
    const moving = clamp(speed / 3.5, 0, 1);

    // landing thump
    if (this.wasAir && !st.air) T.land = 0.3;
    this.wasAir = !!st.air;
    this.air = smooth(this.air, st.air ? 1 : 0, dt, 12);
    const land = Math.sin(clamp(T.land / 0.3, 0, 1) * Math.PI) * 0.22;

    // ---- walking
    if (!st.air) this.phase += speed * dt * 0.95;
    const sw = Math.sin(this.phase) * moving * 0.55 * (1 - this.air);
    const bob = Math.abs(Math.cos(this.phase)) * 0.09 * moving * (1 - this.air);
    const breathe = Math.sin(this.t * 1.7) * 0.012;

    // ---- stomp: the right leg goes up during the wind-up, then slams down
    const wind = T.wind > 0 ? ease(1 - T.wind / 0.35) : (st.stompWind ? 1 : 0);
    const slam = T.slam > 0 ? Math.sin(clamp(T.slam / 0.45, 0, 1) * Math.PI) : 0;       // 0 → 1 → 0 body drop
    const slamLeg = T.slam > 0 ? clamp(T.slam / 0.45, 0, 1) : 0;                         // leg comes down fast

    // legs
    const air = this.air;
    this.legL.hip.rotation.x = sw - 0.55 * air;
    this.legR.hip.rotation.x = -sw - 0.35 * air - wind * 1.15 * (1 - ease(1 - slamLeg));
    this.legL.knee.rotation.x = Math.max(0, -sw) * 0.8 + 0.95 * air;
    this.legR.knee.rotation.x = Math.max(0, sw) * 0.8 + 0.7 * air + wind * 1.3 * (1 - ease(1 - slamLeg));
    const hipY = 2.05 - bob - land * 0.8 - slam * 0.3 - wind * 0.08;
    this.legL.hip.position.y = this.legR.hip.position.y = hipY;
    this.hips.position.y = hipY;

    // ---- arms: swipe, grab and carry
    let reachT = 0.12 + 0.16 * Math.sin(this.t * 1.7) * 0.3;
    if (T.whiff > 0) reachT = Math.sin(clamp(1 - T.whiff / 0.55, 0, 1) * Math.PI) * 1.25 + 0.1;
    if (st.holding) reachT = 1.25 + Math.sin(this.t * 22) * 0.05;               // gripping a struggling player
    if (T.bite > 0) reachT = 0.95 - ease(clamp(1 - T.bite / 0.55, 0, 1)) * 0.7;      // pulls them towards the mouth
    if (this.air > 0.3) reachT = Math.max(reachT, 0.6 * this.air);
    if (wind > 0) reachT = Math.max(reachT, 0.7 * wind);
    this.reach = smooth(this.reach, reachT, dt, st.holding ? 18 : 22);
    const swing = sw * 0.35;
    this.armL.sh.rotation.x = this.reach + swing;
    this.armR.sh.rotation.x = this.reach - swing;
    this.armL.sh.rotation.z = -0.22 - 0.15 * this.air - wind * 0.35;
    this.armR.sh.rotation.z = 0.22 + 0.15 * this.air + wind * 0.35;
    const bend = st.holding ? 0.7 : 0.45 + 0.4 * (T.whiff > 0 ? 1 : 0);
    this.armL.fore.rotation.x = this.armR.fore.rotation.x = bend * (0.5 + 0.5 * Math.min(1, this.reach));
    const clench = st.holding ? 0.9 : (T.whiff > 0 ? 0.0 : 0.3);
    for (const a of [this.armL, this.armR]) for (const c of a.claw.userData.claws) c.rotation.x = -Math.PI / 2 - 0.35 - clench * 0.7;

    // ---- body lean
    const run = clamp(speed / 6, 0, 1);
    this.upper.rotation.x = -0.12 - 0.1 * run + 0.18 * wind - slam * 0.18 + breathe * 2 - (st.breathing ? 0.1 : 0) - 0.2 * Math.sin(clamp(1 - T.bite / 0.55, 0, 1) * Math.PI) * (T.bite > 0 ? 1 : 0);
    this.upper.rotation.z = Math.sin(this.phase) * 0.05 * moving;
    this.upper.rotation.y = Math.sin(this.phase) * 0.07 * moving;
    this.torso.scale.set(1 + breathe, 1 + breathe * 1.5, 1 + breathe);

    // ---- head and jaw
    const roar = T.roar > 0 ? Math.sin(clamp(1 - T.roar / 1.6, 0, 1) * Math.PI) : 0;
    const biteT = T.bite > 0 ? 1 - T.bite / 0.55 : -1;
    let jawT = 0.04 + 0.03 * Math.sin(this.t * 1.7);
    if (st.breathing) jawT = 0.75;
    if (roar > 0) jawT = Math.max(jawT, 0.95 * Math.min(1, roar * 1.5));
    if (st.holding) jawT = Math.max(jawT, 0.45);
    if (biteT >= 0) jawT = biteT < 0.45 ? 0.9 : Math.max(0, 0.9 * (1 - (biteT - 0.45) / 0.15));        // open wide, then snap shut
    this.jawOpen = smooth(this.jawOpen, jawT, dt, biteT >= 0 ? 30 : 16);
    this.jaw.rotation.x = -this.jawOpen * 0.7;           // negative: the front of the lower jaw drops
    let headPitch = clamp((st.pitch || 0) * 0.8, -0.5, 0.9);
    if (st.breathing) headPitch = Math.max(headPitch, 0.1);
    headPitch += roar * 0.55;
    if (biteT >= 0) headPitch -= 0.5 * Math.sin(clamp(biteT, 0, 1) * Math.PI);
    this.head.rotation.x = headPitch;
    this.neck.rotation.x = -0.18 - roar * 0.15;
    const lungeT = (st.breathing ? 0.25 : 0) + (biteT >= 0 ? 0.55 * Math.sin(clamp(biteT, 0, 1) * Math.PI) : 0);
    this.lunge = smooth(this.lunge, lungeT, dt, 14);
    this.neck.position.z = -0.45 - this.lunge;
    this.neck.position.y = 2.45 - 0.35 * Math.sin(clamp(biteT, 0, 1) * Math.PI) * (biteT >= 0 ? 1 : 0);

    // ---- tail sways, lifts a little when jumping and whips on the stomp
    for (let i = 0; i < this.tail.length; i++) {
      const sway = Math.sin(this.t * 1.6 - i * 0.7) * 0.12 + Math.sin(this.phase * 1.0 - i * 0.9) * 0.2 * moving;
      this.tail[i].rotation.y = sway + Math.sin(this.t * 7 - i) * 0.35 * slam;
      this.tail[i].rotation.x = (i === 0 ? 0.25 : 0.06) - this.air * 0.12 - slam * 0.1;
    }

    // ---- the fins glow while he breathes fire; the mouth too
    this.glow = smooth(this.glow, st.breathing ? 1 : roar > 0 ? 0.6 : 0, dt, 9);
    const pulse = 0.75 + 0.25 * Math.sin(this.t * 30);
    M.fin.emissive.setRGB(0.25 * this.glow * pulse, 0.75 * this.glow * pulse, 1.0 * this.glow * pulse);
    M.mouth.emissive.setRGB(0.9 * this.glow, 0.35 * this.glow, 0.05 * this.glow);

    // red flash when hit
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 5);
    for (const m of [M.body, M.dark, M.belly]) m.emissive.setRGB(this.flash * 0.9, this.flash * 0.1, this.flash * 0.1);
  }

  dispose() {
    for (const m of Object.values(this.mats)) m.dispose();
    this.root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  }
}

/**
 * What you see as Godzilla: two claws at the sides and your lower jaw at the bottom of the screen.
 * Lives in the gun camera's scene (see viewmodel.js).
 */
export class ZillaView {
  constructor() {
    const M = this.mats = makeMats();
    this.root = new THREE.Group();
    this.root.visible = false;
    this.jaw = new THREE.Group(); this.jaw.position.set(0, -0.5, -0.35);
    const jawBox = new THREE.Mesh(box(0.55, 0.07, 0.75), M.dark); jawBox.position.set(0, 0, -0.35);
    const tongue = new THREE.Mesh(box(0.38, 0.02, 0.6), M.mouth); tongue.position.set(0, 0.04, -0.35);
    this.jaw.add(jawBox, tongue);
    for (let i = 0; i < 5; i++) {
      const t = new THREE.Mesh(cone(0.025, 0.09, 3), M.tooth);
      t.position.set(-0.2 + i * 0.1, 0.07, -0.68);
      this.jaw.add(t);
    }
    this.root.add(this.jaw);
    const mk = (x) => {
      const arm = new THREE.Group(); arm.position.set(x, -0.5, -0.25);
      const fore = new THREE.Mesh(box(0.14, 0.14, 0.7), M.body); fore.position.set(0, 0, -0.2);
      const claw = makeClaw(M, 0.9); claw.position.set(0, -0.02, -0.55);
      arm.add(fore, claw);
      this.root.add(arm);
      return { arm, claw };
    };
    this.L = mk(-0.42);
    this.R = mk(0.42);
    this.t = 0; this.jawOpen = 0; this.reach = 0; this.bob = 0;
    this.timers = { whiff: 0, bite: 0, stomp: 0, quake: 0 };
  }

  trigger(kind) {
    if (kind === 'whiff') this.timers.whiff = 0.5;
    else if (kind === 'bite') this.timers.bite = 0.55;
    else if (kind === 'stomp') this.timers.stomp = 0.35;
    else if (kind === 'quake') this.timers.quake = 0.4;
  }

  /** st: { breathing, holding, speed, air } */
  update(dt, st) {
    const T = this.timers;
    this.t += dt;
    for (const k of Object.keys(T)) if (T[k] > 0) T[k] = Math.max(0, T[k] - dt);
    let jawT = 0.05;
    if (st.breathing) jawT = 0.8;
    if (st.holding) jawT = 0.35;
    if (T.bite > 0) { const b = 1 - T.bite / 0.55; jawT = b < 0.45 ? 0.9 : Math.max(0, 0.9 * (1 - (b - 0.45) / 0.15)); }
    this.jawOpen = smooth(this.jawOpen, jawT, dt, T.bite > 0 ? 30 : 16);
    this.jaw.rotation.x = -this.jawOpen * 0.55;
    this.jaw.position.y = -0.5 - this.jawOpen * 0.06 + (T.quake > 0 ? Math.sin(T.quake / 0.4 * Math.PI) * -0.05 : 0);

    let reachT = 0;
    if (T.whiff > 0) reachT = Math.sin((1 - T.whiff / 0.5) * Math.PI);
    if (st.holding) reachT = 1;
    if (T.bite > 0) reachT = 0.9 - ease(1 - T.bite / 0.55) * 0.9;
    this.reach = smooth(this.reach, reachT, dt, 20);
    this.bob += Math.min(st.speed || 0, 8) * dt * 0.9;
    const bobY = Math.abs(Math.sin(this.bob)) * 0.02 * Math.min(1, (st.speed || 0) / 3) * (st.air ? 0 : 1);
    const lift = (T.stomp > 0 ? Math.sin((1 - T.stomp / 0.35) * Math.PI / 2) * 0.1 : 0);
    for (const [side, x] of [[this.L, -1], [this.R, 1]]) {
      side.arm.position.set(x * (0.42 - 0.22 * this.reach), -0.5 + 0.32 * this.reach + bobY + lift, -0.25 - 0.3 * this.reach);
      side.arm.rotation.x = 0.1 * this.reach + Math.sin(this.t * 1.5) * 0.02;
      side.arm.rotation.y = -x * 0.5 * this.reach;
      const clench = st.holding ? 0.9 : 0.25;
      for (const c of side.claw.userData.claws) c.rotation.x = -Math.PI / 2 - 0.35 - clench * 0.6;
    }
    // a bit of the mouth glows while breathing
    this.mats.mouth.emissive.setRGB(0.9 * (st.breathing ? 1 : 0), 0.35 * (st.breathing ? 1 : 0), 0.05);
  }
}
