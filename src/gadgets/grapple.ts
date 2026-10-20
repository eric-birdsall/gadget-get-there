import { Vector3 } from 'three';
import { DT, GRAPPLE_CONFIG, USAGE_CONFIG } from '../config';
import { type Box, raycast } from '../sim/collision';
import { type MovementConfig, type PlayerState, depenetrate } from '../sim/player';
import { type GadgetContext, GadgetEvent, GadgetId, type GadgetRuntime } from './types';

const toPoint = new Vector3();
const hand = new Vector3();
const dir = new Vector3();

/** Where the rope meets the body. */
export function handPosition(p: PlayerState, out: Vector3): Vector3 {
  return out.set(p.pos.x, p.pos.y + GRAPPLE_CONFIG.handHeight, p.pos.z);
}

/** Stop the line-of-sight check this far short: the rope is fixed to a surface, so its end always touches one. */
const ROPE_END_CLEARANCE = 0.8;

/** True when nothing solid lies between `from` and the rope's end. */
function clearLine(boxes: readonly Box[], from: Vector3, point: Vector3): boolean {
  dir.subVectors(point, from);
  const dist = dir.length();
  if (dist <= ROPE_END_CLEARANCE) return true;
  return raycast(boxes, from, dir.divideScalar(dist), dist - ROPE_END_CLEARANCE) === null;
}

export interface GrappleTarget {
  point: Vector3;
  normal: Vector3;
}

/**
 * Where the hook would land: the first surface under the crosshair, if it's within range of the
 * player and the rope from the hand to it would be clear. Any surface works.
 */
export function findGrappleTarget(boxes: readonly Box[], aimOrigin: Vector3, aimDir: Vector3, player: PlayerState): GrappleTarget | null {
  handPosition(player, hand);
  // The crosshair ray starts at the camera behind the player, so it may travel a bit farther.
  const hit = raycast(boxes, aimOrigin, aimDir, GRAPPLE_CONFIG.range + aimOrigin.distanceTo(hand));
  if (!hit || hit.point.distanceTo(hand) > GRAPPLE_CONFIG.range) return null;
  const point = hit.point.clone().addScaledVector(hit.normal, 0.05);
  if (!clearLine(boxes, hand, point)) return null;
  return { point, normal: hit.normal };
}

/**
 * Hold to fire the hook at whatever surface is under the crosshair: a rope you swing beneath
 * while it reels you in. Let go to release, keeping your speed plus a small boost.
 */
export class GrappleGadget implements GadgetRuntime {
  readonly id = GadgetId.Grapple;
  limited = true;
  /** Where the rope is fixed while attached, else null. */
  point: Vector3 | null = null;
  private length = 0;
  /** Swings, launches, seconds or dashes used so far. */
  used = 0;

  get usageLabel(): string {
    return this.limited ? `x${Math.max(0, USAGE_CONFIG.grappleSwings - this.used)}` : '∞';
  }

  /** Switching away lets go of the rope; the swing counts. */
  unequip(p: PlayerState): void {
    if (this.attached) this.release(p, false);
  }

  /** Misses are free: only finished swings count. */
  get remaining(): number {
    return this.limited ? Math.max(0, 1 - this.used / USAGE_CONFIG.grappleSwings) : 1;
  }

  get attached(): boolean {
    return this.point !== null;
  }

  movement(base: MovementConfig): MovementConfig {
    return base;
  }

  beforeMove(ctx: GadgetContext): void {
    const { player: p, input } = ctx;
    if (!this.point) {
      if (!input.pressed || this.remaining <= 0) return;
      const target = findGrappleTarget(ctx.boxes, input.aimOrigin, input.aimDir, p);
      if (!target) {
        ctx.emit(GadgetEvent.GrappleMissed);
        return;
      }
      this.point = target.point;
      this.length = handPosition(p, hand).distanceTo(target.point);
      if (p.grounded) p.vel.y = Math.max(p.vel.y, 0) + GRAPPLE_CONFIG.attachHop;
      p.tethered = true;
      p.grounded = false;
      ctx.emit(GadgetEvent.GrappleAttached);
      return;
    }

    if (!input.held) {
      this.release(p);
      ctx.emit(GadgetEvent.GrappleReleased);
      return;
    }

    this.length = Math.max(GRAPPLE_CONFIG.minLength, this.length - GRAPPLE_CONFIG.reelSpeed * DT);
    toPoint.subVectors(this.point, handPosition(p, hand));
    const dist = toPoint.length();
    if (dist > 1e-6) p.vel.addScaledVector(toPoint, (GRAPPLE_CONFIG.pullAcceleration * DT) / dist);
  }

  afterMove(ctx: GadgetContext): void {
    if (!this.point) return;
    const p = ctx.player;
    handPosition(p, hand);
    // The rope snaps if the course gets between you and where it's fixed.
    if (!clearLine(ctx.boxes, hand, this.point)) {
      this.release(p, false);
      ctx.emit(GadgetEvent.GrappleReleased);
      return;
    }
    toPoint.subVectors(hand, this.point);
    const dist = toPoint.length();
    if (dist <= this.length || dist < 1e-6) return;
    // Taut rope: back onto the sphere, and no speed outward along it.
    toPoint.divideScalar(dist);
    p.pos.addScaledVector(toPoint, this.length - dist);
    const outward = p.vel.dot(toPoint);
    if (outward > 0) p.vel.addScaledVector(toPoint, -outward);
    depenetrate(p, ctx.boxes);
  }

  private release(p: PlayerState, boost = true): void {
    this.point = null;
    this.used++;
    p.tethered = false;
    if (!boost) return;
    const speed = p.vel.length();
    if (speed > 1e-3 && speed < GRAPPLE_CONFIG.releaseSpeedCap) {
      const target = Math.min(GRAPPLE_CONFIG.releaseSpeedCap, speed + GRAPPLE_CONFIG.releaseBoost);
      p.vel.multiplyScalar(target / speed);
    }
  }

  resetTransientState(p: PlayerState): void {
    // Losing the rope mid-swing (a respawn, a mantle) still used the swing.
    if (this.attached) this.used++;
    this.point = null;
    this.length = 0;
    p.tethered = false;
  }
}
