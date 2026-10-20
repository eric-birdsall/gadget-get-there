import { describe, expect, it } from 'vitest';
import { CrouchToggle } from './crouchToggle';

const tick = { justJumped: false, justLanded: false };

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

  it('switched on in the air (a tuck), landing lets go; switched on on the ground, landing does not', () => {
    const air = new CrouchToggle();
    air.press(false);
    air.afterTick(tick);
    expect(air.on).toBe(true);
    air.afterTick({ ...tick, justLanded: true });
    expect(air.on).toBe(false);

    const ground = new CrouchToggle();
    ground.press(true);
    ground.afterTick({ ...tick, justLanded: true });
    expect(ground.on).toBe(true);
  });
});
