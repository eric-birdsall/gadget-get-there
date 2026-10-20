import {
  BackSide,
  BoxGeometry,
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
import { type Box, SurfaceKind } from '../sim/collision';
import { NOISE_GLSL, rng } from './space';

// The city at night: the course is on rooftops high above a city. A dusk sky (deep blue overhead,
// a magenta-orange glow low down), a skyline of towers with lit windows and neon crowns, glowing
// streets far below in the haze, and a building under every rooftop of the course.

/** Street level, far below every course's fall line, m. */
const GROUND_Y = -160;

/** A night sky: near black overhead, violet, then a warm dusk glow at the horizon; faint stars. */
function nightSky(): Mesh {
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

export class CityBackdrop {
  /** Everything at "infinity": follows the camera. */
  private readonly sky = new Group();
  readonly facade = facadeMaterial();
  private readonly ground: Mesh;
  private skyline: Skyline;

  constructor(
    private readonly scene: Scene,
    boxes: readonly Box[],
  ) {
    this.sky.add(nightSky());
    this.ground = streets();
    this.skyline = new Skyline(boxes, rng(0xc17e));
    scene.add(this.sky, this.ground, this.skyline.group);
  }

  setCourse(boxes: readonly Box[]): void {
    const visible = this.visible;
    this.scene.remove(this.skyline.group);
    this.skyline.dispose();
    this.skyline = new Skyline(boxes, rng(0xc17e));
    this.skyline.group.visible = visible;
    this.scene.add(this.skyline.group);
  }

  set visible(on: boolean) {
    this.sky.visible = on;
    this.ground.visible = on;
    this.skyline.group.visible = on;
  }

  get visible(): boolean {
    return this.sky.visible;
  }

  update(cameraPos: Vector3): void {
    if (!this.sky.visible) return;
    this.sky.position.copy(cameraPos);
  }
}
