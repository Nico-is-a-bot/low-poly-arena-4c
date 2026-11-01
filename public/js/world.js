// Builds the 3D scene from the shared map data (the same boxes the physics uses).
import * as THREE from 'three';

// ------------------------------------------------------------------ textures
// All textures are painted on a canvas here, so the game needs no image files.

function canvasTexture(size, paint) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  paint(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Corrugated metal: vertical ridges. 1 repeat = 1 metre of width.
function ridgeTexture() {
  return canvasTexture(64, (g, s) => {
    const period = s / 4;
    for (let i = 0; i < 4; i++) {
      const x = i * period;
      const grad = g.createLinearGradient(x, 0, x + period, 0);
      grad.addColorStop(0, '#f2f2f2');
      grad.addColorStop(0.45, '#dcdcdc');
      grad.addColorStop(0.55, '#b8b8b8');
      grad.addColorStop(1, '#9c9c9c');
      g.fillStyle = grad;
      g.fillRect(x, 0, period, s);
    }
  });
}

// Wooden crate: planks with a dark frame and a cross brace.
function crateTexture() {
  return canvasTexture(128, (g, s) => {
    g.fillStyle = '#e6e6e6';
    g.fillRect(0, 0, s, s);
    g.fillStyle = '#bdbdbd';
    for (let y = 0; y < s; y += 32) g.fillRect(0, y, s, 2);
    g.strokeStyle = '#8f8f8f';
    g.lineWidth = 10;
    g.strokeRect(5, 5, s - 10, s - 10);
    g.lineWidth = 8;
    g.beginPath();
    g.moveTo(10, 10); g.lineTo(s - 10, s - 10);
    g.moveTo(s - 10, 10); g.lineTo(10, s - 10);
    g.stroke();
  });
}

// Concrete: light speckle and faint expansion joints. 1 repeat = 4 metres.
function concreteTexture() {
  return canvasTexture(256, (g, s) => {
    g.fillStyle = '#f0f0f0';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 2600; i++) {
      const v = 200 + Math.floor(Math.random() * 55);
      g.fillStyle = 'rgb(' + v + ',' + v + ',' + v + ')';
      g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    g.fillStyle = '#cfcfcf';
    g.fillRect(0, 0, s, 2);
    g.fillRect(0, 0, 2, s);
  });
}

// --------------------------------------------------------------- box geometry

// BoxGeometry has 6 faces of 4 vertices: +x, -x, +y, -y, +z, -z.
// This scales each face's UV coordinates so a texture keeps the same size in
// metres no matter how big the box is.
function scaleBoxUVs(geo, w, h, d, tileU, tileV, flatTop) {
  const uv = geo.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let face = 0; face < 6; face++) {
    for (let k = 0; k < 4; k++) {
      const i = face * 4 + k;
      let u = uv.getX(i), v = uv.getY(i);
      if (flatTop && (face === 2 || face === 3)) {
        u = 0.1;                      // sample a flat part of the ridge texture
        v = v * dims[face][1] / tileV;
      } else {
        u = u * dims[face][0] / tileU;
        v = v * dims[face][1] / tileV;
      }
      uv.setXY(i, u, v);
    }
  }
  uv.needsUpdate = true;
}

// Collects many boxes that share one material into a single mesh.
class Batch {
  constructor(material) {
    this.material = material;
    this.pos = []; this.nor = []; this.uv = []; this.idx = [];
    this.vertCount = 0;
  }
  add(geo, x, y, z) {
    const p = geo.attributes.position, n = geo.attributes.normal, u = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i) + x, p.getY(i) + y, p.getZ(i) + z);
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.uv.push(u.getX(i), u.getY(i));
    }
    const index = geo.index;
    for (let i = 0; i < index.count; i++) this.idx.push(index.getX(i) + this.vertCount);
    this.vertCount += p.count;
  }
  toMesh() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, this.material);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }
}

// ------------------------------------------------------------------ the sky

function makeSky(theme) {
  const geo = new THREE.SphereGeometry(300, 24, 12);
  const top = new THREE.Color(theme.skyTop || '#6f93b8');
  const horizon = new THREE.Color(theme.sky);
  const colors = [];
  const pos = geo.attributes.position;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const k = Math.max(0, Math.min(1, pos.getY(i) / 300));
    c.copy(horizon).lerp(top, Math.pow(k, 0.7));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -1;
  return mesh;
}

// ------------------------------------------------------------------ main

export function buildWorld(map) {
  const theme = map.theme;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(theme.sky);
  scene.fog = new THREE.Fog(theme.fog, theme.fogNear, theme.fogFar);
  scene.add(makeSky(theme));

  // Lights (no per-pixel lights beyond one sun, so it stays fast)
  const hemi = new THREE.HemisphereLight(theme.hemiSky, theme.hemiGround, 2.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(theme.sun, 2.4);
  const sd = new THREE.Vector3(...theme.sunDir).normalize();
  sun.position.copy(sd).multiplyScalar(70);
  sun.target.position.set(0, 0, 0);
  scene.add(sun, sun.target);
  const reach = Math.max(map.width, map.depth) * 0.75;
  sun.shadow.camera.left = -reach;
  sun.shadow.camera.right = reach;
  sun.shadow.camera.top = reach;
  sun.shadow.camera.bottom = -reach;
  sun.shadow.camera.near = 5;
  sun.shadow.camera.far = 160;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;

  // Textures
  const concrete = concreteTexture();
  const ridges = ridgeTexture();
  const crates = crateTexture();

  // Floor, plus a big dark plane so you never see the void past the walls
  const floorTex = concrete.clone();
  floorTex.needsUpdate = true;
  floorTex.repeat.set(map.width / 4, map.depth / 4);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(map.width, map.depth),
    new THREE.MeshLambertMaterial({ color: theme.ground, map: floorTex })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const outside = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600),
    new THREE.MeshLambertMaterial({ color: theme.groundLine })
  );
  outside.rotation.x = -Math.PI / 2;
  outside.position.y = -0.05;
  scene.add(outside);

  // Boxes: one mesh per (look, colour)
  const batches = new Map();
  const getBatch = (key, makeMaterial) => {
    if (!batches.has(key)) batches.set(key, new Batch(makeMaterial()));
    return batches.get(key);
  };

  for (const b of map.boxes) {
    const geo = new THREE.BoxGeometry(b.w, b.h, b.d);
    const color = b.c || '#888888';
    let batch;
    switch (b.kind) {
      case 'container':
        scaleBoxUVs(geo, b.w, b.h, b.d, 1, b.h, true);
        batch = getBatch('container|' + color, () => new THREE.MeshLambertMaterial({ color, map: ridges }));
        break;
      case 'crate':
        scaleBoxUVs(geo, b.w, b.h, b.d, 1.2, 1.2, false);
        batch = getBatch('crate|' + color, () => new THREE.MeshLambertMaterial({ color, map: crates }));
        break;
      case 'wall':
      case 'barrier':
        scaleBoxUVs(geo, b.w, b.h, b.d, 4, 4, false);
        batch = getBatch('concrete|' + color, () => new THREE.MeshLambertMaterial({ color, map: concrete }));
        break;
      default:   // stairs, platforms, posts, rails: flat colour
        batch = getBatch('flat|' + color, () => new THREE.MeshLambertMaterial({ color }));
    }
    batch.add(geo, b.x, b.y + b.h / 2, b.z);
    geo.dispose();
  }
  for (const batch of batches.values()) scene.add(batch.toMesh());

  /** low / medium / high: only High draws shadows. */
  function setQuality(q) {
    sun.castShadow = q === 'high';
    scene.fog.far = q === 'low' ? theme.fogFar * 0.7 : theme.fogFar;
  }

  return { scene, sun, hemi, setQuality };
}
