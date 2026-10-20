import { Vector3 } from 'three';
import { DT, MOVEMENT_CONFIG, USAGE_CONFIG, WINGSUIT_CONFIG } from '../config';
import type { MovementConfig, PlayerState } from '../sim/player';
import { type GadgetContext, GadgetEvent, GadgetId, type GadgetRuntime } from './types';

const horiz = new Vector3();

/**
 * Hold the button in the air to glide where you're looking: a slow sink that turns height into
 * distance. Look down to dive and build speed; look up to flare and float. Glide time only
 * counts while gliding.
 */
export class WingsuitGadget implements GadgetRuntime {
  readonly id = GadgetId.Wingsuit;
  limited = true;
  gliding = false;

  get active(): boolean {
    return this.gliding;
  }
  /** Seconds of glide used. */
  used = 0;

  get remaining(): number {
    return this.limited ? Math.max(0, 1 - this.used / USAGE_CONFIG.wingsuitSeconds) : 1;
  }

  get usageLabel(): string {
    if (!this.limited) return '∞';
    return `${Math.max(0, USAGE_CONFIG.wingsuitSeconds - this.used).toFixed(1)}s`;
  }

  movement(base: MovementConfig): MovementConfig {
    return base;
  }

  beforeMove(ctx: GadgetContext): void {
    const { player: p, input } = ctx;
    // Pauses (spending nothing) while hooked or while the jetpack thrusts, and carries on after.
    const on = input.held && !p.grounded && !p.tethered && !p.jetting && !p.mantle && !p.wallRun && this.remaining > 0;
    if (on !== this.gliding) {
      this.gliding = on;
      ctx.emit(on ? GadgetEvent.GlideStarted : GadgetEvent.GlideEnded);
    }
    if (!on) return;
    const c = WINGSUIT_CONFIG;
    // Looking down (+) dives, looking up (−) flares.
    const dive = Math.max(-c.maxFlare, Math.min(c.maxDive, -input.aimDir.y));
    // Lift: cancel gravity (the move adds it back), then ease the fall toward a gentle sink.
    const targetFall = c.sink + dive * c.diveSink;
    p.vel.y += MOVEMENT_CONFIG.gravity * DT;
    const dy = -targetFall - p.vel.y;
    p.vel.y += Math.sign(dy) * Math.min(Math.abs(dy), c.lift * DT);
    // Glide where you look: turn toward the camera heading, and settle on a glide speed.
    const speed = Math.hypot(p.vel.x, p.vel.z);
    const targetSpeed = Math.max(c.minSpeed, c.speed + dive * c.diveSpeed);
    const nextSpeed = speed + Math.sign(targetSpeed - speed) * Math.min(Math.abs(targetSpeed - speed), c.acceleration * DT);
    horiz.set(-Math.sin(input.yaw), 0, -Math.cos(input.yaw));
    if (speed > 0.5) {
      const cur = Math.atan2(p.vel.x, p.vel.z);
      const want = Math.atan2(horiz.x, horiz.z);
      const turn = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
      const a = cur + Math.sign(turn) * Math.min(Math.abs(turn), c.turnRate * DT);
      horiz.set(Math.sin(a), 0, Math.cos(a));
    }
    p.vel.x = horiz.x * nextSpeed;
    p.vel.z = horiz.z * nextSpeed;
    this.used += DT;
  }

  afterMove(): void {}

  unequip(): void {
    this.gliding = false;
  }

  resetTransientState(_player: PlayerState): void {
    this.gliding = false;
  }
}
