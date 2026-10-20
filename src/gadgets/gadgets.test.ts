import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DT, GRAPPLE_CONFIG, LAUNCH_PAD_CONFIG, MOVEMENT_CONFIG, ROLLERBLADE_CONFIG, USAGE_CONFIG } from '../config';
import { slab, ramp } from '../course/build';
import type { CourseDefinition } from '../course/types';
import { crossing } from '../course/crossing';
import { AttemptState, RunSession, type SessionInput, idleInput } from '../game/session';
import { GrappleGadget, handPosition } from './grapple';
import { LaunchPadGadget } from './launchPad';
import { RollerbladeGadget } from './rollerblades';
import { GadgetEvent, GadgetId } from './types';

type Point = [number, number, number];

/** A course of `pieces`, plus a small overhead block whose underside is at each of `hooks`. */
const course = (pieces: CourseDefinition['pieces'], hooks: Point[] = []): CourseDefinition => ({
  ...crossing,
  start: { pos: [0, 0, 0], yaw: 0 },
  pieces: [...pieces, ...hooks.map(([x, y, z]) => ({ center: [x, y + 0.5, z] as Point, size: [2, 1, 2] as Point }))],
  checkpoints: [],
  finish: { center: [0, -500, 0], size: [1, 1, 1] },
});

/** Input aimed from the player's hand straight at a point. */
function aimAt(s: RunSession, target: Vector3, over: Partial<SessionInput> = {}): SessionInput {
  const hand = handPosition(s.player, new Vector3());
  return { ...idleInput(), aimOrigin: hand, aimDir: target.clone().sub(hand).normalize(), ...over };
}

function run(s: RunSession, input: SessionInput, seconds: number): string[] {
  const events: string[] = [];
  for (let t = 0; t < seconds; t += DT) events.push(...s.step(input));
  return events;
}

describe('grappling hook', () => {
  const floor = slab(0, 0, 0, 200, 200);
  const anchor = new Vector3(0, 12, -15);

  it('hooks the surface under the crosshair and pulls you toward it', () => {
    const s = new RunSession(course([floor], [anchor.toArray() as Point]), { gadget: GadgetId.Grapple, unlimited: true });
    run(s, idleInput(), 0.1);
    const ev = s.step(aimAt(s, anchor, { action: true, actionPressed: true }));
    expect(ev).toContain(GadgetEvent.GrappleAttached);
    expect((s.gadget as GrappleGadget).attached).toBe(true);
    const start = s.player.pos.distanceTo(anchor);
    run(s, aimAt(s, anchor, { action: true }), 1);
    expect(s.player.pos.distanceTo(anchor)).toBeLessThan(start - 3);
    expect(s.player.grounded).toBe(false);
  });

  it('misses safely when nothing is in range, and you keep running', () => {
    const s = new RunSession(course([floor], [anchor.toArray() as Point]), { gadget: GadgetId.Grapple, unlimited: true });
    run(s, idleInput(), 0.1);
    const away = new Vector3(0, 0, 50);
    const ev = s.step(aimAt(s, away, { action: true, actionPressed: true, forward: 1 }));
    expect(ev).toContain(GadgetEvent.GrappleMissed);
    run(s, { ...idleInput(), forward: 1 }, 0.5);
    expect(Math.hypot(s.player.vel.x, s.player.vel.z)).toBeGreaterThan(5);
  });

  it('hooks the first surface in the way: any surface works, walls included', () => {
    const wall = { center: [0, 5, -7] as Point, size: [20, 10, 1] as Point };
    const s = new RunSession(course([floor, wall], [anchor.toArray() as Point]), { gadget: GadgetId.Grapple, unlimited: true });
    run(s, idleInput(), 0.1);
    expect(s.step(aimAt(s, anchor, { action: true, actionPressed: true }))).toContain(GadgetEvent.GrappleAttached);
    expect((s.gadget as GrappleGadget).point!.z).toBeCloseTo(-6.45, 1);
  });

  it('does not reach past its range', () => {
    const far = { center: [0, 20, -GRAPPLE_CONFIG.range - 10] as Point, size: [20, 2, 2] as Point };
    const s = new RunSession(course([floor, far]), { gadget: GadgetId.Grapple, unlimited: true });
    run(s, idleInput(), 0.1);
    const ev = s.step(aimAt(s, new Vector3(0, 19, -GRAPPLE_CONFIG.range - 9), { action: true, actionPressed: true }));
    expect(ev).toContain(GadgetEvent.GrappleMissed);
  });

  it('releasing keeps your momentum', () => {
    const s = new RunSession(course([floor], [anchor.toArray() as Point]), { gadget: GadgetId.Grapple, unlimited: true });
    run(s, idleInput(), 0.1);
    s.step(aimAt(s, anchor, { action: true, actionPressed: true }));
    run(s, aimAt(s, anchor, { action: true }), 0.6);
    const before = s.player.vel.length();
    const ev = s.step(aimAt(s, anchor));
    expect(ev).toContain(GadgetEvent.GrappleReleased);
    expect(s.player.vel.length()).toBeGreaterThanOrEqual(before);
    expect(s.player.tethered).toBe(false);
  });

  it('retry clears the tether', () => {
    const s = new RunSession(course([floor], [anchor.toArray() as Point]), { gadget: GadgetId.Grapple, unlimited: true });
    run(s, idleInput(), 0.1);
    s.step(aimAt(s, anchor, { action: true, actionPressed: true }));
    s.restart();
    expect((s.gadget as GrappleGadget).attached).toBe(false);
    expect(s.player.tethered).toBe(false);
  });
});

/** One click: puts rollerblades on (and fires other gadgets' actions). */
const click = (over: Partial<SessionInput> = {}): SessionInput => ({ ...idleInput(), action: true, actionPressed: true, ...over });

describe('rollerblades', () => {
  it('do nothing until clicked; the switch-on click is not a tuck', () => {
    const s = new RunSession(course([slab(0, 0, 0, 2000, 2000)]), { gadget: GadgetId.Rollerblades });
    run(s, { ...idleInput(), forward: 1 }, 3);
    const blades = s.gadget as RollerbladeGadget;
    expect(blades.active).toBe(false);
    expect(blades.remaining).toBe(1);
    expect(Math.hypot(s.player.vel.x, s.player.vel.z)).toBeCloseTo(MOVEMENT_CONFIG.groundSpeed, 1);
    // Click and keep holding: skates on, but no tuck until the button is let go and held again.
    expect(s.step(click({ forward: 1 }))).toContain(GadgetEvent.SkatesOn);
    run(s, { ...idleInput(), forward: 1, action: true }, 0.5);
    expect(blades.active).toBe(true);
    expect(blades.tucking).toBe(false);
    run(s, { ...idleInput(), forward: 1 }, 0.1);
    run(s, { ...idleInput(), forward: 1, action: true }, 0.1);
    expect(blades.tucking).toBe(true);
  });

  it('top out faster than running on flat ground, but not without limit', () => {
    const s = new RunSession(course([slab(0, 0, 0, 2000, 2000)]), { gadget: GadgetId.Rollerblades, unlimited: true });
    s.step(click());
    run(s, { ...idleInput(), forward: 1 }, 5);
    const speed = Math.hypot(s.player.vel.x, s.player.vel.z);
    expect(speed).toBeGreaterThan(MOVEMENT_CONFIG.groundSpeed);
    expect(speed).toBeCloseTo(ROLLERBLADE_CONFIG.pushSpeed, 1);
  });

  it('gain far more speed downhill than running', () => {
    const hill = [ramp([0, 40, 0], [0, 0, -200], 12)];
    const speedAfter = (gadget: GadgetId) => {
      const s = new RunSession({ ...course(hill), start: { pos: [0, 39.9, -1], yaw: 0 } }, { gadget, unlimited: true });
      if (gadget === GadgetId.Rollerblades) s.step(click());
      run(s, { ...idleInput(), forward: 1 }, 5);
      return Math.hypot(s.player.vel.x, s.player.vel.z);
    };
    expect(speedAfter(GadgetId.Rollerblades)).toBeGreaterThan(speedAfter(GadgetId.LaunchPad) + 8);
  });

  it('tucking with the button held reports a tuck and coasts', () => {
    const s = new RunSession(course([slab(0, 0, 0, 2000, 2000)]), { gadget: GadgetId.Rollerblades, unlimited: true });
    s.step(click());
    run(s, { ...idleInput(), forward: 1 }, 2);
    const ev = run(s, { ...idleInput(), forward: 1, action: true }, 1);
    expect(ev).toContain(GadgetEvent.TuckStarted);
    expect((s.gadget as RollerbladeGadget).tucking).toBe(true);
  });

  it('can still jump', () => {
    const s = new RunSession(course([slab(0, 0, 0, 200, 200)]), { gadget: GadgetId.Rollerblades, unlimited: true });
    run(s, idleInput(), 0.1);
    s.step({ ...idleInput(), jump: true });
    expect(s.player.vel.y).toBeGreaterThan(5);
  });
});

describe('launch pad', () => {
  const floor = slab(0, 0, 0, 200, 200);

  it('throws a pad onto the floor ahead, and stepping on it launches you along its heading', () => {
    const s = new RunSession(course([floor]), { gadget: GadgetId.LaunchPad, unlimited: true });
    run(s, idleInput(), 0.1);
    const ev = s.step(aimAt(s, new Vector3(0, 0, -8), { action: true, actionPressed: true }));
    expect(ev).toContain(GadgetEvent.PadPlaced);
    const pad = (s.gadget as LaunchPadGadget).pad!;
    expect(pad.pos.z).toBeCloseTo(-8, 1);
    const launched = run(s, { ...idleInput(), forward: 1 }, 1.5);
    expect(launched).toContain(GadgetEvent.PadLaunched);
    // Launched forward (-Z) and up.
    expect(s.player.pos.z).toBeLessThan(-15);
  });

  it('refuses walls and out-of-range spots without using anything up', () => {
    const wall = { center: [0, 5, -6] as [number, number, number], size: [20, 10, 1] as [number, number, number] };
    const s = new RunSession(course([floor, wall]), { gadget: GadgetId.LaunchPad, unlimited: true });
    run(s, idleInput(), 0.1);
    expect(s.step(aimAt(s, new Vector3(0, 3, -6), { action: true, actionPressed: true }))).toContain(GadgetEvent.PadInvalid);
    run(s, idleInput(), LAUNCH_PAD_CONFIG.throwCooldown + 0.05);
    const far = new Vector3(0, 0, 10 + LAUNCH_PAD_CONFIG.throwRange * 2);
    expect(s.step(aimAt(s, far, { action: true, actionPressed: true }))).toContain(GadgetEvent.PadInvalid);
    run(s, idleInput(), LAUNCH_PAD_CONFIG.throwCooldown + 0.05);
    expect(s.step(aimAt(s, new Vector3(0, 0, 4), { action: true, actionPressed: true }))).toContain(GadgetEvent.PadPlaced);
  });

  it('keeps one pad: a new throw replaces the old', () => {
    const s = new RunSession(course([floor]), { gadget: GadgetId.LaunchPad, unlimited: true });
    run(s, idleInput(), 0.1);
    s.step(aimAt(s, new Vector3(0, 0, -8), { action: true, actionPressed: true }));
    run(s, idleInput(), LAUNCH_PAD_CONFIG.throwCooldown + 0.05);
    s.step(aimAt(s, new Vector3(5, 0, -5), { action: true, actionPressed: true }));
    expect((s.gadget as LaunchPadGadget).pad!.pos.x).toBeCloseTo(5, 1);
  });

  it('retry and respawn clear the pad', () => {
    const s = new RunSession(course([floor]), { gadget: GadgetId.LaunchPad, unlimited: true });
    run(s, idleInput(), 0.1);
    s.step(aimAt(s, new Vector3(0, 0, -8), { action: true, actionPressed: true }));
    s.restart();
    expect((s.gadget as LaunchPadGadget).pad).toBeNull();
    expect(s.state).toBe(AttemptState.Ready);
  });
});

describe('budgets and switching', () => {
  const floor = slab(0, 0, 0, 2000, 2000);
  const anchor = new Vector3(0, 12, -15);
  const anchors = [anchor.toArray() as Point];

  /** Latch on, swing briefly, let go. */
  function swing(s: RunSession): string[] {
    s.step(aimAt(s, anchor, { action: true, actionPressed: true }));
    run(s, aimAt(s, anchor, { action: true }), 0.3);
    return s.step(aimAt(s, anchor));
  }

  it('the grapple has two swings; misses are free; a used-up gadget stays in hand', () => {
    const s = new RunSession(course([floor], anchors), { loadout: [GadgetId.Grapple, GadgetId.LaunchPad] });
    run(s, idleInput(), 0.1);
    s.step(aimAt(s, new Vector3(0, 0, 50), { action: true, actionPressed: true }));
    expect(s.gadget?.usageLabel).toBe(`x${USAGE_CONFIG.grappleSwings}`);
    for (let i = 0; i < USAGE_CONFIG.grappleSwings; i++) {
      run(s, idleInput(), 1.5);
      expect(swing(s)).toContain(GadgetEvent.GrappleReleased);
    }
    expect(s.gadget?.id).toBe(GadgetId.Grapple);
    expect(s.gadget?.usageLabel).toBe('x0');
    // Out of swings: clicking does nothing.
    run(s, idleInput(), 1.5);
    expect(s.step(aimAt(s, anchor, { action: true, actionPressed: true }))).not.toContain(GadgetEvent.GrappleAttached);
  });

  it('switching away mid-swing lets go, and the swing counts', () => {
    const s = new RunSession(course([floor], anchors), { loadout: [GadgetId.Grapple, GadgetId.LaunchPad] });
    run(s, idleInput(), 0.1);
    s.step(aimAt(s, anchor, { action: true, actionPressed: true }));
    expect((s.gadget as GrappleGadget).attached).toBe(true);
    s.cycleGadget(1);
    expect(s.player.tethered).toBe(false);
    expect(s.gadgets[0].usageLabel).toBe(`x${USAGE_CONFIG.grappleSwings - 1}`);
    expect(s.step(idleInput())).toContain(GadgetEvent.GrappleReleased);
  });

  it('a thrown pad keeps working after switching to another gadget', () => {
    const s = new RunSession(course([floor]), { loadout: [GadgetId.LaunchPad, GadgetId.Rollerblades] });
    run(s, idleInput(), 0.1);
    s.step(aimAt(s, new Vector3(0, 0, -20), { action: true, actionPressed: true }));
    run(s, idleInput(), LAUNCH_PAD_CONFIG.throwCooldown + 0.05);
    // Re-throwing is free.
    s.step(aimAt(s, new Vector3(0, 0, -8), { action: true, actionPressed: true }));
    s.selectGadget(GadgetId.Rollerblades);
    const ev = run(s, { ...idleInput(), forward: 1 }, 1.5);
    expect(ev).toContain(GadgetEvent.PadLaunched);
    expect(s.gadgets[0].usageLabel).toBe('x0');
    expect((s.gadgets[0] as LaunchPadGadget).pad).toBeNull();
    expect(s.gadget?.id).toBe(GadgetId.Rollerblades);
  });

  it('rollerblades: 5 s on the ground once on; switching away takes them off and pauses the time', () => {
    const s = new RunSession(course([floor]), { loadout: [GadgetId.Rollerblades, GadgetId.Grapple] });
    run(s, idleInput(), 0.1);
    // Time before putting them on doesn't count.
    run(s, { ...idleInput(), forward: 1 }, 2);
    expect(s.gadget?.usageLabel).toBe(`${USAGE_CONFIG.rollerbladeSeconds.toFixed(1)}s`);
    s.step(click());
    run(s, { ...idleInput(), forward: 1 }, 2);
    const blades = s.gadget as RollerbladeGadget;
    const afterTwo = blades.remaining;
    s.selectGadget(GadgetId.Grapple);
    expect(blades.active).toBe(false);
    run(s, { ...idleInput(), forward: 1 }, 2);
    expect(blades.remaining).toBe(afterTwo);
    // Back to blades: E again to put them on, then the rest of the time.
    s.selectGadget(GadgetId.Rollerblades);
    run(s, { ...idleInput(), forward: 1 }, 1);
    expect(blades.remaining).toBe(afterTwo);
    s.step(click());
    run(s, { ...idleInput(), forward: 1 }, USAGE_CONFIG.rollerbladeSeconds);
    expect(blades.remaining).toBe(0);
    expect(blades.active).toBe(false);
    expect(s.gadget?.id).toBe(GadgetId.Rollerblades);
    // Air time is free: covered by the countdown only running on the ground.
  });

  it('a retry refills every budget', () => {
    const s = new RunSession(course([floor], anchors), { loadout: [GadgetId.Grapple] });
    run(s, idleInput(), 0.1);
    swing(s);
    s.restart();
    expect(s.gadget?.remaining).toBe(1);
  });
});

it('rapid retries do not pile up gadget state', () => {
  const s = new RunSession(crossing, { gadget: GadgetId.LaunchPad, unlimited: true });
  for (let i = 0; i < 200; i++) {
    s.step(aimAt(s, new Vector3(0, 40, -6), { action: true, actionPressed: true }));
    s.restart();
  }
  expect((s.gadget as LaunchPadGadget).pad).toBeNull();
  expect(s.attempt).toBe(201);
});
