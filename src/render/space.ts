import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Points,
  Quaternion,
  RingGeometry,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
} from 'three';
import type { Box } from '../sim/collision';

// The space backdrop: a galaxy-and-nebula sky, twinkling stars, a ringed planet and a moon (all
// fixed to the camera, so they never get closer), tumbling asteroids in the world around and
// below the course, and the occasional meteor.

/** Background colour, also used for fog so distant pieces fade into space. */
export const SPACE_COLOR = '#070918';

/** Small deterministic RNG, so the asteroid field is the same every load. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const NOISE_GLSL = /* glsl */ `
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float v = 0.0; float a = 0.5; for (int k = 0; k < 5; k++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
`;

/** Deep space with a galaxy band across it, dust lanes, and soft purple and teal nebulae. */
function skyDome(): Mesh {
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`,
    fragmentShader: `varying vec3 vDir;
${NOISE_GLSL}
void main() {
  vec3 d = normalize(vDir);
  vec3 col = mix(vec3(0.012, 0.014, 0.04), vec3(0.035, 0.03, 0.085), smoothstep(-0.7, 0.9, d.y));
  // The galaxy: a band around a tilted great circle, brightest at its core.
  vec3 axis = normalize(vec3(0.35, 1.0, -0.45));
  float across = dot(d, axis);
  float band = exp(-pow(across * 3.2, 2.0));
  float core = exp(-pow(across * 9.0, 2.0)) * smoothstep(0.2, 1.0, dot(d, normalize(vec3(-0.6, 0.1, -0.8))) * 0.5 + 0.5);
  float n = fbm(d * 3.0);
  float fine = fbm(d * 9.0 + 2.7);
  vec3 galaxy = mix(vec3(0.32, 0.22, 0.62), vec3(0.95, 0.78, 0.92), fine) * band * (0.35 + 0.9 * n);
  galaxy += vec3(1.0, 0.85, 0.7) * core * 0.9;
  // Dark dust lanes through the band.
  galaxy *= 1.0 - 0.65 * smoothstep(0.52, 0.72, fbm(d * 14.0 + 7.0)) * band;
  col += galaxy * 0.8;
  // Nebulae: soft clouds away from the band.
  float neb = smoothstep(0.48, 0.85, fbm(d * 2.2 + vec3(5.0, 1.0, 3.0)));
  float neb2 = smoothstep(0.55, 0.9, fbm(d * 2.6 + vec3(-3.0, 4.0, 1.0)));
  col += neb * vec3(0.22, 0.06, 0.32) + neb2 * vec3(0.02, 0.16, 0.22);
  gl_FragColor = vec4(col, 1.0);
}`,
  });
  const dome = new Mesh(new SphereGeometry(980, 48, 24), mat);
  dome.renderOrder = -2;
  dome.frustumCulled = false;
  return dome;
}

/** Thousands of stars of different sizes and tints, each twinkling at its own rate. */
function stars(count: number, random: () => number): { points: Points; material: ShaderMaterial } {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const size = new Float32Array(count);
  const phase = new Float32Array(count);
  const tints = ['#ffffff', '#cfe0ff', '#fff1d6', '#ffd6ec', '#d6fff8'].map((c) => new Color(c));
  for (let i = 0; i < count; i++) {
    // Uniform on a sphere.
    const u = random() * 2 - 1;
    const t = random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    pos.set([Math.cos(t) * r * 940, u * 940, Math.sin(t) * r * 940], i * 3);
    const c = tints[Math.floor(random() * tints.length)];
    col.set([c.r, c.g, c.b], i * 3);
    // Mostly small, a few bright.
    size[i] = 0.8 + Math.pow(random(), 6) * 3.5;
    phase[i] = random() * Math.PI * 2;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('color', new BufferAttribute(col, 3));
  geo.setAttribute('size', new BufferAttribute(size, 1));
  geo.setAttribute('phase', new BufferAttribute(phase, 1));
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    fog: false,
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
    vertexShader: `attribute float size; attribute float phase; attribute vec3 color;
uniform float uTime; uniform float uPixelRatio;
varying vec3 vColor; varying float vAlpha;
void main() {
  vColor = color;
  float tw = 0.65 + 0.35 * sin(uTime * (1.2 + fract(phase * 7.3) * 2.5) + phase);
  vAlpha = tw;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
  gl_PointSize = size * uPixelRatio * (0.8 + 0.4 * tw);
}`,
    fragmentShader: `varying vec3 vColor; varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(vColor, a * vAlpha);
}`,
  });
  const points = new Points(geo, material);
  points.renderOrder = -1;
  points.frustumCulled = false;
  return { points, material };
}

/** A banded gas giant texture, drawn once on a canvas. */
function gasGiantTexture(random: () => number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d')!;
  const bands = ['#2c1f5c', '#4b2f87', '#6d4bb0', '#a77fd6', '#e2b6e8', '#7a5fc2', '#39286e'];
  let y = 0;
  while (y < c.height) {
    const h = 6 + random() * 26;
    g.fillStyle = bands[Math.floor(random() * bands.length)];
    g.fillRect(0, y, c.width, h + 1);
    y += h;
  }
  // Soft wisps and a storm.
  g.globalAlpha = 0.25;
  for (let i = 0; i < 60; i++) {
    g.fillStyle = bands[Math.floor(random() * bands.length)];
    g.beginPath();
    g.ellipse(random() * 512, random() * 256, 20 + random() * 70, 2 + random() * 5, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 0.85;
  g.fillStyle = '#f2c2d8';
  g.beginPath();
  g.ellipse(330, 150, 26, 12, 0, 0, Math.PI * 2);
  g.fill();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Faint concentric rings with gaps, for the planet's ring system. */
function ringTexture(random: () => number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 1;
  const g = c.getContext('2d')!;
  for (let x = 0; x < 256; x++) {
    const a = x < 12 || x > 248 ? 0 : (0.25 + 0.6 * random()) * (Math.sin(x * 0.21) > -0.7 ? 1 : 0.15);
    g.fillStyle = `rgba(230, 210, 255, ${a.toFixed(3)})`;
    g.fillRect(x, 0, 1, 1);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** The ringed planet and a small moon, far away in fixed directions. */
function planetAndMoon(random: () => number): Group {
  const g = new Group();
  const planet = new Mesh(
    new SphereGeometry(150, 64, 32),
    new MeshStandardMaterial({ map: gasGiantTexture(random), roughness: 1, fog: false, emissive: '#1a1033', emissiveIntensity: 0.6 }),
  );
  planet.position.set(-520, 140, -560);
  planet.rotation.z = 0.35;
  const ringGeo = new RingGeometry(190, 300, 96, 1);
  // Map the 1-D ring texture radially.
  const uv = ringGeo.attributes.uv;
  const p = ringGeo.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    const r = Math.hypot(p.getX(i), p.getY(i));
    uv.setXY(i, (r - 190) / 110, 0.5);
  }
  const ring = new Mesh(
    ringGeo,
    new MeshBasicMaterial({ map: ringTexture(random), transparent: true, side: DoubleSide, depthWrite: false, fog: false }),
  );
  ring.position.copy(planet.position);
  ring.rotation.set(Math.PI / 2 - 0.35, 0.2, 0.35);
  const moon = new Mesh(
    new IcosahedronGeometry(36, 3),
    new MeshStandardMaterial({ color: '#b9b4c4', roughness: 1, flatShading: true, fog: false, emissive: '#151422', emissiveIntensity: 0.5 }),
  );
  moon.position.set(420, 260, -620);
  g.add(planet, ring, moon);
  return g;
}

/** A lumpy rock: an icosphere pushed in and out by a few overlapping waves. */
function rockGeometry(random: () => number): IcosahedronGeometry {
  const geo = new IcosahedronGeometry(1, 2);
  const p = geo.attributes.position;
  const k = [random() * 3 + 2, random() * 3 + 2, random() * 3 + 2];
  const o = [random() * 10, random() * 10, random() * 10];
  const v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const bump = 1 + 0.18 * Math.sin(v.x * k[0] + o[0]) * Math.sin(v.y * k[1] + o[1]) + 0.12 * Math.sin(v.z * k[2] + o[2]);
    v.multiplyScalar(bump);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

interface Rock {
  pos: Vector3;
  scale: Vector3;
  rot: Quaternion;
  spin: Quaternion;
}

/** Tumbling asteroids around and below the course, kept well clear of anything you can touch. */
class AsteroidField {
  readonly group = new Group();
  private readonly meshes: InstancedMesh[] = [];
  private readonly rocks: Rock[][] = [];
  private readonly m = new Matrix4();

  constructor(boxes: readonly Box[], random: () => number) {
    const variants = 4;
    const perVariant = 40;
    const materials = ['#7d746f', '#8c8178', '#6c6a75', '#9a8a7c'].map(
      (color) => new MeshStandardMaterial({ color, roughness: 1, flatShading: true }),
    );
    const clear = (p: Vector3, r: number) => boxes.every((b) => p.distanceTo(b.center) - b.bound - r > 18);
    for (let v = 0; v < variants; v++) {
      const mesh = new InstancedMesh(rockGeometry(random), materials[v], perVariant);
      const list: Rock[] = [];
      for (let i = 0; i < perVariant; i++) {
        let pos = new Vector3();
        let radius = 1;
        for (let tries = 0; tries < 50; tries++) {
          // Mostly small; a few big ones.
          radius = 1 + Math.pow(random(), 3) * 16;
          pos = new Vector3(-260 + random() * 560, -160 + random() * 300, 160 - random() * 760);
          if (clear(pos, radius)) break;
        }
        const axis = new Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize();
        list.push({
          pos,
          scale: new Vector3(radius * (0.8 + random() * 0.5), radius * (0.7 + random() * 0.4), radius * (0.8 + random() * 0.5)),
          rot: new Quaternion().setFromAxisAngle(axis, random() * Math.PI * 2),
          spin: new Quaternion().setFromAxisAngle(axis, (random() - 0.5) * 0.004),
        });
      }
      this.meshes.push(mesh);
      this.rocks.push(list);
      this.group.add(mesh);
    }
    this.update();
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
    }
  }

  /** Turns every rock a little; call once per frame. */
  update(): void {
    this.meshes.forEach((mesh, v) => {
      this.rocks[v].forEach((r, i) => {
        r.rot.multiply(r.spin);
        mesh.setMatrixAt(i, this.m.compose(r.pos, r.rot, r.scale));
      });
      mesh.instanceMatrix.needsUpdate = true;
    });
  }
}

interface Meteor {
  group: Group;
  vel: Vector3;
  age: number;
  life: number;
  length: number;
  material: MeshBasicMaterial;
}

/** Now and then a meteor streaks across the far sky, trailing a glowing tail. */
class Meteors {
  readonly group = new Group();
  private readonly pool: Meteor[] = [];
  private wait = 1;
  private readonly up = new Vector3(0, 1, 0);

  constructor(private readonly random: () => number) {
    for (let i = 0; i < 6; i++) {
      const material = new MeshBasicMaterial({ color: '#ffe2b8', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, fog: false });
      const tail = new Mesh(new ConeGeometry(1, 1, 8, 1, true), material);
      // Cone tip at the back, base at the head: tip along −Y, then the group is aimed along the velocity.
      tail.rotation.x = Math.PI;
      tail.position.y = -0.5;
      const head = new Mesh(new SphereGeometry(1.4, 10, 8), material);
      const group = new Group();
      group.add(tail, head);
      group.visible = false;
      this.group.add(group);
      this.pool.push({ group, vel: new Vector3(), age: 0, life: 0, length: 0, material });
    }
  }

  update(dt: number): void {
    this.wait -= dt;
    if (this.wait <= 0) {
      this.wait = 1.2 + this.random() * 3.5;
      const m = this.pool.find((x) => !x.group.visible);
      if (m) this.spawn(m);
    }
    for (const m of this.pool) {
      if (!m.group.visible) continue;
      m.age += dt;
      const k = m.age / m.life;
      if (k >= 1) {
        m.group.visible = false;
        continue;
      }
      m.group.position.addScaledVector(m.vel, dt);
      m.material.opacity = Math.sin(Math.PI * k) * 0.95;
      // The tail grows as it burns in.
      const tail = m.group.children[0];
      tail.scale.set(1.2, m.length * Math.min(1, k * 3), 1.2);
      tail.position.y = (-m.length * Math.min(1, k * 3)) / 2;
    }
  }

  private spawn(m: Meteor): void {
    const r = this.random;
    // Somewhere in the upper sky, far away.
    const az = r() * Math.PI * 2;
    const el = 0.15 + r() * 0.9;
    const dist = 520 + r() * 260;
    m.group.position.set(Math.cos(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.sin(az) * Math.cos(el) * dist);
    // Mostly sideways and down.
    m.vel.set(r() - 0.5, -0.35 - r() * 0.4, r() - 0.5).normalize().multiplyScalar(260 + r() * 220);
    m.group.quaternion.setFromUnitVectors(this.up, m.vel.clone().normalize());
    m.age = 0;
    m.life = 0.9 + r() * 0.9;
    m.length = 50 + r() * 70;
    m.group.visible = true;
  }
}

export class SpaceBackdrop {
  /** Everything at "infinity": follows the camera so it never gets closer. */
  private readonly sky = new Group();
  private readonly starMaterial: ShaderMaterial;
  private asteroids: AsteroidField;
  private readonly meteors: Meteors;
  private time = 0;

  constructor(
    private readonly scene: Scene,
    boxes: readonly Box[],
  ) {
    const random = rng(0x5ace);
    const { points, material } = stars(6000, random);
    this.starMaterial = material;
    this.meteors = new Meteors(random);
    this.sky.add(skyDome(), points, planetAndMoon(random), this.meteors.group);
    this.asteroids = new AsteroidField(boxes, rng(0xa57e));
    scene.add(this.sky, this.asteroids.group);
  }

  /** A new course: a new asteroid field that keeps clear of it. */
  setCourse(boxes: readonly Box[]): void {
    const visible = this.visible;
    this.scene.remove(this.asteroids.group);
    this.asteroids.dispose();
    this.asteroids = new AsteroidField(boxes, rng(0xa57e));
    this.asteroids.group.visible = visible;
    this.scene.add(this.asteroids.group);
  }

  /** Shown or hidden (the city replaces it). */
  set visible(on: boolean) {
    this.sky.visible = on;
    this.asteroids.group.visible = on;
  }

  get visible(): boolean {
    return this.sky.visible;
  }

  update(dt: number, cameraPos: Vector3): void {
    if (!this.sky.visible) return;
    this.time += dt;
    this.sky.position.copy(cameraPos);
    this.starMaterial.uniforms.uTime.value = this.time;
    this.asteroids.update();
    this.meteors.update(dt);
  }
}
