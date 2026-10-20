import { describe, expect, it } from 'vitest';
import { CrouchToggle } from './crouchToggle';

const tick = { justJumped: false, justLanded: false, vel: { x: 0, z: 0 } };
const fast = { x: 0, z: -14 };
const slow = { x: 0, z: -8 };

describe('crouch toggle', () => {
  it('a press switches it on, another off; holding the button does nothing in toggle mode', () => {
    const c = new CrouchToggle();
    c.press(true);
    expect(c.held('toggle', false)).toBe(true);
    c.press(true);
    expect(c.held('toggle', true)).toBe(false);
    expect(c.held('hold', true)).toBe(true);
  });

  it('a jump lets go, so you come out of a slide standing', () => {
    const c = new CrouchToggle();
    c.press(true);
    c.afterTick({ ...tick, justJumped: true });
    expect(c.on).toBe(false);
  });

  it('pressed in the air: stays on through the landing (a slide) when fast enough, lets go when slow', () => {
    const fastLanding = new CrouchToggle();
    fastLanding.press(false);
    fastLanding.afterTick(tick);
    expect(fastLanding.on).toBe(true);
    fastLanding.afterTick({ ...tick, justLanded: true, vel: fast });
    expect(fastLanding.on).toBe(true);
    // Decided once: a later landing (after sliding off an edge) doesn't let go.
    fastLanding.afterTick({ ...tick, justLanded: true, vel: slow });
    expect(fastLanding.on).toBe(true);

    const slowLanding = new CrouchToggle();
    slowLanding.press(false);
    slowLanding.afterTick({ ...tick, justLanded: true, vel: slow });
    expect(slowLanding.on).toBe(false);
  });

  it('switched on on the ground, a landing (sliding off an edge) does not let go', () => {
    const ground = new CrouchToggle();
    ground.press(true);
    ground.afterTick({ ...tick, justLanded: true, vel: slow });
    expect(ground.on).toBe(true);
  });
});
