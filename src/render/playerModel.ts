import {
  CapsuleGeometry,
  CircleGeometry,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type MeshStandardMaterialParameters,
  SphereGeometry,
  Vector3,
} from 'three';
import { PLAYER_SHAPE } from '../config';

const follow = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

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
 * The capsule-bot: a rounded body with a glowing visor. All motion is procedural: it faces
 * where it's going, leans into acceleration and turns, and squashes on landing.
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
  private readonly skates = new Group();
  private tuck = 0;
  /** 0 standing … 1 fully low (slide or crouch). */
  private low = 0;
  /** 0 … 1 lean back (sliding feet-first). */
  private slideLean = 0;
  /** Mantle progress 0 … 1, or -1 when not mantling. */
  private reach = -1;

  /** `ghost` makes a translucent, shadowless copy for the personal-best ghost. */
  constructor(ghost = false) {
    const r = PLAYER_SHAPE.radius;
    const h = PLAYER_SHAPE.height;
    const mat = (color: string, extra: MeshStandardMaterialParameters = {}) =>
      new MeshStandardMaterial({
        color: ghost ? '#bdf3ff' : color,
        roughness: 0.5,
        ...(ghost ? { transparent: true, opacity: 0.35, depthWrite: false, emissive: '#5fd8ff', emissiveIntensity: 0.4 } : extra),
      });
    const shell = mat('#ff5d8f', { roughness: 0.45, metalness: 0.05 });
    const trim = mat('#2b2f45', { roughness: 0.6 });
    const glow = mat('#7ff6ff', { emissive: '#3fe0ff', emissiveIntensity: 1.2, roughness: 0.2 });
    this.materials = [shell, trim, glow];

    const torso = new Mesh(new CapsuleGeometry(r, h - 2 * r, 6, 16), shell);
    torso.position.y = h / 2;
    torso.castShadow = !ghost;
    this.body.add(torso);

    // Visor: a flattened capsule across the front of the head.
    const visor = new Mesh(new CapsuleGeometry(0.13, 0.42, 4, 12), glow);
    visor.rotation.z = Math.PI / 2;
    visor.scale.set(1, 1, 0.55);
    visor.position.set(0, h - 0.48, -r + 0.06);
    this.body.add(visor);

    // A belt and a backpack, where gadgets mount.
    const belt = new Mesh(new CapsuleGeometry(r * 1.02, 0.06, 4, 16), trim);
    belt.position.y = h * 0.45;
    belt.scale.set(1, 0.3, 1);
    this.body.add(belt);
    const pack = new Mesh(new CapsuleGeometry(0.2, 0.35, 4, 10), trim);
    pack.position.set(0, h * 0.6, r * 0.9);
    pack.castShadow = !ghost;
    this.body.add(pack);

    const antenna = new Mesh(new SphereGeometry(0.07, 10, 8), glow);
    antenna.position.set(0.18, h + 0.12, 0.05);
    this.body.add(antenna);

    // Rollerblades: two skate boots with glowing wheels, shown only when equipped.
    for (const side of [-1, 1]) {
      const boot = new Mesh(new CapsuleGeometry(0.1, 0.32, 4, 8), trim);
      boot.rotation.x = Math.PI / 2;
      boot.position.set(side * 0.17, 0.12, -0.02);
      const wheels = new Mesh(new CapsuleGeometry(0.05, 0.34, 4, 8), glow);
      wheels.rotation.x = Math.PI / 2;
      wheels.position.set(side * 0.17, 0.03, -0.02);
      this.skates.add(boot, wheels);
    }
    this.skates.visible = false;
    this.body.add(this.skates);

    this.root.add(this.body);
  }

  setSkates(on: boolean): void {
    this.skates.visible = on;
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

  /** Rollerblade tuck: crouch and lean further in. */
  setTuck(on: boolean, dt: number): void {
    this.tuck += ((on ? 1 : 0) - this.tuck) * follow(10, dt);
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

    if (landed > 0) this.squashVel -= Math.min(6, 1.2 + landed * 0.18);
    if (jumped) this.squashVel += 3.5;
    // Damped spring back to rest.
    this.squashVel += (-this.squash * 220 - this.squashVel * 16) * dt;
    this.squash = MathUtils.clamp(this.squash + this.squashVel * dt, -0.35, 0.3);

    this.root.rotation.set(0, this.yaw, 0);
    // Mantle: reach forward over the lip early, straighten as you pull up.
    const reachLean = this.reach >= 0 ? 0.7 * Math.sin(Math.PI * Math.min(1, this.reach)) : 0;
    this.body.rotation.set(-this.lean - this.tuck * 0.35 + this.slideLean * 0.9 - reachLean, 0, this.bank);
    const sy = 1 + this.squash - this.tuck * 0.18 - this.low * 0.45;
    const sxz = 1 / Math.sqrt(sy);
    this.body.scale.set(sxz, sy, sxz);
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
