import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  ConeGeometry,
  CapsuleGeometry,
  CircleGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type MeshStandardMaterialParameters,
  SphereGeometry,
  CylinderGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import { PLAYER_SHAPE } from '../config';
import type { Theme } from './theme';

const follow = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/** How far a tuck squashes the model, as a share of the slide/crouch squash. */
const TUCK_LOW = 0.6;

/**
 * Where a body's limbs pivot and where the gadgets attach to it, so both bodies share one run
 * cycle, one set of thruster flames and one wingsuit. Heights are above the feet; the model faces −Z.
 */
interface Rig {
  hip: { x: number; y: number };
  shoulder: { x: number; y: number; tilt: number };
  /** Flame nozzles: sideways offset, height of the nozzle, depth behind the body, cone radius. */
  flame: { x: number; y: number; z: number; radius: number };
  /** Wingsuit corners: shoulder, wrist tip and hip, as sideways offset and height. */
  wing: { shoulder: [number, number]; tip: [number, number]; hip: [number, number] };
}

const ASTRONAUT_RIG: Rig = {
  hip: { x: 0.16, y: 0.72 },
  shoulder: { x: 0.4, y: 1.28, tilt: 0.18 },
  flame: { x: 0.13, y: 0.72, z: 0.6, radius: 0.08 },
  wing: { shoulder: [0.32, 1.3], tip: [1.15, 0.95], hip: [0.24, 0.3] },
};

// Longer legs, narrow shoulders and a slim pack sitting close to the back.
const RUNNER_RIG: Rig = {
  hip: { x: 0.11, y: 0.84 },
  shoulder: { x: 0.25, y: 1.42, tilt: 0.12 },
  flame: { x: 0.08, y: 0.94, z: 0.27, radius: 0.055 },
  wing: { shoulder: [0.24, 1.4], tip: [1.05, 1.02], hip: [0.14, 0.4] },
};

/** The runner's neon trim: cyan down the limbs, magenta across the chest and helmet. */
const NEON = { cyan: '#3fe6ff', magenta: '#ff4fd8', intensity: 1.8 };

/** Run cycle feel. */
const RUN = {
  /** The full run cycle shows from this speed up, m/s. */
  fullGaitSpeed: 3,
  /** One cycle covers strideBase + stridePerSpeed × speed metres (two steps). */
  strideBase: 1,
  stridePerSpeed: 0.2,
  /** Leg swing each way at full speed, radians; arms swing this share of it. */
  legSwing: 0.75,
  armSwing: 0.8,
  /** Body rise at each step, m. */
  bob: 0.06,
};

/** Shortest signed angle from a to b. */
function angleDelta(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

type MaterialMaker = (color: string, extra?: MeshStandardMaterialParameters) => MeshStandardMaterial;
type Placer = (mesh: Mesh, x: number, y: number, z: number, shadow?: boolean) => Mesh;
type Hanger = (pivot: Group, mesh: Mesh, x: number, y: number, z: number, shadow?: boolean) => Mesh;

export interface PlayerPose {
  feet: Vector3;
  vel: Vector3;
  grounded: boolean;
}

/**
 * The player's body: the astronaut in space, a neon-trimmed city runner at night. All motion is
 * procedural: it faces where it's going, leans into acceleration and turns, and squashes on landing.
 */
export class PlayerModel {
  readonly root = new Group();
  private readonly body = new Group();
  private yaw = 0;
  private lean = 0;
  private bank = 0;
  /** Vertical scale offset, sprung back to 0: negative squashes, positive stretches. */
  private squash = 0;
  private squashVel = 0;
  private readonly prevVel = new Vector3();

  private readonly ghost: boolean;
  private theme: Theme = 'space';
  private rig = ASTRONAUT_RIG;
  /** Everything the camera fade touches; rebuilt with the body. */
  private materials: MeshStandardMaterial[] = [];
  private wingMat: MeshStandardMaterial | null = null;
  private readonly flames = new Group();
  private readonly wings = new Group();
  /** 0 … 1: how far into the belly-down glide pose. */
  private glide = 0;
  private readonly flameMat = new MeshBasicMaterial({ color: '#ffb347', transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false });
  private flicker = 0;
  /** 0 standing … 1 fully low (slide or crouch). */
  private low = 0;
  /** 0 … 1 lean back (sliding feet-first). */
  private slideLean = 0;
  /** Mantle progress 0 … 1, or -1 when not mantling. */
  private reach = -1;
  /** Sideways lean away from a wall being run on: + leans left, − right. */
  private wallLean = 0;
  private onWall = false;
  /** Hip and shoulder pivots, left then right: the run cycle swings them. */
  private readonly legs: Group[] = [];
  private readonly arms: Group[] = [];
  /** Run cycle angle, advanced by distance covered, radians. */
  private stride = 0;
  /** 0 … 1: how much of the run cycle shows (none standing, in the air or sliding). */
  private gait = 0;
  /** 0 … 1: how much of the mid-air pose shows. */
  private air = 0;
  /** 0 … 1: knees pulled up (a tuck). */
  private tuck = 0;
  /** 0 … 1: sprinting (more lean, harder arm pumping). */
  private sprint = 0;

  /** `ghost` makes a translucent, shadowless copy for the personal-best ghost. */
  constructor(ghost = false, theme: Theme = 'space') {
    this.ghost = ghost;
    this.body.add(this.flames, this.wings);
    this.root.add(this.body);
    this.build(theme);
  }

  /** The astronaut in space, the city runner at night. Keeps the pose; only the body changes. */
  setLook(theme: Theme): void {
    if (theme !== this.theme) this.build(theme);
  }

  /** Throws away the current body and builds the one for `theme` on the same pivots. */
  private build(theme: Theme): void {
    this.theme = theme;
    this.rig = theme === 'city' ? RUNNER_RIG : ASTRONAUT_RIG;
    for (const part of [...this.body.children]) {
      if (part === this.flames || part === this.wings) continue;
      part.traverse((o) => {
        if (o instanceof Mesh) o.geometry.dispose();
      });
      this.body.remove(part);
    }
    for (const m of this.materials) m.dispose();
    this.materials = [];
    this.legs.length = 0;
    this.arms.length = 0;

    const ghost = this.ghost;
    const mat = (color: string, extra: MeshStandardMaterialParameters = {}) => {
      const m = new MeshStandardMaterial({
        color: ghost ? '#bdf3ff' : color,
        roughness: 0.6,
        ...(ghost ? { transparent: true, opacity: 0.35, depthWrite: false, emissive: '#5fd8ff', emissiveIntensity: 0.4 } : extra),
      });
      this.materials.push(m);
      return m;
    };

    // Every part hangs off `body`, so lean and squash move it all.
    const add = (mesh: Mesh, x: number, y: number, z: number, shadow = true) => {
      mesh.position.set(x, y, z);
      mesh.castShadow = shadow && !ghost;
      this.body.add(mesh);
      return mesh;
    };

    // A part hung from a pivot (hip or shoulder), placed by where it sits on the body.
    const hang = (pivot: Group, mesh: Mesh, x: number, y: number, z: number, shadow = true) => {
      mesh.position.set(x - pivot.position.x, y - pivot.position.y, z - pivot.position.z);
      mesh.castShadow = shadow && !ghost;
      pivot.add(mesh);
      return mesh;
    };

    // Hips and shoulders, left then right; each body hangs its own limbs from them.
    const rig = this.rig;
    for (const side of [-1, 1]) {
      const hip = new Group();
      hip.position.set(side * rig.hip.x, rig.hip.y, 0);
      this.legs.push(hip);
      const shoulder = new Group();
      shoulder.position.set(side * rig.shoulder.x, rig.shoulder.y, 0);
      // Tilted out; the run cycle swings it forward and back about X.
      shoulder.rotation.z = side * rig.shoulder.tilt;
      this.arms.push(shoulder);
      this.body.add(hip, shoulder);
    }

    if (theme === 'city') this.buildRunner(mat, add, hang);
    else this.buildAstronaut(mat, add, hang);

    // Thruster flames under the pack's nozzles: the jetpack burns them, a dash flashes them.
    this.flames.clear();
    for (const side of [-1, 1]) {
      const flame = new Mesh(new ConeGeometry(rig.flame.radius, 0.5, 10, 1, true), this.flameMat);
      flame.rotation.x = Math.PI;
      flame.position.set(side * rig.flame.x, rig.flame.y, rig.flame.z);
      this.flames.add(flame);
    }
    this.flames.visible = false;

    // Wingsuit membranes, wrist to hip on each side; spread only while gliding.
    for (const w of this.wings.children) (w as Mesh).geometry.dispose();
    this.wings.clear();
    // Kept out of `materials` so the camera fade leaves the membranes at their own opacity.
    this.wingMat?.dispose();
    const city = theme === 'city';
    const wingMat = new MeshStandardMaterial({
      color: ghost ? '#bdf3ff' : city ? NEON.magenta : '#ff7a2f',
      emissive: !ghost && city ? NEON.magenta : '#000000',
      emissiveIntensity: 0.5,
      side: DoubleSide,
      transparent: true,
      opacity: ghost ? 0.25 : city ? 0.7 : 0.85,
      depthWrite: !ghost,
      roughness: 0.6,
    });
    this.wingMat = wingMat;
    const { shoulder, tip, hip } = rig.wing;
    for (const side of [-1, 1]) {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute([side * shoulder[0], shoulder[1], 0, side * tip[0], tip[1], 0.02, side * hip[0], hip[1], 0], 3));
      g.computeVertexNormals();
      this.wings.add(new Mesh(g, wingMat));
    }
    this.wings.visible = this.glide > 0.05;
  }

  /** White suit, gold-visored helmet, life-support backpack with twin tanks. */
  private buildAstronaut(mat: MaterialMaker, add: Placer, hang: Hanger): void {
    const suit = mat('#f2f4f8', { roughness: 0.75 });
    const pack = mat('#dfe3ec', { roughness: 0.7 });
    const trim = mat('#3a3f55', { roughness: 0.6 });
    const stripe = mat('#ff7a2f', { roughness: 0.5 });
    const metal = mat('#aab3c7', { roughness: 0.3, metalness: 0.7 });
    const visorMat = mat('#e3a63a', { roughness: 0.12, metalness: 0.9, emissive: '#6b3d00', emissiveIntensity: 0.25 });
    const glow = mat('#7ff6ff', { emissive: '#3fe0ff', emissiveIntensity: 1.4, roughness: 0.2 });
    const amber = mat('#ffb347', { emissive: '#ff8a00', emissiveIntensity: 1.2, roughness: 0.2 });

    // Legs and boots, swinging from the hips.
    this.legs.forEach((hip, i) => {
      const side = i === 0 ? -1 : 1;
      hang(hip, new Mesh(new CapsuleGeometry(0.15, 0.42, 4, 12), suit), side * 0.16, 0.44, 0);
      hang(hip, new Mesh(new CapsuleGeometry(0.16, 0.1, 4, 12), trim), side * 0.16, 0.13, -0.04).scale.set(1, 0.9, 1.3);
    });

    // Torso, with an orange waist band and a chest control panel.
    add(new Mesh(new CapsuleGeometry(0.36, 0.45, 6, 16), suit), 0, 1.0, 0);
    add(new Mesh(new CapsuleGeometry(0.365, 0.02, 4, 16), stripe), 0, 0.78, 0, false).scale.set(1, 0.35, 1);
    add(new Mesh(new BoxGeometry(0.26, 0.16, 0.05), trim), 0, 1.12, -0.35, false);
    add(new Mesh(new BoxGeometry(0.045, 0.045, 0.02), glow), -0.07, 1.13, -0.38, false);
    add(new Mesh(new BoxGeometry(0.045, 0.045, 0.02), amber), 0, 1.13, -0.38, false);
    add(new Mesh(new BoxGeometry(0.045, 0.045, 0.02), glow), 0.07, 1.13, -0.38, false);

    // Arms, slightly out from the body, with dark gloves, swinging from the shoulders.
    this.arms.forEach((shoulder, i) => {
      const side = i === 0 ? -1 : 1;
      hang(shoulder, new Mesh(new CapsuleGeometry(0.11, 0.4, 4, 10), suit), side * 0.42, 1.06, 0);
      hang(shoulder, new Mesh(new SphereGeometry(0.12, 12, 10), trim), side * 0.42, 0.78, 0, false);
    });

    // Helmet: a white dome with a neck ring and a gold, mirrored visor across the front.
    add(new Mesh(new TorusGeometry(0.24, 0.05, 8, 24), trim), 0, 1.25, 0, false).rotation.x = Math.PI / 2;
    add(new Mesh(new SphereGeometry(0.3, 24, 18), suit), 0, 1.5, 0);
    add(new Mesh(new SphereGeometry(0.306, 24, 16, Math.PI * 1.5 - 0.95, 1.9, 0.72, 1.0), visorMat), 0, 1.5, 0, false);

    // Life-support backpack with twin tanks and an antenna; gadgets mount here.
    add(new Mesh(new BoxGeometry(0.5, 0.62, 0.26), pack), 0, 1.06, 0.42);
    for (const side of [-1, 1]) add(new Mesh(new CylinderGeometry(0.08, 0.08, 0.56, 12), metal), side * 0.13, 1.04, 0.6);
    add(new Mesh(new CylinderGeometry(0.012, 0.012, 0.3, 6), trim), 0.17, 1.52, 0.46, false);
    add(new Mesh(new SphereGeometry(0.035, 10, 8), amber), 0.17, 1.68, 0.46, false);
  }

  /**
   * The city runner: a courier in a fitted dark tech suit with neon trim, a close helmet with a
   * glowing visor strip, and a slim pack whose twin nozzles carry the jetpack and dash.
   */
  private buildRunner(mat: MaterialMaker, add: Placer, hang: Hanger): void {
    const suit = mat('#343b56', { roughness: 0.55, metalness: 0.15 });
    const panel = mat('#4f5a80', { roughness: 0.45, metalness: 0.3 });
    const shell = mat('#1e2232', { roughness: 0.25, metalness: 0.5 });
    const cyan = mat(NEON.cyan, { emissive: NEON.cyan, emissiveIntensity: NEON.intensity, roughness: 0.3 });
    const magenta = mat(NEON.magenta, { emissive: NEON.magenta, emissiveIntensity: NEON.intensity, roughness: 0.3 });
    const visorMat = mat('#9ff8ff', { emissive: NEON.cyan, emissiveIntensity: 2.2, roughness: 0.1 });

    // Legs: thigh and shin, a cyan stripe down the outside, and low trainers with glowing soles.
    this.legs.forEach((hip, i) => {
      const side = i === 0 ? -1 : 1;
      const x = side * RUNNER_RIG.hip.x;
      hang(hip, new Mesh(new CapsuleGeometry(0.085, 0.3, 4, 10), suit), x, 0.62, 0);
      hang(hip, new Mesh(new CapsuleGeometry(0.068, 0.3, 4, 10), suit), x, 0.27, 0);
      hang(hip, new Mesh(new SphereGeometry(0.07, 10, 8), panel), x, 0.44, -0.04, false).scale.set(1, 0.8, 0.7);
      hang(hip, new Mesh(new BoxGeometry(0.015, 0.62, 0.03), cyan), x + side * 0.08, 0.46, 0, false);
      hang(hip, new Mesh(new BoxGeometry(0.12, 0.08, 0.26), panel), x, 0.06, -0.04);
      hang(hip, new Mesh(new BoxGeometry(0.125, 0.02, 0.265), cyan), x, 0.015, -0.04, false);
    });

    // Torso: a flattened capsule, magenta chevrons on the chest and a magenta belt.
    add(new Mesh(new CapsuleGeometry(0.2, 0.36, 6, 16), suit), 0, 1.16, 0).scale.set(1.1, 1, 0.8);
    add(new Mesh(new CapsuleGeometry(0.17, 0.06, 4, 14), panel), 0, 0.88, 0).scale.set(1.1, 1, 0.85);
    add(new Mesh(new CylinderGeometry(0.205, 0.205, 0.035, 18), magenta), 0, 0.95, 0, false).scale.set(1.08, 1, 0.82);
    for (const side of [-1, 1]) {
      const chevron = add(new Mesh(new BoxGeometry(0.17, 0.022, 0.02), magenta), side * 0.065, 1.27, -0.155, false);
      chevron.rotation.z = side * -0.5;
    }
    add(new Mesh(new BoxGeometry(0.02, 0.2, 0.02), cyan), 0, 1.1, -0.165, false);

    // Arms: slim sleeves with a cyan cuff, dark gloves.
    this.arms.forEach((shoulder, i) => {
      const side = i === 0 ? -1 : 1;
      const x = side * RUNNER_RIG.shoulder.x;
      hang(shoulder, new Mesh(new SphereGeometry(0.072, 12, 10), panel), x, 1.4, 0);
      hang(shoulder, new Mesh(new CapsuleGeometry(0.06, 0.44, 4, 10), suit), x, 1.14, 0);
      hang(shoulder, new Mesh(new CylinderGeometry(0.064, 0.064, 0.04, 12), cyan), x, 0.95, 0, false);
      hang(shoulder, new Mesh(new SphereGeometry(0.068, 12, 10), shell), x, 0.87, 0, false);
    });

    // Helmet: a close, glossy shell with a magenta crest and a glowing visor band across the eyes.
    add(new Mesh(new CylinderGeometry(0.07, 0.085, 0.1, 12), suit), 0, 1.52, 0, false);
    add(new Mesh(new SphereGeometry(0.145, 24, 18), shell), 0, 1.66, 0).scale.set(0.95, 1.05, 1.1);
    add(new Mesh(new SphereGeometry(0.15, 24, 6, Math.PI * 1.5 - 1.0, 2.0, 1.32, 0.3), visorMat), 0, 1.66, 0, false).scale.set(0.95, 1.05, 1.1);
    add(new Mesh(new BoxGeometry(0.022, 0.03, 0.2), magenta), 0, 1.8, 0.01, false);

    // Slim pack close to the back, a cyan spine strip, twin nozzles at the bottom; gadgets mount here.
    add(new Mesh(new BoxGeometry(0.28, 0.4, 0.13), panel), 0, 1.16, 0.22);
    add(new Mesh(new BoxGeometry(0.29, 0.025, 0.14), magenta), 0, 1.35, 0.22, false);
    add(new Mesh(new BoxGeometry(0.03, 0.26, 0.02), cyan), 0, 1.16, 0.295, false);
    for (const side of [-1, 1]) {
      add(new Mesh(new CylinderGeometry(0.04, 0.05, 0.08, 10), shell), side * RUNNER_RIG.flame.x, 0.96, RUNNER_RIG.flame.z, false);
    }
  }

  /**
   * Thruster flames: `thrust` 0…1 for the jetpack's steady burn, `dash` 0…1 for a dash's flash
   * (blue, pointing back).
   */
  setThrusters(thrust: number, dash: number, dt: number): void {
    this.flicker += dt * 40;
    const level = Math.max(thrust, dash);
    this.flames.visible = level > 0.02;
    if (!this.flames.visible) return;
    this.flameMat.color.set(dash > thrust ? '#7ff6ff' : '#ffb347');
    const len = 0.6 + 0.9 * level + 0.15 * Math.sin(this.flicker);
    for (const f of this.flames.children) {
      f.scale.set(1 + 0.4 * level, len, 1 + 0.4 * level);
      // Down for the jetpack; swept back for a dash.
      f.rotation.x = Math.PI - (dash > thrust ? 1.2 : 0);
      f.position.y = this.rig.flame.y - 0.25 * len * (dash > thrust ? 0.4 : 1);
      f.position.z = this.rig.flame.z + (dash > thrust ? 0.25 * len : 0);
    }
  }

  /** Fades the model, e.g. when the camera is pressed up against it. */
  setOpacity(opacity: number): void {
    for (const m of this.materials) {
      const transparent = opacity < 0.99;
      if (m.transparent !== transparent) {
        m.transparent = transparent;
        m.needsUpdate = true;
      }
      m.opacity = opacity;
    }
  }

  /** Slide (low, leaning back), crouch (low), tuck (a little low, knees up) or standing, plus the mantle pull-up. */
  setStance(sliding: boolean, crouching: boolean, mantle: number, dt: number, tucking = false): void {
    const k = follow(16, dt);
    // A tuck is shorter by tuckLift of the 1.8 m: about 0.6 of the way to the full low squash.
    this.low += ((sliding || crouching ? 1 : tucking ? TUCK_LOW : 0) - this.low) * k;
    this.tuck += ((tucking ? 1 : 0) - this.tuck) * k;
    this.slideLean += ((sliding ? 1 : 0) - this.slideLean) * k;
    this.reach = mantle;
  }

  /** Wall running: lean the body away from the wall, feet against it, so it never sinks in. */
  setWallRun(normal: Vector3 | null, dt: number): void {
    let target = 0;
    if (normal) {
      // The model's right, from its facing. A wall on the right has its normal pointing left
      // (−1 here), and leaning away from it means tipping the top to the left (+).
      const rx = Math.cos(this.yaw);
      const rz = -Math.sin(this.yaw);
      target = -0.4 * (normal.x * rx + normal.z * rz);
    }
    this.wallLean += (target - this.wallLean) * follow(14, dt);
    this.onWall = normal !== null;
  }

  /** Sprint: a deeper forward lean and a harder arm pump, eased in and out. */
  setSprint(on: boolean, dt: number): void {
    this.sprint += ((on ? 1 : 0) - this.sprint) * follow(8, dt);
  }

  /** Wingsuit glide: wings out, body belly-down. */
  setGlide(on: boolean, dt: number): void {
    this.glide += ((on ? 1 : 0) - this.glide) * follow(8, dt);
    this.wings.visible = this.glide > 0.05;
    this.wings.scale.set(this.glide, 1, 1);
  }

  /** Puts the model at a recorded pose with no dynamics: for the ghost. */
  place(feet: Vector3, yaw: number): void {
    this.root.position.copy(feet);
    this.root.rotation.set(0, yaw, 0);
  }

  update(dt: number, pose: PlayerPose, landed: number, jumped: boolean): void {
    this.root.position.copy(pose.feet);
    const hSpeed = Math.hypot(pose.vel.x, pose.vel.z);

    // Face the direction of travel once moving.
    if (hSpeed > 0.5) {
      const target = Math.atan2(-pose.vel.x, -pose.vel.z);
      const turn = angleDelta(this.yaw, target) * follow(14, dt);
      this.yaw += turn;
      // Bank into turns, more at speed.
      const turnRate = dt > 0 ? turn / dt : 0;
      this.bank += (MathUtils.clamp(turnRate * hSpeed * 0.02, -0.5, 0.5) - this.bank) * follow(8, dt);
    } else {
      this.bank += (0 - this.bank) * follow(8, dt);
    }

    // Lean forward with forward acceleration and with speed.
    const accel = dt > 0 ? (Math.hypot(pose.vel.x, pose.vel.z) - Math.hypot(this.prevVel.x, this.prevVel.z)) / dt : 0;
    const leanWanted = pose.grounded ? MathUtils.clamp(hSpeed * 0.018 + accel * 0.004, -0.15, 0.35) + 0.2 * this.sprint : 0.05;
    this.lean += (leanWanted - this.lean) * follow(10, dt);
    this.prevVel.copy(pose.vel);

    this.animateLimbs(dt, hSpeed, pose.grounded);

    if (landed > 0) this.squashVel -= Math.min(6, 1.2 + landed * 0.18);
    if (jumped) this.squashVel += 3.5;
    // Damped spring back to rest.
    this.squashVel += (-this.squash * 220 - this.squashVel * 16) * dt;
    this.squash = MathUtils.clamp(this.squash + this.squashVel * dt, -0.35, 0.3);

    this.root.rotation.set(0, this.yaw, 0);
    // Mantle: reach forward over the lip early, straighten as you pull up.
    const reachLean = this.reach >= 0 ? 0.7 * Math.sin(Math.PI * Math.min(1, this.reach)) : 0;
    const pitch = -this.lean + this.slideLean * 0.9 - reachLean - this.glide * 1.35;
    this.body.rotation.set(pitch, 0, this.bank + this.wallLean);
    // Gliding pitches the body about its middle rather than its feet, so it stays over the player.
    const mid = PLAYER_SHAPE.height / 2;
    // Two bounces per stride: up as each leg passes under the body.
    const bob = this.gait * RUN.bob * Math.abs(Math.cos(this.stride));
    this.body.position.set(0, this.glide * mid * (1 - Math.cos(pitch)) + bob, -this.glide * mid * Math.sin(pitch));
    const sy = 1 + this.squash - this.low * 0.45;
    const sxz = 1 / Math.sqrt(sy);
    this.body.scale.set(sxz, sy, sxz);
  }

  /**
   * Legs stride and arms swing opposite them, faster and wider with speed, while running on the
   * ground or along a wall. In the air: one knee up, arms out. Gliding, sliding and mantling hold
   * the limbs still.
   */
  private animateLimbs(dt: number, hSpeed: number, grounded: boolean): void {
    const busy = this.glide > 0.3 || this.reach >= 0;
    const running = (grounded || this.onWall) && !busy;
    // Crouch-walking still steps, smaller; a slide doesn't.
    const stepping = running && this.slideLean < 0.5;
    const gaitWanted = stepping ? MathUtils.clamp(hSpeed / RUN.fullGaitSpeed, 0, 1) * (1 - 0.5 * this.low) : 0;
    this.gait += (gaitWanted - this.gait) * follow(10, dt);
    this.air += ((!grounded && !this.onWall && !busy ? 1 : 0) - this.air) * follow(8, dt);
    // One cycle (two steps) per stride length, which grows with speed.
    if (stepping) this.stride += (hSpeed / (RUN.strideBase + RUN.stridePerSpeed * hSpeed)) * Math.PI * dt;

    const amp = RUN.legSwing * Math.min(1, 0.45 + hSpeed / 18);
    this.legs.forEach((hip, i) => {
      const side = i === 0 ? 1 : -1;
      // Positive X rotation swings the foot back (the model faces −Z).
      const run = side * Math.sin(this.stride) * amp * this.gait;
      // In the air one knee comes up; tucked, both come right up.
      const airPose = (i === 0 ? -0.7 : 0.35) * this.air * (1 - this.tuck);
      hip.rotation.x = run + airPose - 1.1 * this.tuck;
    });
    this.arms.forEach((shoulder, i) => {
      const side = i === 0 ? 1 : -1;
      // Sprinting pumps the arms harder, bent up in front.
      const run = -side * Math.sin(this.stride) * amp * RUN.armSwing * (1 + 0.5 * this.sprint) * this.gait - 0.3 * this.sprint * this.gait;
      shoulder.rotation.x = run - 0.25 * this.air;
      shoulder.rotation.z = (i === 0 ? -1 : 1) * (0.18 + 0.5 * this.air);
    });
  }

  /** Faces a given heading immediately, for spawns. */
  face(yaw: number): void {
    this.yaw = yaw;
    this.lean = 0;
    this.bank = 0;
    this.squash = 0;
    this.squashVel = 0;
    this.prevVel.set(0, 0, 0);
  }
}

/** A soft dark disc on the ground under the player, so jumps can be judged. */
export class BlobShadow {
  readonly mesh: Mesh;
  private readonly material: MeshBasicMaterial;

  constructor() {
    this.material = new MeshBasicMaterial({ color: '#1c1f3a', transparent: true, opacity: 0.35, depthWrite: false });
    this.mesh = new Mesh(new CircleGeometry(PLAYER_SHAPE.radius * 1.1, 24), this.material);
    this.mesh.renderOrder = 1;
  }

  /** Places the disc on the surface hit below, fading with height; hides it with nothing below. */
  place(point: Vector3 | null, normal: Vector3 | null, height: number): void {
    if (!point || !normal) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.mesh.position.copy(point).addScaledVector(normal, 0.02);
    this.mesh.lookAt(point.x + normal.x, point.y + normal.y, point.z + normal.z);
    const t = MathUtils.clamp(height / 12, 0, 1);
    this.material.opacity = 0.45 * (1 - t) + 0.12;
    this.mesh.scale.setScalar(1 - t * 0.4);
  }
}
