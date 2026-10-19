import { Vector3 } from 'three';
import { DT, GRAPPLE_CONFIG, USAGE_CONFIG } from '../config';
import { type Box, raycast } from '../sim/collision';
import { type MovementConfig, type PlayerState, depenetrate } from '../sim/player';
import { type GadgetContext, GadgetEvent, GadgetId, type GadgetRuntime } from './types';

const toAnchor = new Vector3();
const hand = new Vector3();
const dir = new Vector3();

/** Where the rope meets the body. */
export function handPosition(p: PlayerState, out: Vector3): Vector3 {
  return out.set(p.pos.x, p.pos.y + GRAPPLE_CONFIG.handHeight, p.pos.z);
}

/** True when nothing solid lies between `from` and the anchor. */
function clearLine(boxes: readonly Box[], from: Vector3, anchor: Vector3): boolean {
  dir.subVectors(anchor, from);
  const dist = dir.length();
  if (dist < 1e-6) return true;
  // Stop a little short, in case an anchor sits right against a surface.
  return raycast(boxes, from, dir.divideScalar(dist), dist - 0.5) === null;
}

/**
 * The anchor the crosshair is on: within range of the player, inside the aim-assist cone, and
 * in line of sight. Picks the one closest to the crosshair. Returns its index, or -1.
 */
export function findGrappleTarget(
  anchors: readonly Vector3[],
  boxes: readonly Box[],
  aimOrigin: Vector3,
  aimDir: Vector3,
  player: PlayerState,
): number {
  const cosCone = Math.cos((GRAPPLE_CONFIG.aimConeDegrees * Math.PI) / 180);
  handPosition(player, hand);
  let best = -1;
  let bestCos = cosCone;
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i];
    if (a.distanceTo(hand) > GRAPPLE_CONFIG.range) continue;
    toAnchor.subVectors(a, aimOrigin).normalize();
    const c = toAnchor.dot(aimDir);
    if (c < bestCos) continue;
    if (!clearLine(boxes, hand, a)) continue;
    best = i;
    bestCos = c;
  }
  return best;
}

/**
 * Hold to latch onto the anchor under the crosshair: a rope you swing beneath while it reels you
 * in. Let go to release, keeping your speed plus a small boost.
 */
export class GrappleGadget implements GadgetRuntime {
  readonly id = GadgetId.Grapple;
  limited = true;
  /** Index into the course anchors while attached, else -1. */
  anchorIndex = -1;
  private length = 0;
  private swings = 0;

  /** Misses are free: only finished swings count. */
  get remaining(): number {
    return this.limited ? Math.max(0, 1 - this.swings / USAGE_CONFIG.grappleSwings) : 1;
  }

  get attached(): boolean {
    return this.anchorIndex >= 0;
  }

  movement(base: MovementConfig): MovementConfig {
    return base;
  }

  beforeMove(ctx: GadgetContext): void {
    const { player: p, input } = ctx;
    if (!this.attached) {
      if (!input.pressed || this.remaining <= 0) return;
      const target = findGrappleTarget(ctx.anchors, ctx.boxes, input.aimOrigin, input.aimDir, p);
      if (target < 0) {
        ctx.emit(GadgetEvent.GrappleMissed);
        return;
      }
      this.anchorIndex = target;
      this.length = handPosition(p, hand).distanceTo(ctx.anchors[target]);
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

    const anchor = ctx.anchors[this.anchorIndex];
    this.length = Math.max(GRAPPLE_CONFIG.minLength, this.length - GRAPPLE_CONFIG.reelSpeed * DT);
    toAnchor.subVectors(anchor, handPosition(p, hand));
    const dist = toAnchor.length();
    if (dist > 1e-6) p.vel.addScaledVector(toAnchor, (GRAPPLE_CONFIG.pullAcceleration * DT) / dist);
  }

  afterMove(ctx: GadgetContext): void {
    if (!this.attached) return;
    const p = ctx.player;
    const anchor = ctx.anchors[this.anchorIndex];
    handPosition(p, hand);
    // The rope snaps if the course gets between you and the anchor.
    if (!clearLine(ctx.boxes, hand, anchor)) {
      this.release(p, false);
      ctx.emit(GadgetEvent.GrappleReleased);
      return;
    }
    toAnchor.subVectors(hand, anchor);
    const dist = toAnchor.length();
    if (dist <= this.length || dist < 1e-6) return;
    // Taut rope: back onto the sphere, and no speed outward along it.
    toAnchor.divideScalar(dist);
    p.pos.addScaledVector(toAnchor, this.length - dist);
    const outward = p.vel.dot(toAnchor);
    if (outward > 0) p.vel.addScaledVector(toAnchor, -outward);
    depenetrate(p, ctx.boxes);
  }

  private release(p: PlayerState, boost = true): void {
    this.anchorIndex = -1;
    this.swings++;
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
    if (this.attached) this.swings++;
    this.anchorIndex = -1;
    this.length = 0;
    p.tethered = false;
  }
}
