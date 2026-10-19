import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DT, MOVEMENT_CONFIG as M } from '../config';
import { ramp, slab, wall } from '../course/build';
import { type Box, makeBox } from './collision';
import { type PlayerInput, type PlayerState, NO_INPUT, createPlayer, horizontalSpeed, stepPlayer } from './player';

const FLOOR = makeBox(slab(0, 0, 0, 400, 400));

function run(p: PlayerState, input: Partial<PlayerInput>, seconds: number, boxes: Box[] = [FLOOR]): void {
  const full = { ...NO_INPUT, ...input };
  for (let t = 0; t < seconds - 1e-9; t += DT) stepPlayer(p, full, boxes);
}

/** A player already standing on the floor. */
function standing(boxes: Box[] = [FLOOR], at = new Vector3(0, 0, 0)): PlayerState {
  const p = createPlayer(at);
  run(p, {}, 0.1, boxes);
  return p;
}

describe('ground movement', () => {
  it('settles onto the floor and stays grounded', () => {
    const p = createPlayer(new Vector3(0, 1, 0));
    run(p, {}, 1);
    expect(p.grounded).toBe(true);
    expect(p.pos.y).toBeCloseTo(0, 3);
  });

  it('reaches ground speed promptly', () => {
    const p = standing();
    run(p, { forward: 1 }, 0.2);
    expect(horizontalSpeed(p)).toBeCloseTo(M.groundSpeed, 3);
    expect(p.vel.z).toBeLessThan(0);
  });

  it('does not run faster diagonally', () => {
    const p = standing();
    run(p, { forward: 1, right: 1 }, 1);
    expect(horizontalSpeed(p)).toBeCloseTo(M.groundSpeed, 3);
  });

  it('stops predictably when input is released', () => {
    const p = standing();
    run(p, { forward: 1 }, 1);
    run(p, {}, M.groundSpeed / M.groundDeceleration + 0.05);
    expect(horizontalSpeed(p)).toBe(0);
  });

  it('bleeds extra speed slowly rather than snapping to top speed', () => {
    const p = standing();
    p.vel.set(0, 0, -25);
    run(p, { forward: 1 }, 0.5);
    expect(horizontalSpeed(p)).toBeCloseTo(25 - M.groundedFriction * 0.5, 1);
  });

  it('walks up and down a moderate ramp without leaving the ground', () => {
    const boxes = [FLOOR, makeBox(ramp([0, 0, -5], [0, 5, -25], 6)), makeBox(slab(0, 5, -35, 6, 20))];
    const p = standing(boxes);
    let airborneTicks = 0;
    for (let t = 0; t < 4; t += DT) {
      stepPlayer(p, { ...NO_INPUT, forward: 1 }, boxes);
      if (!p.grounded) airborneTicks++;
    }
    expect(p.pos.y).toBeCloseTo(5, 2);
    expect(airborneTicks).toBeLessThan(3);
    // Back down.
    airborneTicks = 0;
    for (let t = 0; t < 4; t += DT) {
      stepPlayer(p, { ...NO_INPUT, forward: -1 }, boxes);
      if (!p.grounded) airborneTicks++;
    }
    expect(p.pos.y).toBeCloseTo(0, 2);
    expect(airborneTicks).toBeLessThan(3);
  });

  it('runs up a small ledge but is stopped by a tall one', () => {
    const small = [FLOOR, makeBox(slab(0, 0.3, -17, 6, 20))];
    const p = standing(small);
    run(p, { forward: 1 }, 1.5, small);
    expect(p.pos.y).toBeCloseTo(0.3, 2);
    expect(p.pos.z).toBeLessThan(-8);

    const tall = [FLOOR, makeBox(slab(0, 0.6, -17, 6, 20))];
    const q = standing(tall);
    run(q, { forward: 1 }, 1.5, tall);
    expect(q.pos.y).toBeCloseTo(0, 2);
    expect(q.pos.z).toBeGreaterThan(-7);
  });

  it('slides off a slope steeper than maxGroundAngle', () => {
    const steep = makeBox(ramp([0, 0, 0], [0, 10, -5], 6));
    const p = createPlayer(new Vector3(0, 6, -3));
    run(p, {}, 2, [FLOOR, steep]);
    expect(p.pos.y).toBeLessThan(1);
  });
});

describe('jumping and air control', () => {
  it('jumps to about jumpImpulse²/2g', () => {
    const p = standing();
    let peak = 0;
    stepPlayer(p, { ...NO_INPUT, jump: true }, [FLOOR]);
    expect(p.justJumped).toBe(true);
    for (let t = 0; t < 1; t += DT) {
      stepPlayer(p, { ...NO_INPUT, jump: true }, [FLOOR]);
      peak = Math.max(peak, p.pos.y);
    }
    expect(peak).toBeCloseTo((M.jumpImpulse * M.jumpImpulse) / (2 * M.gravity), 1);
    expect(p.grounded).toBe(true);
  });

  it('holding jump does not bunny-hop', () => {
    const p = standing();
    let jumps = 0;
    for (let t = 0; t < 3; t += DT) {
      stepPlayer(p, { ...NO_INPUT, jump: true }, [FLOOR]);
      if (p.justJumped) jumps++;
    }
    expect(jumps).toBe(1);
  });

  it('buffers a jump pressed just before landing', () => {
    const p = createPlayer(new Vector3(0, 0.5, 0));
    // Fall until just above the floor, then tap jump.
    while (p.pos.y > 0.15) stepPlayer(p, NO_INPUT, [FLOOR]);
    stepPlayer(p, { ...NO_INPUT, jump: true }, [FLOOR]);
    let jumped = p.justJumped;
    for (let t = 0; t < 0.1 && !jumped; t += DT) {
      stepPlayer(p, NO_INPUT, [FLOOR]);
      jumped = p.justJumped;
    }
    expect(jumped).toBe(true);
  });

  it('allows a coyote-time jump just after running off a ledge', () => {
    const ledge = makeBox(slab(0, 0, 0, 4, 4));
    const p = standing([ledge]);
    while (p.grounded) stepPlayer(p, { ...NO_INPUT, forward: 1 }, [ledge]);
    stepPlayer(p, { ...NO_INPUT, forward: 1 }, [ledge]);
    stepPlayer(p, { ...NO_INPUT, forward: 1, jump: true }, [ledge]);
    expect(p.justJumped).toBe(true);
  });

  it('cannot reverse direction instantly in the air', () => {
    const p = standing();
    run(p, { forward: 1 }, 0.5);
    stepPlayer(p, { ...NO_INPUT, forward: -1, jump: true }, [FLOOR]);
    run(p, { forward: -1 }, 0.2);
    // Still moving forward (-Z) after 0.2 s of pulling back.
    expect(p.vel.z).toBeLessThan(0);
  });

  it('air steering never adds speed beyond what you had', () => {
    const p = createPlayer(new Vector3(0, 50, 0));
    p.vel.set(0, 0, -20);
    for (let t = 0; t < 1; t += DT) {
      stepPlayer(p, { ...NO_INPUT, right: 1 }, []);
      expect(horizontalSpeed(p)).toBeLessThanOrEqual(20 + 1e-6);
    }
    expect(p.vel.x).toBeGreaterThan(0);
  });

  it('caps fall speed', () => {
    const p = createPlayer(new Vector3(0, 500, 0));
    run(p, {}, 5, []);
    expect(-p.vel.y).toBeCloseTo(M.maximumFallSpeed);
  });
});

describe('momentum', () => {
  it('launches off a ramp lip and keeps speed into the air', () => {
    const boxes = [makeBox(slab(0, 0, 0, 10, 20)), makeBox(ramp([0, 0, -10], [0, 2, -16], 6))];
    const p = standing(boxes, new Vector3(0, 0, -6));
    p.vel.set(0, 0, -20);
    let launched = false;
    for (let t = 0; t < 2 && !launched; t += DT) {
      stepPlayer(p, { ...NO_INPUT, forward: 1 }, boxes);
      if (!p.grounded && p.pos.z < -16) launched = true;
    }
    expect(launched).toBe(true);
    expect(p.vel.y).toBeGreaterThan(2);
    expect(horizontalSpeed(p)).toBeGreaterThan(15);
  });

  it('gains speed going down a long slope with slope influence', () => {
    const boxes = [makeBox(ramp([0, 40, 0], [0, 0, -150], 10))];
    const p = standing(boxes, new Vector3(0, 39.9, -0.5));
    run(p, { forward: 1 }, 4, boxes);
    expect(horizontalSpeed(p)).toBeGreaterThan(M.groundSpeed);
  });

  it('slides along a wall hit at an angle instead of stopping dead', () => {
    const boxes = [FLOOR, makeBox(wall(0, -3, 40, 1, 0, 4))];
    const p = standing(boxes, new Vector3(0, 0, 0));
    p.vel.set(8, 0, -8);
    run(p, { forward: 1, right: 1 }, 1, boxes);
    expect(p.pos.z).toBeGreaterThan(-3);
    expect(p.vel.x).toBeGreaterThan(5);
  });
});

describe('collision robustness', () => {
  it('lands on a thin platform at maximum fall speed instead of passing through', () => {
    const thin = makeBox(slab(0, 0, 0, 4, 4, undefined, 0.3));
    const p = createPlayer(new Vector3(0, 60, 0));
    p.vel.set(0, -M.maximumFallSpeed, 0);
    run(p, {}, 3, [thin]);
    expect(p.grounded).toBe(true);
    expect(p.pos.y).toBeCloseTo(0, 2);
  });

  it('does not pass through a thin wall at gadget speed', () => {
    const thin = makeBox({ center: [0, 2, -10], size: [10, 4, 0.2] });
    const p = standing([FLOOR, thin]);
    p.vel.set(0, 0, -60);
    run(p, { forward: 1 }, 1, [FLOOR, thin]);
    expect(p.pos.z).toBeGreaterThan(-10);
  });

  it('hitting a ceiling stops upward motion', () => {
    const roof = makeBox(slab(0, 3, 0, 10, 10, undefined, 0.4));
    const p = standing([FLOOR, roof]);
    stepPlayer(p, { ...NO_INPUT, jump: true }, [FLOOR, roof]);
    run(p, {}, 1, [FLOOR, roof]);
    expect(p.pos.y + 1.8).toBeLessThanOrEqual(2.6 + 1e-3);
    expect(p.grounded).toBe(true);
  });
});
