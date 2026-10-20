import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ABILITY_CONFIG as A, DT, MOVEMENT_CONFIG as M } from '../config';
import { ramp, slab } from '../course/build';
import { type Box, makeBox } from './collision';
import { NO_INPUT, type PlayerInput, type PlayerState, Stance, createPlayer, horizontalSpeed, stepPlayer } from './player';

const FLOOR = makeBox(slab(0, 0, 0, 400, 400));

function run(p: PlayerState, input: Partial<PlayerInput>, seconds: number, boxes: Box[] = [FLOOR]): void {
  const full = { ...NO_INPUT, ...input };
  for (let t = 0; t < seconds - 1e-9; t += DT) stepPlayer(p, full, boxes);
}

/** Standing on the floor, already running at full speed toward -Z. */
function running(boxes: Box[] = [FLOOR], at = new Vector3()): PlayerState {
  const p = createPlayer(at);
  run(p, {}, 0.1, boxes);
  run(p, { forward: 1 }, 0.5, boxes);
  return p;
}

describe('slide', () => {
  it('starts at running speed with a burst, and the burst is rate-limited', () => {
    const p = running();
    stepPlayer(p, { ...NO_INPUT, forward: 1, crouch: true }, [FLOOR]);
    expect(p.stance).toBe(Stance.Slide);
    expect(p.justSlid).toBe(true);
    expect(horizontalSpeed(p)).toBeGreaterThan(M.groundSpeed + A.slideBoost - 0.5);
    // Stand and slide again at once: no second burst.
    run(p, { forward: 1 }, 0.1);
    const before = horizontalSpeed(p);
    stepPlayer(p, { ...NO_INPUT, forward: 1, crouch: true }, [FLOOR]);
    expect(horizontalSpeed(p)).toBeLessThan(before + 0.5);
  });

  it('glides with low drag, then drops to a crouch when slow', () => {
    const p = running();
    run(p, { forward: 1, crouch: true }, 1);
    expect(p.stance).toBe(Stance.Slide);
    expect(horizontalSpeed(p)).toBeGreaterThan(M.groundSpeed);
    run(p, { forward: 1, crouch: true }, 5);
    expect(p.stance).toBe(Stance.Crouch);
    expect(horizontalSpeed(p)).toBeCloseTo(A.crouchSpeed, 1);
  });

  it('gains speed down a slope', () => {
    const hill = [makeBox(ramp([0, 30, 0], [0, 0, -150], 10))];
    const p = running(hill, new Vector3(0, 29.9, -1));
    run(p, { forward: 1, crouch: true }, 3, hill);
    expect(horizontalSpeed(p)).toBeGreaterThan(M.groundSpeed + A.slideBoost + 3);
  });

  it('jumping out keeps the slide speed and stands up', () => {
    const p = running();
    run(p, { forward: 1, crouch: true }, 0.2);
    const speed = horizontalSpeed(p);
    stepPlayer(p, { ...NO_INPUT, forward: 1, crouch: true, jump: true }, [FLOOR]);
    expect(p.justJumped).toBe(true);
    expect(p.stance).toBe(Stance.Stand);
    expect(horizontalSpeed(p)).toBeGreaterThan(speed - 0.2);
  });

  it('jumping out of a slide longer than 1 s adds a small burst; a short slide does not', () => {
    const jumpAfter = (seconds: number) => {
      const p = running();
      run(p, { forward: 1, crouch: true }, seconds);
      const before = horizontalSpeed(p);
      stepPlayer(p, { ...NO_INPUT, forward: 1, crouch: true, jump: true }, [FLOOR]);
      return { gain: horizontalSpeed(p) - before, burst: p.justSlideJumped };
    };
    const short = jumpAfter(A.slideJumpMinSeconds - 0.3);
    expect(short.burst).toBe(false);
    expect(short.gain).toBeLessThan(0.5);
    const long = jumpAfter(A.slideJumpMinSeconds + 0.1);
    // The moment it becomes available is flagged once, for the HUD ring and chime.
    const p = running();
    let readyTicks = 0;
    for (let t = 0; t < A.slideJumpMinSeconds + 0.3; t += DT) {
      stepPlayer(p, { ...NO_INPUT, forward: 1, crouch: true }, [FLOOR]);
      if (p.justSlideReady) readyTicks++;
    }
    expect(readyTicks).toBe(1);
    expect(long.burst).toBe(true);
    expect(long.gain).toBeGreaterThan(A.slideJumpBoost - 0.5);
  });

  it('fits under a low bar that stops a standing player, and stays low until clear', () => {
    // A bar from 1.1 m up, 6 m long.
    const bar = makeBox({ center: [0, 2.6, -8], size: [10, 3, 6] });
    const boxes = [FLOOR, bar];
    const stand = running(boxes, new Vector3(0, 0, 0));
    run(stand, { forward: 1 }, 1, boxes);
    expect(stand.pos.z).toBeGreaterThan(-5);

    const slide = running(boxes, new Vector3(0, 0, 0));
    // Let go of crouch while under the bar: still low until past it.
    let lowUnder = true;
    for (let t = 0; t < 1.5; t += DT) {
      stepPlayer(slide, { ...NO_INPUT, forward: 1, crouch: slide.pos.z > -6 }, boxes);
      if (slide.pos.z < -6 && slide.pos.z > -10.5 && slide.stance === Stance.Stand) lowUnder = false;
    }
    expect(slide.pos.z).toBeLessThan(-12);
    expect(lowUnder).toBe(true);
    expect(slide.stance).toBe(Stance.Stand);
  });

  it('crouch from a standstill walks slowly under a bar', () => {
    const bar = makeBox({ center: [0, 2.6, -4], size: [10, 3, 2] });
    const p = createPlayer(new Vector3());
    run(p, {}, 0.1, [FLOOR, bar]);
    run(p, { forward: 1, crouch: true }, 2.5, [FLOOR, bar]);
    expect(p.pos.z).toBeLessThan(-5.5);
    expect(horizontalSpeed(p)).toBeCloseTo(A.crouchSpeed, 1);
  });

  it('does not slide while on a grapple line', () => {
    const p = running();
    p.tethered = true;
    stepPlayer(p, { ...NO_INPUT, crouch: true }, [FLOOR]);
    expect(p.stance).toBe(Stance.Stand);
  });
});

describe('mantle', () => {
  /** A 2.3 m ledge starting 4 m ahead: too high to jump onto, low enough to mantle. */
  const ledge = makeBox(slab(0, 2.3, -14, 10, 20));

  function jumpAtLedge(holdJump: boolean, boxes: Box[] = [FLOOR, ledge]): PlayerState {
    const p = createPlayer(new Vector3(0, 0, 0));
    run(p, {}, 0.1, boxes);
    run(p, { forward: 1 }, 0.25, boxes);
    stepPlayer(p, { ...NO_INPUT, forward: 1, jump: true }, boxes);
    run(p, { forward: 1, jump: holdJump }, 1.5, boxes);
    return p;
  }

  it('with jump held, grabs a ledge out of jump reach and pulls up onto it', () => {
    const p = jumpAtLedge(true);
    expect(p.pos.y).toBeCloseTo(2.3, 1);
    expect(p.pos.z).toBeLessThan(-5);
    expect(horizontalSpeed(p)).toBeGreaterThanOrEqual(M.groundSpeed - 0.01);
  });

  it('without jump held, you bounce off and stay below', () => {
    const p = jumpAtLedge(false);
    expect(p.pos.y).toBeLessThan(0.1);
  });

  it('leaves with ~60% of a high speed, never less than running speed', () => {
    const p = createPlayer(new Vector3(0, 0.6, 0));
    p.vel.set(0, 2, -30);
    const boxes = [FLOOR, ledge];
    let grabbed = false;
    for (let t = 0; t < 1 && !grabbed; t += DT) {
      stepPlayer(p, { ...NO_INPUT, forward: 1, jump: true }, boxes);
      grabbed = p.justMantled;
    }
    expect(grabbed).toBe(true);
    run(p, { forward: 1, jump: true }, A.mantleDuration + DT, boxes);
    expect(p.mantle).toBeNull();
    expect(Math.abs(p.vel.z)).toBeGreaterThan(M.groundSpeed);
    expect(Math.abs(p.vel.z)).toBeLessThanOrEqual(30 * A.mantleKeepSpeed + 1);
  });

  it('cannot climb a wall taller than its reach', () => {
    // Top beyond reach even from the peak of a jump.
    const tall = makeBox(slab(0, A.mantleMaxHeight + 2 + 0.5, -14, 10, 20));
    const p = jumpAtLedge(true, [FLOOR, tall]);
    expect(p.pos.y).toBeLessThan(0.1);
  });

  it('needs room to stand on top', () => {
    // A thick roof 0.8 m above the ledge, its own top far out of reach.
    const roof = makeBox({ center: [0, 4.6, -14], size: [10, 3, 20] });
    const p = jumpAtLedge(true, [FLOOR, ledge, roof]);
    expect(p.pos.y).toBeLessThan(0.1);
  });
});

describe('wall run and wall jump', () => {
  // A long wall along the -Z direction, its face at x = 2 (normal −x), standing on a floor.
  const wallR = makeBox({ center: [2.5, 4, -30], size: [1, 8, 60] });
  // A second wall on the other side, 8 m away, face at x = −6 (normal +x).
  const wallL = makeBox({ center: [-6.5, 4, -30], size: [1, 8, 60] });

  /** In the air 5 m up, flying along the right-hand wall at `speed`, steering forward or not. */
  function launchAlongWall(_boxes: Box[], speed = 10): PlayerState {
    const p = createPlayer(new Vector3(1.2, 5, 0));
    p.vel.set(0, 1, -speed);
    return p;
  }

  it('running into a wall at your side from a jump starts a wall run that holds height', () => {
    const boxes = [FLOOR, wallR];
    const p = launchAlongWall(boxes);
    let started = false;
    for (let t = 0; t < 0.4 && !started; t += DT) {
      stepPlayer(p, { ...NO_INPUT, forward: 1 }, boxes);
      started ||= p.justWallRun;
    }
    expect(started).toBe(true);
    const startY = p.pos.y;
    run(p, { forward: 1 }, 1, boxes);
    expect(p.wallRun).not.toBeNull();
    // Fast enough: no height lost at all.
    expect(p.pos.y).toBeGreaterThanOrEqual(startY - 1e-6);
    expect(p.vel.y).toBeGreaterThanOrEqual(0);
    expect(horizontalSpeed(p)).toBeGreaterThan(9);
  });

  it('a slower wall run sinks gently', () => {
    const boxes = [FLOOR, wallR];
    const p = launchAlongWall(boxes, A.wallRunHoldSpeed - 1);
    let started = false;
    for (let t = 0; t < 0.4 && !started; t += DT) {
      stepPlayer(p, NO_INPUT, boxes);
      started ||= p.justWallRun;
    }
    expect(started).toBe(true);
    const startY = p.pos.y;
    run(p, NO_INPUT, 1, boxes);
    expect(p.wallRun).not.toBeNull();
    expect(p.pos.y).toBeLessThan(startY);
    // Still far less than a free fall.
    expect(startY - p.pos.y).toBeLessThan(1.5);
  });

  it('ends after its time limit', () => {
    const boxes = [FLOOR, wallR];
    const p = launchAlongWall(boxes);
    run(p, { forward: 1 }, 0.3, boxes);
    expect(p.wallRun).not.toBeNull();
    run(p, { forward: 1 }, A.wallRunMaxSeconds + 0.1, boxes);
    expect(p.wallRun).toBeNull();
  });

  it('does not start when too slow or when just skimming the floor', () => {
    const boxes = [FLOOR, wallR];
    const slow = launchAlongWall(boxes, A.wallRunMinSpeed - 2);
    let started = false;
    // No steering, so air control doesn't speed it up.
    for (let t = 0; t < 0.6; t += DT) {
      stepPlayer(slow, NO_INPUT, boxes);
      started ||= slow.justWallRun;
    }
    expect(started).toBe(false);
    // On the ground next to it: no wall run.
    const ground = createPlayer(new Vector3(1.0, 0, 0));
    run(ground, {}, 0.1, boxes);
    ground.vel.set(0, 0, -10);
    run(ground, { forward: 1 }, 0.5, boxes);
    expect(ground.wallRun).toBeNull();
  });

  it('jumping off the wall kicks you away and up, keeping your speed along it', () => {
    const boxes = [FLOOR, wallR];
    const p = launchAlongWall(boxes);
    run(p, { forward: 1 }, 0.3, boxes);
    expect(p.wallRun).not.toBeNull();
    const along = -p.vel.z;
    stepPlayer(p, { ...NO_INPUT, forward: 1, jump: true }, boxes);
    expect(p.justWallJumped).toBe(true);
    expect(p.wallRun).toBeNull();
    expect(p.vel.x).toBeLessThan(-A.wallJumpOut + 0.5);
    expect(p.vel.y).toBeGreaterThan(A.wallJumpUp - 1);
    expect(-p.vel.z).toBeGreaterThan(along - 0.5);
  });

  it('can bounce between two walls, but not kick off the same wall twice in a row', () => {
    const boxes = [FLOOR, wallR, wallL];
    const p = launchAlongWall(boxes);
    run(p, { forward: 1 }, 0.3, boxes);
    stepPlayer(p, { ...NO_INPUT, forward: 1, jump: true }, boxes);
    expect(p.justWallJumped).toBe(true);
    // Steer for the left wall: a wall run starts there, and you can kick off it back right.
    let onLeft = false;
    for (let t = 0; t < 1.5 && !onLeft; t += DT) {
      stepPlayer(p, { ...NO_INPUT, forward: 1, right: -1 }, boxes);
      onLeft = !!p.wallRun && p.wallRun.normal.x > 0.9;
    }
    expect(onLeft).toBe(true);
    stepPlayer(p, { ...NO_INPUT, forward: 1, jump: true }, boxes);
    expect(p.justWallJumped).toBe(true);
    expect(p.vel.x).toBeGreaterThan(0);
    // Straight away again, still beside that same left wall: no second kick off it.
    p.pos.x = -5.5;
    run(p, { forward: 1 }, 0.05, boxes);
    stepPlayer(p, { ...NO_INPUT, forward: 1, jump: true }, boxes);
    expect(p.justWallJumped).toBe(false);
  });
});
