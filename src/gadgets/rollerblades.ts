import { ROLLERBLADE_CONFIG } from '../config';
import type { MovementConfig, PlayerState } from '../sim/player';
import { type GadgetContext, GadgetEvent, GadgetId, type GadgetRuntime } from './types';

/**
 * Always on: you roll. Pushing tops out a little above running speed, but speed from slopes
 * barely bleeds away, and turns are wider. Hold the button to tuck for even less drag and more
 * downhill pull, at the cost of steering.
 */
export class RollerbladeGadget implements GadgetRuntime {
  readonly id = GadgetId.Rollerblades;
  tucking = false;
  private readonly cfg = {} as MovementConfig;

  movement(base: MovementConfig, ctx: GadgetContext): MovementConfig {
    const r = ROLLERBLADE_CONFIG;
    const tuck = ctx.input.held;
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
