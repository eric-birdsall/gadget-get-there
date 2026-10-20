import { describe, expect, it } from 'vitest';
import { CAMERA_CONFIG, KEY_LOOK_CONFIG } from '../config';
import { newKeyLookState, stepKeyLook } from './keyLook';

const opts = { speed: 1, invertY: false, autoLevel: true };
const dt = 1 / 60;

/** Holds `keys` for `seconds` from a level view; returns where it ends up. */
function hold(seconds: number, turn: number, tilt: number, o = opts) {
  const s = newKeyLookState();
  let view = { yaw: 0, pitch: CAMERA_CONFIG.defaultPitch };
  for (let t = 0; t < seconds - 1e-9; t += dt) view = stepKeyLook(s, { turn, tilt }, view, dt, o);
  return { s, view };
}

describe('keyboard look', () => {
  it('a tap nudges; holding ramps up to the full turn rate', () => {
    const tap = hold(0.05, 1, 0).view.yaw;
    expect(-tap).toBeLessThan(KEY_LOOK_CONFIG.turnSpeed * 0.05 * 0.5);
    const long = hold(1.35, 1, 0).view.yaw - hold(0.35, 1, 0).view.yaw;
    // Over the last second, near the full rate.
    expect(-long).toBeGreaterThan(KEY_LOOK_CONFIG.turnSpeed * 0.95);
    // Right turns right: yaw goes down.
    expect(tap).toBeLessThan(0);
  });

  it('up looks up (pitch goes down), within the pitch limits; invert flips it', () => {
    expect(hold(0.3, 0, 1).view.pitch).toBeLessThan(CAMERA_CONFIG.defaultPitch);
    expect(hold(5, 0, 1).view.pitch).toBe(CAMERA_CONFIG.minPitch);
    expect(hold(0.3, 0, 1, { ...opts, invertY: true }).view.pitch).toBeGreaterThan(CAMERA_CONFIG.defaultPitch);
  });

  it('after letting go of up/down it eases back to level, unless turned off', () => {
    for (const autoLevel of [true, false]) {
      const o = { ...opts, autoLevel };
      const { s, view } = hold(0.5, 0, -1, o);
      let v = view;
      for (let t = 0; t < 3; t += dt) v = stepKeyLook(s, { turn: 0, tilt: 0 }, v, dt, o);
      if (autoLevel) expect(v.pitch).toBeCloseTo(CAMERA_CONFIG.defaultPitch, 2);
      else expect(v.pitch).toBe(view.pitch);
    }
  });

  it('leaves a mouse-set tilt alone', () => {
    const s = newKeyLookState();
    const v = stepKeyLook(s, { turn: 0, tilt: 0 }, { yaw: 0, pitch: 1 }, 2, opts);
    expect(v.pitch).toBe(1);
  });
});
