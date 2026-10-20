import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Points,
  PointsMaterial,
  BoxGeometry,
  CanvasTexture,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  SRGBColorSpace,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  type Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import type { CourseDefinition } from '../course/types';
import { type Box, SurfaceKind, raycast } from '../sim/collision';
import { NOISE_GLSL, rng } from './space';

// The city at night: the course is on rooftops high above a city. A dusk sky (deep blue overhead,
// a magenta-orange glow low down), a skyline of towers with lit windows and neon crowns, glowing
// streets far below in the haze, and a building under every rooftop of the course.

/** Street level, far below every course's fall line, m. */
const GROUND_Y = -160;

/** A night sky: near black overhead, violet, then a warm dusk glow at the horizon; faint stars. */
export function nightSky(): Mesh {
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
  float h = d.y;
  vec3 col = mix(vec3(0.95, 0.42, 0.38), vec3(0.42, 0.16, 0.42), smoothstep(-0.02, 0.12, h));
  col = mix(col, vec3(0.1, 0.07, 0.24), smoothstep(0.1, 0.4, h));
  col = mix(col, vec3(0.02, 0.02, 0.07), smoothstep(0.4, 0.95, h));
  // Below the horizon: the city's glow through the haze.
  col = mix(col, vec3(0.32, 0.14, 0.3), smoothstep(0.0, -0.1, h));
  // A few stars, high up only.
  float s = step(0.985, hash(floor(d * 380.0))) * smoothstep(0.35, 0.8, h);
  col += vec3(s) * 0.7;
  gl_FragColor = vec4(col, 1.0);
}`,
  });
  const dome = new Mesh(new SphereGeometry(980, 48, 24), mat);
  dome.renderOrder = -2;
  dome.frustumCulled = false;
  return dome;
}

/** How a facade looks: share of windows lit, how bright they glow, how much colour they keep, how dark the unlit ones are. */
interface FacadeLook {
  wall: string;
  litShare: number;
  glow: number;
  saturation: number;
  darkGlass: number;
}

/** The buildings under the course: lively. */
const NEAR_FACADE: FacadeLook = { wall: '#151827', litShare: 0.16, glow: 0.42, saturation: 0.7, darkGlass: 0.6 };
/** The skyline beyond: muted, so it sits back and doesn't fizz. */
const FAR_FACADE: FacadeLook = { wall: '#141329', litShare: 0.08, glow: 0.2, saturation: 0.35, darkGlass: 0.2 };

/**
 * Building walls with windows: a grid of floors and bays in world space, some windows lit (warm
 * or cool), the rest dark glass. Works for single meshes and instanced towers.
 */
export function facadeMaterial(look: FacadeLook = NEAR_FACADE): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ color: look.wall, roughness: 0.7, metalness: 0.2 });
  // Distinct shader per look (the numbers are baked in).
  mat.customProgramCacheKey = () => `facade-${look.litShare}-${look.glow}-${look.saturation}-${look.darkGlass}`;
  const f = (v: number) => v.toFixed(3);
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFacadePos;\nvarying vec3 vFacadeNormal;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vec4 facadeWorld = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
facadeWorld = instanceMatrix * facadeWorld;
#endif
vFacadePos = (modelMatrix * facadeWorld).xyz;
vFacadeNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vFacadePos;
varying vec3 vFacadeNormal;
float facadeHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
vec3 fn = abs(vFacadeNormal);
if (fn.y < 0.5) {
  // Bays 2.6 m wide, floors 3.4 m tall, on whichever wall this is.
  float along = fn.x > fn.z ? vFacadePos.z : vFacadePos.x;
  vec2 cell = vec2(along / 2.6, vFacadePos.y / 3.4);
  vec2 f = fract(cell);
  float window = step(0.18, f.x) * step(f.x, 0.82) * step(0.25, f.y) * step(f.y, 0.8);
  float h = facadeHash(vec3(floor(cell), floor(along / 41.0) + (fn.x > fn.z ? 7.0 : 3.0)));
  float lit = step(1.0 - ${f(look.litShare)}, h);
  vec3 warm = vec3(1.0, 0.72, 0.38);
  vec3 cool = vec3(0.45, 0.85, 1.0);
  vec3 glow = mix(warm, cool, step(0.94, h)) * (0.55 + 0.6 * fract(h * 13.0));
  glow = mix(vec3(dot(glow, vec3(0.333))), glow, ${f(look.saturation)});
  totalEmissiveRadiance += window * lit * glow * ${f(look.glow)};
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.07, 0.12), window * (1.0 - lit) * ${f(look.darkGlass)});
}`,
      );
  };
  return mat;
}

const NEON = ['#ff4fd8', '#3fe6ff', '#ffb347', '#8a6bff'];

/**
 * Towers all around and below the course, kept clear of it: lit windows, some with a neon crown.
 */
class Skyline {
  readonly group = new Group();
  private readonly towers: InstancedMesh;
  private readonly crowns: InstancedMesh;

  private readonly facade = facadeMaterial(FAR_FACADE);
  /** The tops of the tallest towers, for blinking aircraft lights. */
  readonly tallTops: Vector3[] = [];

  constructor(boxes: readonly Box[], random: () => number) {
    const unit = new BoxGeometry(1, 1, 1);
    const count = 220;
    this.towers = new InstancedMesh(unit, this.facade, count);
    this.crowns = new InstancedMesh(unit, new MeshBasicMaterial({ color: '#ffffff', fog: true }), count);
    const m = new Matrix4();
    const q = new Quaternion();
    const pos = new Vector3();
    const size = new Vector3();
    const near = new Vector3();
    // How far (horizontally) a tower's footprint is from the course, and the height of the
    // course piece nearest it.
    const nearest = (x: number, z: number, w: number, d: number): { dist: number; y: number } => {
      let dist = Infinity;
      let y = 0;
      for (const b of boxes) {
        const dx = Math.max(0, Math.abs(b.center.x - x) - w / 2 - b.bound);
        const dz = Math.max(0, Math.abs(b.center.z - z) - d / 2 - b.bound);
        const h = Math.hypot(dx, dz);
        if (h < dist) {
          dist = h;
          y = b.center.y;
        }
      }
      return { dist, y };
    };
    let n = 0;
    let crowns = 0;
    for (let tries = 0; n < count && tries < count * 8; tries++) {
      // A rough street grid: towers in blocks, 46 m apart, jittered a little.
      const gx = Math.round((random() - 0.5) * 30);
      const gz = Math.round(random() * 30 - 22);
      const w = 14 + random() * 20;
      const d = 14 + random() * 20;
      const x = gx * 46 + (random() - 0.5) * 8;
      const z = gz * 46 + (random() - 0.5) * 8;
      // Near the course, towers stay well below its rooftops (open sky above the course); only
      // far off can one rise above them. Close in, only low ones (far below) are allowed at all.
      const { dist, y } = nearest(x, z, w, d);
      const maxTop = dist > 200 ? y + 45 : y - 14;
      const top = Math.min(maxTop, -60 + Math.pow(random(), 1.4) * 140);
      if (dist < 45 && top > y - 35) continue;
      if (top < GROUND_Y + 20) continue;
      if (top > -25) this.tallTops.push(new Vector3(x, top + 0.8, z));
      size.set(w, top - GROUND_Y, d);
      pos.set(x, (top + GROUND_Y) / 2, z);
      m.compose(pos, q, size);
      this.towers.setMatrixAt(n++, m);
      if (random() < 0.18) {
        // A neon band round the top.
        near.set(w + 0.6, 1.2, d + 0.6);
        pos.set(x, top - 1.5, z);
        m.compose(pos, q, near);
        this.crowns.setMatrixAt(crowns, m);
        this.crowns.setColorAt(crowns++, new Color(NEON[Math.floor(random() * NEON.length)]).multiplyScalar(0.45));
      }
    }
    this.towers.count = n;
    this.crowns.count = crowns;
    this.towers.instanceMatrix.needsUpdate = true;
    this.crowns.instanceMatrix.needsUpdate = true;
    if (this.crowns.instanceColor) this.crowns.instanceColor.needsUpdate = true;
    this.group.add(this.towers, this.crowns);
  }

  dispose(): void {
    this.towers.geometry.dispose();
    this.facade.dispose();
    (this.crowns.material as MeshBasicMaterial).dispose();
  }
}

/** Streets far below: a dark ground with glowing orange street lines in a grid, fading into the haze. */
function streets(): Mesh {
  const mat = new ShaderMaterial({
    fog: true,
    uniforms: {
      fogColor: { value: new Color() },
      fogNear: { value: 1 },
      fogFar: { value: 1000 },
    },
    vertexShader: `varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vec4 mvPosition = viewMatrix * w;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`,
    fragmentShader: `varying vec3 vWorld;
#include <fog_pars_fragment>
void main() {
  vec2 g = abs(fract(vWorld.xz / 46.0 + 0.5) - 0.5) * 46.0;
  float street = 1.0 - smoothstep(2.5, 4.0, min(g.x, g.y));
  vec3 col = mix(vec3(0.03, 0.02, 0.06), vec3(1.0, 0.55, 0.22), street * 0.85);
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}`,
  });
  const mesh = new Mesh(new PlaneGeometry(5000, 5000), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = GROUND_Y;
  return mesh;
}

/**
 * A building under each rooftop of the course (flat platforms and stepping stones), down to the
 * street: for looks only, so the course plays exactly as before.
 */
export function buildingsUnder(boxes: readonly Box[], facade: MeshStandardMaterial): Group {
  const g = new Group();
  for (const b of boxes) {
    if (b.kind !== SurfaceKind.Platform && b.kind !== SurfaceKind.Accent) continue;
    // Flat, level slabs only (not ramps or tilted pieces).
    if (Math.abs(b.rot.w) < 0.9999 || b.half.y > 6) continue;
    const top = b.center.y - b.half.y;
    const mesh = new Mesh(new BoxGeometry(b.half.x * 2 - 0.2, top - GROUND_Y, b.half.z * 2 - 0.2), facade);
    mesh.position.set(b.center.x, (top + GROUND_Y) / 2, b.center.z);
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  return g;
}

const craneSteel = new MeshStandardMaterial({ color: '#d6a51c', roughness: 0.6, metalness: 0.3, emissive: '#3a2a00', emissiveIntensity: 0.5 });
const craneEdges = new LineBasicMaterial({ color: '#fff07a' });
const cabMaterial = new MeshStandardMaterial({ color: '#2a2f45', emissive: '#ffb347', emissiveIntensity: 0.35, roughness: 0.5 });
const counterweight = new MeshStandardMaterial({ color: '#4a4f60', roughness: 0.9 });

/** A yellow steel box with bright edges, for crane parts. */
function steel(w: number, h: number, d: number, material: MeshStandardMaterial = craneSteel): Mesh {
  const geo = new BoxGeometry(w, h, d);
  const mesh = new Mesh(geo, material);
  if (material === craneSteel) mesh.add(new LineSegments(new EdgesGeometry(geo), craneEdges));
  return mesh;
}

const DOWN = new Vector3(0, -1, 0);
const probe = new Vector3();

/** Nothing of the course in a vertical column of half-width `r` from (x, top, z) down to the street. */
function columnClear(boxes: readonly Box[], x: number, z: number, top: number, r: number): boolean {
  for (const [ox, oz] of [[0, 0], [r, r], [-r, r], [r, -r], [-r, -r]]) {
    probe.set(x + ox, top, z + oz);
    if (raycast(boxes, probe, DOWN, top - GROUND_Y)) return false;
  }
  return true;
}

/**
 * Each grapple beam as the jib of a tower crane: a mast down to the street at one end (whichever
 * end has nothing of the course below it; neither, and the jib floats), the operator's cab and a
 * counter-jib with its weight. For looks only.
 */
function cranes(boxes: readonly Box[], aviation: Vector3[]): Group {
  const g = new Group();
  for (const b of boxes) {
    if (b.kind !== SurfaceKind.Overhead || Math.abs(b.rot.w) < 0.9999) continue;
    const alongX = b.half.x >= b.half.z;
    const half = alongX ? b.half.x : b.half.z;
    const top = b.center.y + b.half.y;
    const bottom = b.center.y - b.half.y;
    for (const end of [1, -1]) {
      const x = b.center.x + (alongX ? end * (half + 1) : 0);
      const z = b.center.z + (alongX ? 0 : end * (half + 1));
      if (!columnClear(boxes, x, z, bottom - 0.2, 1)) continue;
      // The mast, from the street to just above the jib.
      const mastTop = top + 3;
      const mast = steel(1.8, mastTop - GROUND_Y, 1.8);
      mast.position.set(x, (mastTop + GROUND_Y) / 2, z);
      // The cab under the jib, beside the mast.
      const cab = steel(2.4, 2.2, 2.4, cabMaterial);
      cab.position.set(x - (alongX ? end * 2 : 0) * 0.9, bottom - 1.2, z - (alongX ? 0 : end * 2) * 0.9);
      // The counter-jib reaching back the other way, and its weight.
      const back = 9;
      const jib = steel(alongX ? back : 1, 0.8, alongX ? 1 : back);
      jib.position.set(x + (alongX ? end * back / 2 : 0), top - 0.4, z + (alongX ? 0 : end * back / 2));
      const weight = steel(alongX ? 2.5 : 2.2, 2, alongX ? 2.2 : 2.5, counterweight);
      weight.position.set(x + (alongX ? end * (back - 1.5) : 0), top - 1.6, z + (alongX ? 0 : end * (back - 1.5)));
      g.add(mast, cab, jib, weight);
      aviation.push(new Vector3(x, mastTop + 0.6, z));
      break;
    }
  }
  return g;
}

/** A helipad marking: a dark disc, a yellow ring and a white H, drawn once. */
let helipadTexture: CanvasTexture | null = null;
function helipad(): CanvasTexture {
  if (helipadTexture) return helipadTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(20, 24, 40, 0.85)';
  g.beginPath();
  g.arc(128, 128, 124, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#ffd34d';
  g.lineWidth = 12;
  g.beginPath();
  g.arc(128, 128, 104, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#f2f4f8';
  g.fillRect(80, 70, 22, 116);
  g.fillRect(154, 70, 22, 116);
  g.fillRect(80, 117, 96, 22);
  helipadTexture = new CanvasTexture(c);
  helipadTexture.colorSpace = SRGBColorSpace;
  return helipadTexture;
}

/** Helipads painted on the checkpoint rooftops. */
function helipads(course: CourseDefinition): Group {
  const g = new Group();
  const mat = new MeshBasicMaterial({ map: helipad(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, fog: true });
  for (const cp of course.checkpoints) {
    const [x, y, z] = cp.respawn.pos;
    const r = Math.max(3, Math.min(7, Math.min(cp.size[0], cp.size[2]) * 0.3));
    const mesh = new Mesh(new PlaneGeometry(r * 2, r * 2), mat);
    mesh.rotation.x = -Math.PI / 2;
    // A little ahead of the respawn spot, so you don't spawn on the H.
    mesh.position.set(x, y + 0.03, z - r - 1.5);
    mesh.renderOrder = 1;
    g.add(mesh);
  }
  return g;
}

/**
 * The city dressing for one course, all for looks only: a building under each rooftop, the
 * grapple beams as tower cranes, helipads on the checkpoint rooftops. Positions for blinking
 * aircraft lights (crane tops) are added to `aviation`.
 */
export function cityCourseDressing(course: CourseDefinition, boxes: readonly Box[], facade: MeshStandardMaterial, aviation: Vector3[] = []): Group {
  const g = new Group();
  g.add(buildingsUnder(boxes, facade), cranes(boxes, aviation), helipads(course));
  return g;
}

/** Red aircraft-warning lights on tall towers and crane tops, blinking together. */
class BlinkLights {
  readonly points: Points;
  private readonly material: ShaderMaterial;

  constructor() {
    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uScale: { value: window.innerHeight / 2 } },
      vertexShader: `uniform float uScale;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(2.2 * uScale / -mv.z, 2.0, 14.0);
}`,
      fragmentShader: `uniform float uTime;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float on = step(0.55, fract(uTime / 1.6));
  float a = smoothstep(0.5, 0.0, d) * (0.15 + 0.85 * on);
  gl_FragColor = vec4(vec3(1.0, 0.15, 0.12) * a, a);
}`,
    });
    this.points = new Points(new BufferGeometry(), this.material);
    this.points.frustumCulled = false;
  }

  setPositions(at: readonly Vector3[]): void {
    this.points.geometry.dispose();
    this.points.geometry = new BufferGeometry().setFromPoints([...at]);
  }

  update(dt: number): void {
    this.material.uniforms.uTime.value += dt;
  }
}

/** One lane of flying traffic: cars in a line along a street, headlights one way, tail-lights the other. */
interface Lane {
  /** Fixed across-coordinate and height; the cars move along x (alongX) or z. */
  alongX: boolean;
  across: number;
  y: number;
  speed: number;
  offsets: number[];
}

/** Flying traffic: lanes of cars along the streets below and around the course, lights only. */
class Traffic {
  readonly points: Points;
  private readonly lanes: Lane[] = [];
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private time = 0;

  constructor(random: () => number) {
    const laneCount = 18;
    const perLane = 14;
    for (let i = 0; i < laneCount; i++) {
      const alongX = random() < 0.5;
      // On a street line (between the blocks), well below the rooftops.
      const across = (Math.round((random() - 0.5) * 24) + 0.5) * 46;
      const dir = random() < 0.5 ? 1 : -1;
      this.lanes.push({
        alongX,
        across,
        y: -110 + random() * 85,
        speed: dir * (18 + random() * 22),
        offsets: Array.from({ length: perLane }, () => random() * TRAFFIC_SPAN),
      });
    }
    const n = laneCount * perLane * 2;
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new BufferAttribute(this.colors, 3));
    this.points = new Points(geo, new PointsMaterial({ size: 2.6, vertexColors: true, sizeAttenuation: true, transparent: true, depthWrite: false, blending: AdditiveBlending, fog: true }));
    this.points.frustumCulled = false;
    this.update(0);
  }

  update(dt: number): void {
    this.time += dt;
    let i = 0;
    for (const lane of this.lanes) {
      const dir = Math.sign(lane.speed);
      for (const off of lane.offsets) {
        // Wrap round the span, centred on the course area.
        const t = (((off + lane.speed * this.time) % TRAFFIC_SPAN) + TRAFFIC_SPAN) % TRAFFIC_SPAN - TRAFFIC_SPAN / 2;
        // Headlights ahead (white), tail-lights behind (red), 3 m apart.
        for (const [lead, r, gC, bC] of [[1.5, 1, 0.95, 0.85], [-1.5, 1, 0.12, 0.1]]) {
          const a = t + dir * lead;
          const x = lane.alongX ? a : lane.across;
          const z = lane.alongX ? lane.across + TRAFFIC_CENTRE_Z : a + TRAFFIC_CENTRE_Z;
          this.positions.set([x, lane.y, z], i * 3);
          this.colors.set([r, gC, bC], i * 3);
          i++;
        }
      }
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

/** How far a traffic lane runs before its cars wrap round, m; centred on the courses' middle (they run toward −Z). */
const TRAFFIC_SPAN = 1100;
const TRAFFIC_CENTRE_Z = -200;

export class CityBackdrop {
  /** Everything at "infinity": follows the camera. */
  private readonly sky = new Group();
  readonly facade = facadeMaterial();
  private readonly ground: Mesh;
  private skyline: Skyline;
  private readonly lights = new BlinkLights();
  private readonly traffic = new Traffic(rng(0x7a7f));
  /** Crane tops on the current course, for the blinking lights. */
  private craneTops: Vector3[] = [];

  constructor(
    private readonly scene: Scene,
    boxes: readonly Box[],
  ) {
    this.sky.add(nightSky());
    this.ground = streets();
    this.skyline = new Skyline(boxes, rng(0xc17e));
    scene.add(this.sky, this.ground, this.skyline.group, this.lights.points, this.traffic.points);
    this.refreshLights();
  }

  setCourse(boxes: readonly Box[]): void {
    const visible = this.visible;
    this.scene.remove(this.skyline.group);
    this.skyline.dispose();
    this.skyline = new Skyline(boxes, rng(0xc17e));
    this.skyline.group.visible = visible;
    this.scene.add(this.skyline.group);
    this.refreshLights();
  }

  /** The current course's crane tops (from its dressing), for the blinking lights. */
  setCraneTops(tops: Vector3[]): void {
    this.craneTops = tops;
    this.refreshLights();
  }

  private refreshLights(): void {
    this.lights.setPositions([...this.skyline.tallTops, ...this.craneTops]);
  }

  set visible(on: boolean) {
    this.sky.visible = on;
    this.ground.visible = on;
    this.skyline.group.visible = on;
    this.lights.points.visible = on;
    this.traffic.points.visible = on;
  }

  get visible(): boolean {
    return this.sky.visible;
  }

  update(dt: number, cameraPos: Vector3): void {
    if (!this.sky.visible) return;
    this.sky.position.copy(cameraPos);
    this.lights.update(dt);
    this.traffic.update(dt);
  }
}
