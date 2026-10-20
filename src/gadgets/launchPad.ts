import { Vector3 } from 'three';
import { DT, LAUNCH_PAD_CONFIG, USAGE_CONFIG } from '../config';
import { type Box, raycast } from '../sim/collision';
import { type MovementConfig, type PlayerState, launchPlayer } from '../sim/player';
import { handPosition } from './grapple';
import { type GadgetContext, GadgetEvent, GadgetId, type GadgetRuntime } from './types';

export interface Pad {
  pos: Vector3;
  normal: Vector3;
  /** Horizontal unit direction it launches along. */
  heading: Vector3;
  /** Seconds until it can fire again. */
  rearm: number;
}

const hand = new Vector3();
const rel = new Vector3();
const launch = new Vector3();

/** Where a pad thrown along the crosshair would land, or null if out of range or not flat. */
export function padPlacement(boxes: readonly Box[], aimOrigin: Vector3, aimDir: Vector3, player: PlayerState): { pos: Vector3; normal: Vector3 } | null {
  const c = LAUNCH_PAD_CONFIG;
  handPosition(player, hand);
  // The aim ray starts at the camera behind the player, so it may travel a bit farther.
  const hit = raycast(boxes, aimOrigin, aimDir, c.throwRange + aimOrigin.distanceTo(hand));
  if (!hit || hit.normal.y < c.minSurfaceUpY || hit.point.distanceTo(hand) > c.throwRange) return null;
  return { pos: hit.point, normal: hit.normal };
}

/**
 * Press the gadget button to throw a pad onto the surface under the crosshair. Touching it launches you up and
 * along the direction you were facing when you threw it. One pad at a time.
 */
export class LaunchPadGadget implements GadgetRuntime {
  readonly id = GadgetId.LaunchPad;
  limited = true;
  pad: Pad | null = null;
  private cooldown = 0;
  private launches = 0;

  get usageLabel(): string {
    return this.limited ? `x${Math.max(0, USAGE_CONFIG.padLaunches - this.launches)}` : '∞';
  }

  /** A thrown pad stays and still works after switching away. */
  unequip(): void {}

  /** Re-throwing is free: only launches count. */
  get remaining(): number {
    return this.limited ? Math.max(0, 1 - this.launches / USAGE_CONFIG.padLaunches) : 1;
  }

  movement(base: MovementConfig): MovementConfig {
    return base;
  }

  beforeMove(ctx: GadgetContext): void {
    this.cooldown = Math.max(0, this.cooldown - DT);
    if (this.pad) this.pad.rearm = Math.max(0, this.pad.rearm - DT);
    const { input } = ctx;
    if (!input.pressed || this.cooldown > 0 || this.remaining <= 0) return;
    this.cooldown = LAUNCH_PAD_CONFIG.throwCooldown;
    const spot = padPlacement(ctx.boxes, input.aimOrigin, input.aimDir, ctx.player);
    if (!spot) {
      ctx.emit(GadgetEvent.PadInvalid);
      return;
    }
    this.pad = {
      pos: spot.pos.clone(),
      normal: spot.normal.clone(),
      heading: new Vector3(-Math.sin(input.yaw), 0, -Math.cos(input.yaw)),
      rearm: 0,
    };
    ctx.emit(GadgetEvent.PadPlaced);
  }

  afterMove(ctx: GadgetContext): void {
    const pad = this.pad;
    if (!pad || pad.rearm > 0) return;
    const p = ctx.player;
    const c = LAUNCH_PAD_CONFIG;
    rel.subVectors(p.pos, pad.pos);
    const above = rel.dot(pad.normal);
    if (above < -0.3 || above > c.triggerHeight) return;
    rel.addScaledVector(pad.normal, -above);
    if (rel.length() > c.triggerRadius) return;

    const along = Math.max(0, p.vel.x * pad.heading.x + p.vel.z * pad.heading.z);
    launch.copy(pad.heading).multiplyScalar(c.launchHorizontal + c.keepAlongSpeed * along);
    launch.y = c.launchVertical;
    launchPlayer(p, launch);
    pad.rearm = c.rearmSeconds;
    this.launches++;
    // Out of launches: the pad is done.
    if (this.remaining <= 0) this.pad = null;
    ctx.emit(GadgetEvent.PadLaunched);
  }

  resetTransientState(_player: PlayerState): void {
    this.pad = null;
    this.cooldown = 0;
  }
}
