import { Vector3 } from 'three';
import { DT, GRAPPLE_CONFIG, USAGE_CONFIG } from '../config';
import { type Box, SurfaceKind, raycast } from '../sim/collision';
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
  kind: SurfaceKind;
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
  return { point, normal: hit.normal, kind: hit.box.kind };
}

const assistDir = new Vector3();
const assistSide = new Vector3();
const assistUp = new Vector3();
/** Rings of directions searched around the crosshair, as fractions of the assist angle, and how many on each. */
const ASSIST_RINGS = [0.3, 0.55, 0.8, 1];
const ASSIST_SPOKES = 16;

/**
 * Controller aim assist for the grapple: the hook point under the crosshair if there is one,
 * unless a grapple beam is a hair away (beams are almost always what you meant); with nothing
 * under the crosshair, the hook point nearest to it within the assist angle. Null if none.
 */
export function assistedGrappleTarget(boxes: readonly Box[], aimOrigin: Vector3, aimDir: Vector3, player: PlayerState): GrappleTarget | null {
  const direct = findGrappleTarget(boxes, aimOrigin, aimDir, player);
  if (direct?.kind === SurfaceKind.Overhead) return direct;
  const maxDeg = direct ? GRAPPLE_CONFIG.aimAssistBeamDegrees : GRAPPLE_CONFIG.aimAssistDegrees;
  // Two directions across the aim, to tilt it round in a ring.
  assistSide.set(0, 1, 0).cross(aimDir);
  if (assistSide.lengthSq() < 1e-6) assistSide.set(1, 0, 0);
  assistSide.normalize();
  assistUp.crossVectors(aimDir, assistSide).normalize();
  let best: GrappleTarget | null = null;
  let bestScore = Infinity;
  for (const ring of ASSIST_RINGS) {
    const tilt = Math.tan((ring * maxDeg * Math.PI) / 180);
    for (let i = 0; i < ASSIST_SPOKES; i++) {
      const a = (i / ASSIST_SPOKES) * Math.PI * 2;
      assistDir.copy(aimDir).addScaledVector(assistSide, Math.cos(a) * tilt).addScaledVector(assistUp, Math.sin(a) * tilt).normalize();
      const t = findGrappleTarget(boxes, aimOrigin, assistDir, player);
      // With a hook point already under the crosshair, only a beam is worth leaving it for.
      if (!t || (direct && t.kind !== SurfaceKind.Overhead)) continue;
      // Nearest to the crosshair wins; beams count as a little nearer.
      const score = ring - (t.kind === SurfaceKind.Overhead ? 0.15 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    // The innermost ring with anything in it is close enough: stop there.
    if (best && !direct) break;
  }
  return best ?? direct;
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

  /** Another gadget cut the rope (or a mantle ended the swing): let go with no boost; the swing counts. */
  unequip(p: PlayerState): void {
    if (this.attached) this.release(p, false);
  }

  /** Misses are free: only finished swings count. */
  get remaining(): number {
    return this.limited ? Math.max(0, 1 - this.used / USAGE_CONFIG.grappleSwings) : 1;
  }

  get active(): boolean {
    return this.attached;
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
