import { Vector3 } from 'three';
import { DASH_CONFIG, DT, USAGE_CONFIG } from '../config';
import type { MovementConfig, PlayerState } from '../sim/player';
import { type GadgetContext, GadgetEvent, GadgetId, type GadgetRuntime } from './types';

const dir = new Vector3();

/**
 * Press for a short, fast burst the way you're going (or, standing still, the way you're
 * looking), on the ground or in the air.
 */
export class DashGadget implements GadgetRuntime {
  readonly id = GadgetId.Dash;
  limited = true;
  /** Seconds since the last dash, for the trail effect; large when none. */
  sinceDash = Infinity;
  private dashes = 0;
  private cooldown = 0;

  get remaining(): number {
    return this.limited ? Math.max(0, 1 - this.dashes / USAGE_CONFIG.dashes) : 1;
  }

  get usageLabel(): string {
    return this.limited ? `x${Math.max(0, USAGE_CONFIG.dashes - this.dashes)}` : '∞';
  }

  movement(base: MovementConfig): MovementConfig {
    return base;
  }

  beforeMove(ctx: GadgetContext): void {
    this.cooldown = Math.max(0, this.cooldown - DT);
    this.sinceDash += DT;
    const { player: p, input } = ctx;
    if (!input.pressed || this.cooldown > 0 || this.remaining <= 0 || p.tethered || p.mantle) return;
    const c = DASH_CONFIG;
    const speed = Math.hypot(p.vel.x, p.vel.z);
    if (speed > 1) dir.set(p.vel.x / speed, 0, p.vel.z / speed);
    else dir.set(-Math.sin(input.yaw), 0, -Math.cos(input.yaw));
    const along = Math.max(0, p.vel.x * dir.x + p.vel.z * dir.z);
    const burst = Math.max(c.speed, along + c.boostOverCurrent);
    p.vel.x = dir.x * burst;
    p.vel.z = dir.z * burst;
    // Level out: a dash never starts by dropping.
    p.vel.y = Math.max(p.vel.y, c.minLift);
    this.dashes++;
    this.cooldown = c.cooldown;
    this.sinceDash = 0;
    ctx.emit(GadgetEvent.Dashed);
  }

  afterMove(): void {}

  unequip(): void {}

  resetTransientState(_player: PlayerState): void {
    this.cooldown = 0;
    this.sinceDash = Infinity;
  }
}
