import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DASH_CONFIG, DT, GRAPPLE_CONFIG, JETPACK_CONFIG, LAUNCH_PAD_CONFIG, USAGE_CONFIG, WINGSUIT_CONFIG } from '../config';
import { slab } from '../course/build';
import type { CourseDefinition } from '../course/types';
import { crossing } from '../course/crossing';
import { AttemptState, RunSession, type SessionInput, idleInput } from '../game/session';
import { GrappleGadget, handPosition } from './grapple';
import { LaunchPadGadget } from './launchPad';
import { JetpackGadget } from './jetpack';
import { WingsuitGadget } from './wingsuit';
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

/** Slot `i`'s use key held, and pressed this tick. */
const press = (i = 0): Partial<SessionInput> => ({ use: slotKey(i), usePressed: slotKey(i) });
/** Slot `i`'s use key held. */
const hold = (i = 0): Partial<SessionInput> => ({ use: slotKey(i), usePressed: [] });
const slotKey = (i: number) => [0, 1, 2].map((k) => k === i);

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
    const ev = s.step(aimAt(s, anchor, { ...press() }));
    expect(ev).toContain(GadgetEvent.GrappleAttached);
    expect((s.gadgets[0] as GrappleGadget).attached).toBe(true);
    const start = s.player.pos.distanceTo(anchor);
    run(s, aimAt(s, anchor, { ...hold() }), 1);
    expect(s.player.pos.distanceTo(anchor)).toBeLessThan(start - 3);
    expect(s.player.grounded).toBe(false);
  });

  it('misses safely when nothing is in range, and you keep running', () => {
    const s = new RunSession(course([floor], [anchor.toArray() as Point]), { gadget: GadgetId.Grapple, unlimited: true });
    run(s, idleInput(), 0.1);
    const away = new Vector3(0, 0, 50);
    const ev = s.step(aimAt(s, away, { ...press(), forward: 1 }));
    expect(ev).toContain(GadgetEvent.GrappleMissed);
    run(s, { ...idleInput(), forward: 1 }, 0.5);
    expect(Math.hypot(s.player.vel.x, s.player.vel.z)).toBeGreaterThan(5);
  });

  it('hooks the first surface in the way: any surface works, walls included', () => {
    const wall = { center: [0, 5, -7] as Point, size: [20, 10, 1] as Point };
    const s = new RunSession(course([floor, wall], [anchor.toArray() as Point]), { gadget: GadgetId.Grapple, unlimited: true });
    run(s, idleInput(), 0.1);
    expect(s.step(aimAt(s, anchor, { ...press() }))).toContain(GadgetEvent.GrappleAttached);
    expect((s.gadgets[0] as GrappleGadget).point!.z).toBeCloseTo(-6.45, 1);
  });

  it('does not reach past its range', () => {
    const far = { center: [0, 20, -GRAPPLE_CONFIG.range - 10] as Point, size: [20, 2, 2] as Point };
    const s = new RunSession(course([floor, far]), { gadget: GadgetId.Grapple, unlimited: true });
    run(s, idleInput(), 0.1);
    const ev = s.step(aimAt(s, new Vector3(0, 19, -GRAPPLE_CONFIG.range - 9), { ...press() }));
    expect(ev).toContain(GadgetEvent.GrappleMissed);
  });

  it('releasing keeps your momentum', () => {
    const s = new RunSession(course([floor], [anchor.toArray() as Point]), { gadget: GadgetId.Grapple, unlimited: true });
    run(s, idleInput(), 0.1);
    s.step(aimAt(s, anchor, { ...press() }));
    run(s, aimAt(s, anchor, { ...hold() }), 0.6);
    const before = s.player.vel.length();
    const ev = s.step(aimAt(s, anchor));
    expect(ev).toContain(GadgetEvent.GrappleReleased);
    expect(s.player.vel.length()).toBeGreaterThanOrEqual(before);
    expect(s.player.tethered).toBe(false);
  });

  it('retry clears the tether', () => {
    const s = new RunSession(course([floor], [anchor.toArray() as Point]), { gadget: GadgetId.Grapple, unlimited: true });
    run(s, idleInput(), 0.1);
    s.step(aimAt(s, anchor, { ...press() }));
    s.restart();
    expect((s.gadgets[0] as GrappleGadget).attached).toBe(false);
    expect(s.player.tethered).toBe(false);
  });
});

/** One press of the gadget button. */
const click = (over: Partial<SessionInput> = {}, slot = 0): SessionInput => ({ ...idleInput(), ...press(slot), ...over });

describe('jetpack', () => {
  const floor = slab(0, 0, 0, 2000, 2000);

  it('holding the button lifts off the ground and climbs', () => {
    const s = new RunSession(course([floor]), { gadget: GadgetId.Jetpack, unlimited: true });
    run(s, idleInput(), 0.1);
    const ev = run(s, { ...idleInput(), ...hold() }, 1);
    expect(ev).toContain(GadgetEvent.JetpackOn);
    expect(s.player.grounded).toBe(false);
    expect(s.player.pos.y).toBeGreaterThan(3);
    expect(s.player.vel.y).toBeLessThanOrEqual(JETPACK_CONFIG.maxRiseSpeed + 1e-6);
  });

  it('lets go: you fall again; fuel only burns while thrusting', () => {
    const s = new RunSession(course([floor]), { gadget: GadgetId.Jetpack });
    run(s, idleInput(), 0.1);
    run(s, { ...idleInput(), ...hold() }, 1);
    const jet = s.gadgets[0] as JetpackGadget;
    const left = jet.remaining;
    expect(left).toBeCloseTo(1 - 1 / USAGE_CONFIG.jetpackSeconds, 1);
    const ev = run(s, idleInput(), 2);
    expect(ev).toContain(GadgetEvent.JetpackOff);
    expect(s.player.grounded).toBe(true);
    expect(jet.remaining).toBe(left);
  });

  it('runs out after its fuel', () => {
    const s = new RunSession(course([floor]), { loadout: [GadgetId.Jetpack, GadgetId.Dash] });
    run(s, idleInput(), 0.1);
    run(s, { ...idleInput(), ...hold() }, USAGE_CONFIG.jetpackSeconds + 0.1);
    expect(s.gadgets[0].usageLabel).toBe('0.0s');
    expect((s.gadgets[0] as JetpackGadget).thrusting).toBe(false);
  });
});

describe('dash thruster', () => {
  const floor = slab(0, 0, 0, 2000, 2000);

  it('bursts you forward the way you are going, on the ground', () => {
    const s = new RunSession(course([floor]), { gadget: GadgetId.Dash, unlimited: true });
    run(s, idleInput(), 0.1);
    run(s, { ...idleInput(), forward: 1 }, 0.5);
    expect(s.step(click({ forward: 1 }))).toContain(GadgetEvent.Dashed);
    expect(Math.hypot(s.player.vel.x, s.player.vel.z)).toBeGreaterThanOrEqual(DASH_CONFIG.speed - 0.5);
    expect(s.player.vel.z).toBeLessThan(0);
  });

  it('standing still, dashes the way you are looking; in the air it never starts by dropping', () => {
    const s = new RunSession(course([floor]), { gadget: GadgetId.Dash, unlimited: true });
    run(s, idleInput(), 0.1);
    s.step(click({ yaw: Math.PI / 2 }));
    // Yaw 90° faces −X.
    expect(s.player.vel.x).toBeLessThan(-DASH_CONFIG.speed + 1);
    s.player.pos.y = 20;
    s.player.vel.set(0, -12, -5);
    s.player.grounded = false;
    run(s, idleInput(), DASH_CONFIG.cooldown + 0.05);
    s.step(click());
    expect(s.player.vel.y).toBeGreaterThanOrEqual(DASH_CONFIG.minLift - 1);
  });

  it('has three dashes, with a short cooldown between them', () => {
    const s = new RunSession(course([floor]), { loadout: [GadgetId.Dash, GadgetId.Grapple] });
    run(s, idleInput(), 0.1);
    expect(s.step(click({ forward: 1 }))).toContain(GadgetEvent.Dashed);
    // Too soon: nothing.
    expect(s.step(click({ forward: 1 }))).not.toContain(GadgetEvent.Dashed);
    for (let i = 1; i < USAGE_CONFIG.dashes; i++) {
      run(s, { ...idleInput(), forward: 1 }, DASH_CONFIG.cooldown + 0.05);
      expect(s.step(click({ forward: 1 }))).toContain(GadgetEvent.Dashed);
    }
    // All used.
    expect(s.gadgets[0].usageLabel).toBe('x0');
    run(s, { ...idleInput(), forward: 1 }, DASH_CONFIG.cooldown + 0.05);
    expect(s.step(click({ forward: 1 }))).not.toContain(GadgetEvent.Dashed);
  });
});

describe('wingsuit', () => {
  const floor = slab(0, 0, 0, 4000, 4000);
  /** In the air 60 m up, moving forward, looking along `pitchDir` (y < 0 looks down). */
  function falling(lookDown = 0): { s: RunSession; input: SessionInput } {
    const s = new RunSession(course([floor]), { gadget: GadgetId.Wingsuit, unlimited: true });
    s.player.pos.set(0, 60, 0);
    s.player.vel.set(0, 0, -10);
    const input = { ...idleInput(), ...hold(), aimDir: new Vector3(0, -lookDown, -1).normalize() };
    return { s, input };
  }

  it('gliding falls far slower than free fall and carries you forward', () => {
    const { s, input } = falling();
    const ev = run(s, input, 2);
    expect(ev).toContain(GadgetEvent.GlideStarted);
    expect(-s.player.vel.y).toBeLessThan(WINGSUIT_CONFIG.sink + 1);
    expect(60 - s.player.pos.y).toBeLessThan(8);
    expect(-s.player.pos.z).toBeGreaterThan(25);
  });

  it('looking down dives faster and builds speed; looking up floats', () => {
    const dive = falling(0.7);
    run(dive.s, dive.input, 2);
    const flare = falling(-0.3);
    run(flare.s, flare.input, 2);
    expect(Math.hypot(dive.s.player.vel.x, dive.s.player.vel.z)).toBeGreaterThan(Math.hypot(flare.s.player.vel.x, flare.s.player.vel.z) + 5);
    expect(dive.s.player.pos.y).toBeLessThan(flare.s.player.pos.y - 5);
  });

  it('turns toward where you look', () => {
    const { s, input } = falling();
    run(s, { ...input, yaw: Math.PI / 2 }, 2);
    // Yaw 90° faces −X.
    expect(s.player.vel.x).toBeLessThan(-8);
  });

  it('does nothing on the ground; glide time only counts in the air; runs out', () => {
    const s = new RunSession(course([floor]), { loadout: [GadgetId.Wingsuit, GadgetId.Dash] });
    run(s, idleInput(), 0.1);
    run(s, { ...idleInput(), ...hold(), forward: 1 }, 1);
    expect(s.gadgets[0].used).toBe(0);
    s.player.pos.y = 200;
    s.player.grounded = false;
    run(s, { ...idleInput(), ...hold() }, USAGE_CONFIG.wingsuitSeconds + 0.2);
    expect(s.gadgets[0].usageLabel).toBe('0.0s');
  });
});

describe('launch pad', () => {
  const floor = slab(0, 0, 0, 200, 200);

  it('throws a pad onto the floor ahead, and stepping on it launches you along its heading', () => {
    const s = new RunSession(course([floor]), { gadget: GadgetId.LaunchPad, unlimited: true });
    run(s, idleInput(), 0.1);
    const ev = s.step(aimAt(s, new Vector3(0, 0, -8), { ...press() }));
    expect(ev).toContain(GadgetEvent.PadPlaced);
    const pad = (s.gadgets[0] as LaunchPadGadget).pad!;
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
    expect(s.step(aimAt(s, new Vector3(0, 3, -6), { ...press() }))).toContain(GadgetEvent.PadInvalid);
    run(s, idleInput(), LAUNCH_PAD_CONFIG.throwCooldown + 0.05);
    const far = new Vector3(0, 0, 10 + LAUNCH_PAD_CONFIG.throwRange * 2);
    expect(s.step(aimAt(s, far, { ...press() }))).toContain(GadgetEvent.PadInvalid);
    run(s, idleInput(), LAUNCH_PAD_CONFIG.throwCooldown + 0.05);
    expect(s.step(aimAt(s, new Vector3(0, 0, 4), { ...press() }))).toContain(GadgetEvent.PadPlaced);
  });

  it('keeps one pad: a new throw replaces the old', () => {
    const s = new RunSession(course([floor]), { gadget: GadgetId.LaunchPad, unlimited: true });
    run(s, idleInput(), 0.1);
    s.step(aimAt(s, new Vector3(0, 0, -8), { ...press() }));
    run(s, idleInput(), LAUNCH_PAD_CONFIG.throwCooldown + 0.05);
    s.step(aimAt(s, new Vector3(5, 0, -5), { ...press() }));
    expect((s.gadgets[0] as LaunchPadGadget).pad!.pos.x).toBeCloseTo(5, 1);
  });

  it('retry and respawn clear the pad', () => {
    const s = new RunSession(course([floor]), { gadget: GadgetId.LaunchPad, unlimited: true });
    run(s, idleInput(), 0.1);
    s.step(aimAt(s, new Vector3(0, 0, -8), { ...press() }));
    s.restart();
    expect((s.gadgets[0] as LaunchPadGadget).pad).toBeNull();
    expect(s.state).toBe(AttemptState.Ready);
  });
});

describe('budgets and using gadgets together', () => {
  const floor = slab(0, 0, 0, 2000, 2000);
  const anchor = new Vector3(0, 12, -15);
  const anchors = [anchor.toArray() as Point];

  /** Latch on with slot `slot`'s key, swing briefly, let go. */
  function swing(s: RunSession, slot = 0): string[] {
    s.step(aimAt(s, anchor, press(slot)));
    run(s, aimAt(s, anchor, hold(slot)), 0.3);
    return s.step(aimAt(s, anchor));
  }

  it('the grapple has two swings and misses are free', () => {
    const s = new RunSession(course([floor], anchors), { loadout: [GadgetId.Grapple, GadgetId.LaunchPad] });
    run(s, idleInput(), 0.1);
    s.step(aimAt(s, new Vector3(0, 0, 50), press()));
    expect(s.gadgets[0].usageLabel).toBe(`x${USAGE_CONFIG.grappleSwings}`);
    for (let i = 0; i < USAGE_CONFIG.grappleSwings; i++) {
      run(s, idleInput(), 1.5);
      expect(swing(s)).toContain(GadgetEvent.GrappleReleased);
    }
    expect(s.gadgets[0].usageLabel).toBe('x0');
    run(s, idleInput(), 1.5);
    expect(s.step(aimAt(s, anchor, press()))).not.toContain(GadgetEvent.GrappleAttached);
  });

  it('each slot has its own key: slot 2 dashes while slot 1 is the grapple', () => {
    const s = new RunSession(course([floor]), { loadout: [GadgetId.Grapple, GadgetId.Dash] });
    run(s, idleInput(), 0.1);
    expect(s.step(click({ forward: 1 }, 1))).toContain(GadgetEvent.Dashed);
    expect(s.gadgets[1].used).toBe(1);
    expect(s.gadgets[0].used).toBe(0);
  });

  it('a fresh press of another gadget cuts the rope with no boost, and the swing counts', () => {
    const s = new RunSession(course([floor], anchors), { loadout: [GadgetId.Grapple, GadgetId.Dash] });
    run(s, idleInput(), 0.1);
    s.step(aimAt(s, anchor, press(0)));
    run(s, aimAt(s, anchor, hold(0)), 0.3);
    expect((s.gadgets[0] as GrappleGadget).attached).toBe(true);
    const ev = s.step(aimAt(s, anchor, { ...press(1), use: [true, true, false] }));
    expect(ev).toContain(GadgetEvent.GrappleReleased);
    expect(ev).toContain(GadgetEvent.Dashed);
    expect(s.player.tethered).toBe(false);
    expect(s.gadgets[0].usageLabel).toBe(`x${USAGE_CONFIG.grappleSwings - 1}`);
    // The dash sets the speed: no release boost on top.
    expect(Math.hypot(s.player.vel.x, s.player.vel.z)).toBeLessThan(DASH_CONFIG.speed + DASH_CONFIG.boostOverCurrent + GRAPPLE_CONFIG.releaseBoost);
  });

  it('throwing a pad mid-swing keeps the rope; touching a pad while hooked launches and cuts it', () => {
    const low = new Vector3(0, 6, -10);
    const s = new RunSession(course([floor], [low.toArray() as Point]), { loadout: [GadgetId.Grapple, GadgetId.LaunchPad] });
    run(s, idleInput(), 0.1);
    s.step(aimAt(s, low, press(0)));
    expect((s.gadgets[0] as GrappleGadget).attached).toBe(true);
    // Throw at the floor right underfoot.
    const ev = s.step(aimAt(s, new Vector3(s.player.pos.x, 0, s.player.pos.z - 1.5), { ...press(1), use: [true, true, false] }));
    expect(ev).toContain(GadgetEvent.PadPlaced);
    expect((s.gadgets[0] as GrappleGadget).attached).toBe(true);
    // Hold the rope and drop onto the pad: it launches and the rope goes.
    const pad = (s.gadgets[1] as LaunchPadGadget).pad!;
    s.player.pos.set(pad.pos.x, pad.pos.y + 0.2, pad.pos.z);
    s.player.vel.set(0, -1, 0);
    const launch = s.step(aimAt(s, low, hold(0)));
    expect(launch).toContain(GadgetEvent.PadLaunched);
    expect(launch).toContain(GadgetEvent.GrappleReleased);
    expect(s.player.tethered).toBe(false);
  });

  it('jetpack and wingsuit held together: the jetpack wins and the glide pauses, then carries on', () => {
    const s = new RunSession(course([floor]), { loadout: [GadgetId.Wingsuit, GadgetId.Jetpack] });
    s.player.pos.set(0, 100, 0);
    s.player.vel.set(0, 0, -10);
    const both = { ...idleInput(), use: [true, true, false], usePressed: [] };
    run(s, both, 0.5);
    const wings = s.gadgets[0] as WingsuitGadget;
    const jet = s.gadgets[1] as JetpackGadget;
    expect(jet.thrusting).toBe(true);
    expect(wings.gliding).toBe(false);
    expect(wings.used).toBe(0);
    expect(s.player.vel.y).toBeGreaterThan(0);
    // Let go of the jetpack, still holding the wingsuit.
    run(s, { ...idleInput(), ...hold(0) }, 0.5);
    expect(wings.gliding).toBe(true);
    expect(wings.used).toBeGreaterThan(0);
  });

  it('hooking while the jetpack is held pauses it; it carries on once the rope comes off', () => {
    const s = new RunSession(course([floor], anchors), { loadout: [GadgetId.Grapple, GadgetId.Jetpack] });
    run(s, idleInput(), 0.1);
    run(s, { ...idleInput(), ...hold(1) }, 0.2);
    const jet = s.gadgets[1] as JetpackGadget;
    expect(jet.thrusting).toBe(true);
    s.step(aimAt(s, anchor, { use: [true, true, false], usePressed: [true, false, false] }));
    expect((s.gadgets[0] as GrappleGadget).attached).toBe(true);
    const fuel = jet.used;
    run(s, aimAt(s, anchor, { use: [true, true, false], usePressed: [] }), 0.3);
    // Held, not pressed: the rope stays, and no fuel burns.
    expect((s.gadgets[0] as GrappleGadget).attached).toBe(true);
    expect(jet.thrusting).toBe(false);
    expect(jet.used).toBe(fuel);
    // Let go of the rope: thrust picks up again.
    run(s, aimAt(s, anchor, hold(1)), 0.1);
    expect(jet.thrusting).toBe(true);
  });

  it('a thrown pad keeps working while you use other gadgets', () => {
    const s = new RunSession(course([floor]), { loadout: [GadgetId.LaunchPad, GadgetId.Dash] });
    run(s, idleInput(), 0.1);
    s.step(aimAt(s, new Vector3(0, 0, -20), press()));
    run(s, idleInput(), LAUNCH_PAD_CONFIG.throwCooldown + 0.05);
    // Re-throwing is free.
    s.step(aimAt(s, new Vector3(0, 0, -8), press()));
    const ev = run(s, { ...idleInput(), forward: 1 }, 1.5);
    expect(ev).toContain(GadgetEvent.PadLaunched);
    expect(s.gadgets[0].usageLabel).toBe('x0');
    expect((s.gadgets[0] as LaunchPadGadget).pad).toBeNull();
  });

  it('a retry refills every budget', () => {
    const s = new RunSession(course([floor], anchors), { loadout: [GadgetId.Grapple] });
    run(s, idleInput(), 0.1);
    swing(s);
    s.restart();
    expect(s.gadgets[0]?.remaining).toBe(1);
  });
});

it('rapid retries do not pile up gadget state', () => {
  const s = new RunSession(crossing, { gadget: GadgetId.LaunchPad, unlimited: true });
  for (let i = 0; i < 200; i++) {
    s.step(aimAt(s, new Vector3(0, 40, -6), { ...press() }));
    s.restart();
  }
  expect((s.gadgets[0] as LaunchPadGadget).pad).toBeNull();
  expect(s.attempt).toBe(201);
});
