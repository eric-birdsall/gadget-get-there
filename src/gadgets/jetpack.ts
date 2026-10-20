import { DT, JETPACK_CONFIG, USAGE_CONFIG } from '../config';
import type { MovementConfig, PlayerState } from '../sim/player';
import { type GadgetContext, GadgetEvent, GadgetId, type GadgetRuntime } from './types';

/**
 * Hold the button to thrust upward, from the ground or in the air; you steer as usual. Fuel only
 * burns while thrusting.
 */
export class JetpackGadget implements GadgetRuntime {
  readonly id = GadgetId.Jetpack;
  limited = true;
  thrusting = false;
  /** Seconds of fuel burned. */
  /** Swings, launches, seconds or dashes used so far. */
  used = 0;

  get remaining(): number {
    return this.limited ? Math.max(0, 1 - this.used / USAGE_CONFIG.jetpackSeconds) : 1;
  }

  get usageLabel(): string {
    if (!this.limited) return '∞';
    return `${Math.max(0, USAGE_CONFIG.jetpackSeconds - this.used).toFixed(1)}s`;
  }

  movement(base: MovementConfig): MovementConfig {
    return base;
  }

  beforeMove(ctx: GadgetContext): void {
    const p = ctx.player;
    const on = ctx.input.held && this.remaining > 0 && !p.tethered && !p.mantle;
    if (on !== this.thrusting) {
      this.thrusting = on;
      ctx.emit(on ? GadgetEvent.JetpackOn : GadgetEvent.JetpackOff);
    }
    if (!on) return;
    const c = JETPACK_CONFIG;
    if (p.grounded) {
      // Lift off: unstick from the ground for a moment.
      p.grounded = false;
      p.airborneLock = Math.max(p.airborneLock, 0.1);
      p.vel.y = Math.max(p.vel.y, c.liftoffSpeed);
    }
    // Thrust against gravity (which the move applies afterwards), up to a top climbing speed.
    p.vel.y = Math.min(c.maxRiseSpeed, p.vel.y + c.thrust * DT);
    this.used += DT;
  }

  afterMove(): void {}

  unequip(): void {
    this.thrusting = false;
  }

  resetTransientState(_player: PlayerState): void {
    this.thrusting = false;
  }
}
