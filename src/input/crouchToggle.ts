// Crouch as a toggle: press once to crouch or slide, again to stand, so a finger is free to jump
// mid-slide. It lets go by itself when a jump fires (you come out of a slide standing, the burst
// still fires), on landing after a tuck switched on in the air, and on a respawn.

export type CrouchMode = 'toggle' | 'hold';

export class CrouchToggle {
  /** Crouch switched on (toggle mode). */
  on = false;
  /** Switched on while in the air (a tuck): landing lets go. */
  private fromAir = false;

  /** A crouch press this frame. */
  press(grounded: boolean): void {
    this.on = !this.on;
    this.fromAir = this.on && !grounded;
  }

  /** After each sim tick: what happened to the player. */
  afterTick(p: { justJumped: boolean; justLanded: boolean }): void {
    if (p.justJumped) this.release();
    else if (p.justLanded && this.fromAir) this.release();
  }

  release(): void {
    this.on = false;
    this.fromAir = false;
  }

  /** Whether crouch is in effect this tick, in either mode. */
  held(mode: CrouchMode, buttonHeld: boolean): boolean {
    return mode === 'toggle' ? this.on : buttonHeld;
  }
}
