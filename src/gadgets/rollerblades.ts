import { DT, ROLLERBLADE_CONFIG, USAGE_CONFIG } from '../config';
import type { MovementConfig, PlayerState } from '../sim/player';
import { type GadgetContext, GadgetEvent, GadgetId, type GadgetRuntime } from './types';

/**
 * Off until you press the gadget button: then you roll. Pushing tops out a little above running speed, but speed
 * from slopes barely bleeds away, and turns are wider. Once on, hold the button to tuck for even
 * less drag and more downhill pull, at the cost of steering.
 */
export class RollerbladeGadget implements GadgetRuntime {
  readonly id = GadgetId.Rollerblades;
  limited = true;
  /** Skates on: switched on by the first press, and the countdown only runs from then. */
  active = false;
  tucking = false;
  /** The press that put the skates on must be let go before a hold counts as a tuck. */
  private awaitingRelease = false;
  /** Seconds spent rolling on the ground; air time is free. */
  private rolled = 0;

  get remaining(): number {
    return this.limited ? Math.max(0, 1 - this.rolled / USAGE_CONFIG.rollerbladeSeconds) : 1;
  }
  private readonly cfg = {} as MovementConfig;

  movement(base: MovementConfig, ctx: GadgetContext): MovementConfig {
    const r = ROLLERBLADE_CONFIG;
    if (!this.active) {
      if (!ctx.input.pressed) return base;
      this.active = true;
      this.awaitingRelease = true;
      ctx.emit(GadgetEvent.SkatesOn);
    }
    if (!ctx.input.held) this.awaitingRelease = false;
    if (ctx.player.grounded) this.rolled += DT;
    const tuck = ctx.input.held && !this.awaitingRelease;
    if (tuck !== this.tucking) {
      this.tucking = tuck;
      ctx.emit(tuck ? GadgetEvent.TuckStarted : GadgetEvent.TuckEnded);
    }
    Object.assign(this.cfg, base);
    this.cfg.groundSpeed = r.pushSpeed;
    this.cfg.groundAcceleration = tuck ? 0 : r.pushAcceleration;
    this.cfg.groundDeceleration = r.coastDeceleration;
    this.cfg.groundedFriction = tuck ? r.tuckFriction : r.friction;
    this.cfg.slopeInfluence = tuck ? r.tuckSlopeInfluence : r.slopeInfluence;
    this.cfg.turnGrip = tuck ? r.tuckTurnGrip : r.turnGrip;
    this.cfg.brakeDeceleration = r.brakeDeceleration;
    return this.cfg;
  }

  beforeMove(): void {}

  afterMove(): void {}

  resetTransientState(_player: PlayerState): void {
    this.tucking = false;
  }
}
