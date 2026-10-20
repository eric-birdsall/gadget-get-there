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

const follow = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/** Heights of the leg and arm pivots above the feet. */
const HIP_HEIGHT = 0.72;
const SHOULDER_HEIGHT = 1.28;

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

export interface PlayerPose {
  feet: Vector3;
  vel: Vector3;
  grounded: boolean;
}

/**
 * The astronaut: white suit, gold-visored helmet, life-support backpack. All motion is
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

  private readonly materials: MeshStandardMaterial[];
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

  /** `ghost` makes a translucent, shadowless copy for the personal-best ghost. */
  constructor(ghost = false) {
    const mat = (color: string, extra: MeshStandardMaterialParameters = {}) =>
      new MeshStandardMaterial({
        color: ghost ? '#bdf3ff' : color,
        roughness: 0.6,
        ...(ghost ? { transparent: true, opacity: 0.35, depthWrite: false, emissive: '#5fd8ff', emissiveIntensity: 0.4 } : extra),
      });
    const suit = mat('#f2f4f8', { roughness: 0.75 });
    const pack = mat('#dfe3ec', { roughness: 0.7 });
    const trim = mat('#3a3f55', { roughness: 0.6 });
    const stripe = mat('#ff7a2f', { roughness: 0.5 });
    const metal = mat('#aab3c7', { roughness: 0.3, metalness: 0.7 });
    const visorMat = mat('#e3a63a', { roughness: 0.12, metalness: 0.9, emissive: '#6b3d00', emissiveIntensity: 0.25 });
    const glow = mat('#7ff6ff', { emissive: '#3fe0ff', emissiveIntensity: 1.4, roughness: 0.2 });
    const amber = mat('#ffb347', { emissive: '#ff8a00', emissiveIntensity: 1.2, roughness: 0.2 });
    this.materials = [suit, pack, trim, stripe, metal, visorMat, glow, amber];

    // The astronaut faces -Z. Every part hangs off `body`, so lean and squash move it all.
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

    // Legs and boots, swinging from the hips.
    for (const side of [-1, 1]) {
      const hip = new Group();
      hip.position.set(side * 0.16, HIP_HEIGHT, 0);
      hang(hip, new Mesh(new CapsuleGeometry(0.15, 0.42, 4, 12), suit), side * 0.16, 0.44, 0);
      hang(hip, new Mesh(new CapsuleGeometry(0.16, 0.1, 4, 12), trim), side * 0.16, 0.13, -0.04).scale.set(1, 0.9, 1.3);
      this.legs.push(hip);
      this.body.add(hip);
    }

    // Torso, with an orange waist band and a chest control panel.
    add(new Mesh(new CapsuleGeometry(0.36, 0.45, 6, 16), suit), 0, 1.0, 0);
    add(new Mesh(new CapsuleGeometry(0.365, 0.02, 4, 16), stripe), 0, 0.78, 0, false).scale.set(1, 0.35, 1);
    add(new Mesh(new BoxGeometry(0.26, 0.16, 0.05), trim), 0, 1.12, -0.35, false);
    add(new Mesh(new BoxGeometry(0.045, 0.045, 0.02), glow), -0.07, 1.13, -0.38, false);
    add(new Mesh(new BoxGeometry(0.045, 0.045, 0.02), amber), 0, 1.13, -0.38, false);
    add(new Mesh(new BoxGeometry(0.045, 0.045, 0.02), glow), 0.07, 1.13, -0.38, false);

    // Arms, slightly out from the body, with dark gloves, swinging from the shoulders.
    for (const side of [-1, 1]) {
      const shoulder = new Group();
      shoulder.position.set(side * 0.4, SHOULDER_HEIGHT, 0);
      // Tilted out; the run cycle swings it forward and back about X.
      shoulder.rotation.z = side * 0.18;
      hang(shoulder, new Mesh(new CapsuleGeometry(0.11, 0.4, 4, 10), suit), side * 0.42, 1.06, 0);
      hang(shoulder, new Mesh(new SphereGeometry(0.12, 12, 10), trim), side * 0.42, 0.78, 0, false);
      this.arms.push(shoulder);
      this.body.add(shoulder);
    }

    // Helmet: a white dome with a neck ring and a gold, mirrored visor across the front.
    add(new Mesh(new TorusGeometry(0.24, 0.05, 8, 24), trim), 0, 1.25, 0, false).rotation.x = Math.PI / 2;
    add(new Mesh(new SphereGeometry(0.3, 24, 18), suit), 0, 1.5, 0);
    const visor = new Mesh(new SphereGeometry(0.306, 24, 16, Math.PI * 1.5 - 0.95, 1.9, 0.72, 1.0), visorMat);
    add(visor, 0, 1.5, 0, false);

    // Life-support backpack with twin tanks and an antenna; gadgets mount here.
    add(new Mesh(new BoxGeometry(0.5, 0.62, 0.26), pack), 0, 1.06, 0.42);
    for (const side of [-1, 1]) add(new Mesh(new CylinderGeometry(0.08, 0.08, 0.56, 12), metal), side * 0.13, 1.04, 0.6);
    add(new Mesh(new CylinderGeometry(0.012, 0.012, 0.3, 6), trim), 0.17, 1.52, 0.46, false);
    add(new Mesh(new SphereGeometry(0.035, 10, 8), amber), 0.17, 1.68, 0.46, false);

    // Thruster flames under the backpack tanks: the jetpack burns them, a dash flashes them.
    for (const side of [-1, 1]) {
      const flame = new Mesh(new ConeGeometry(0.08, 0.5, 10, 1, true), this.flameMat);
      flame.rotation.x = Math.PI;
      flame.position.set(side * 0.13, 0.5, 0.6);
      this.flames.add(flame);
    }
    this.flames.visible = false;
    this.body.add(this.flames);

    // Wingsuit membranes, wrist to hip on each side; spread only while gliding.
    const wingMat = new MeshStandardMaterial({
      color: ghost ? '#bdf3ff' : '#ff7a2f',
      side: DoubleSide,
      transparent: true,
      opacity: ghost ? 0.25 : 0.85,
      depthWrite: !ghost,
      roughness: 0.6,
    });
    for (const side of [-1, 1]) {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute([side * 0.32, 1.3, 0, side * 1.15, 0.95, 0.02, side * 0.24, 0.3, 0], 3));
      g.computeVertexNormals();
      this.wings.add(new Mesh(g, wingMat));
    }
    this.wings.visible = false;
    this.body.add(this.wings);

    this.root.add(this.body);
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
      f.position.y = 0.72 - 0.25 * len * (dash > thrust ? 0.4 : 1);
      f.position.z = 0.6 + (dash > thrust ? 0.25 * len : 0);
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

  /** Slide (low, leaning back), crouch (low) or standing, plus the mantle pull-up. */
  setStance(sliding: boolean, crouching: boolean, mantle: number, dt: number): void {
    const k = follow(16, dt);
    this.low += ((sliding || crouching ? 1 : 0) - this.low) * k;
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
    const leanWanted = pose.grounded ? MathUtils.clamp(hSpeed * 0.018 + accel * 0.004, -0.15, 0.35) : 0.05;
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
      const airPose = (i === 0 ? -0.7 : 0.35) * this.air;
      hip.rotation.x = run + airPose;
    });
    this.arms.forEach((shoulder, i) => {
      const side = i === 0 ? 1 : -1;
      const run = -side * Math.sin(this.stride) * amp * RUN.armSwing * this.gait;
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
