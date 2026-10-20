import { CAMERA_CONFIG, KEY_LOOK_CONFIG } from '../config';

/** Keyboard look's memory between frames. */
export interface KeyLookState {
  /** Seconds the current turn (left/right) and tilt (up/down) have been held, for the ramp. */
  turnHeld: number;
  tiltHeld: number;
  /** Seconds since a tilt key was last held. */
  sinceTilt: number;
  /** The keys tilted the view last (not the mouse), so it may ease back to level. */
  keyTilted: boolean;
}

export const newKeyLookState = (): KeyLookState => ({ turnHeld: 0, tiltHeld: 0, sinceTilt: Infinity, keyTilted: false });

export interface KeyLookInput {
  /** +1 turns right, −1 left. */
  turn: number;
  /** +1 looks up, −1 down. */
  tilt: number;
}

export interface KeyLookOptions {
  /** Multiplies both turn speeds (the Settings slider). */
  speed: number;
  invertY: boolean;
  autoLevel: boolean;
}

/** Speed for a key held `held` seconds: a tap nudges, holding ramps up to the full rate. */
function ramp(held: number, max: number): number {
  const c = KEY_LOOK_CONFIG;
  const t = Math.min(1, held / c.rampSeconds);
  return max * (c.startFraction + (1 - c.startFraction) * t * t * (3 - 2 * t));
}

/** Moves the view one frame from held look keys. Returns the new yaw and pitch. */
export function stepKeyLook(
  s: KeyLookState,
  keys: KeyLookInput,
  view: { yaw: number; pitch: number },
  dt: number,
  o: KeyLookOptions,
): { yaw: number; pitch: number } {
  const c = KEY_LOOK_CONFIG;
  let { yaw, pitch } = view;
  s.turnHeld = keys.turn ? s.turnHeld + dt : 0;
  s.tiltHeld = keys.tilt ? s.tiltHeld + dt : 0;
  if (keys.turn) yaw -= keys.turn * ramp(s.turnHeld, c.turnSpeed * o.speed) * dt;
  if (keys.tilt) {
    // Positive pitch looks down.
    pitch -= keys.tilt * (o.invertY ? -1 : 1) * ramp(s.tiltHeld, c.tiltSpeed * o.speed) * dt;
    s.sinceTilt = 0;
    s.keyTilted = true;
  } else {
    s.sinceTilt += dt;
    // Let go of up/down: drift back to the usual view, so you don't end up staring at the floor.
    if (o.autoLevel && s.keyTilted && s.sinceTilt > c.levelDelay) {
      pitch += (CAMERA_CONFIG.defaultPitch - pitch) * (1 - Math.exp(-c.levelRate * dt));
    }
  }
  pitch = Math.min(CAMERA_CONFIG.maxPitch, Math.max(CAMERA_CONFIG.minPitch, pitch));
  return { yaw, pitch };
}
