import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DT, LAUNCH_PAD_CONFIG, MOVEMENT_CONFIG, ROLLERBLADE_CONFIG, USAGE_CONFIG } from '../config';
import { slab, ramp } from '../course/build';
import type { CourseDefinition } from '../course/types';
import { crossing } from '../course/crossing';
import { AttemptState, RunSession, type SessionInput, idleInput } from '../game/session';
import { GrappleGadget, handPosition } from './grapple';
import { LaunchPadGadget } from './launchPad';
import { RollerbladeGadget } from './rollerblades';
import { GadgetEvent, GadgetId } from './types';

const course = (pieces: CourseDefinition['pieces'], anchors: CourseDefinition['anchors'] = []): CourseDefinition => ({
  ...crossing,
  start: { pos: [0, 0, 0], yaw: 0 },
  pieces,
  checkpoints: [],
  finish: { center: [0, -500, 0], size: [1, 1, 1] },
  anchors,
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

  it('latches onto an anchor under the crosshair and pulls you toward it', () => {
    const s = new RunSession(course([floor], [anchor.toArray() as [number, number, number]]), { gadget: GadgetId.Grapple, unlimited: true });
    run(s, idleInput(), 0.1);
    const ev = s.step(aimAt(s, anchor, { action: true, actionPressed: true }));
    expect(ev).toContain(GadgetEvent.GrappleAttached);
    expect((s.gadget as GrappleGadget).attached).toBe(true);
    const start = s.player.pos.distanceTo(anchor);
    run(s, aimAt(s, anchor, { action: true }), 1);
    expect(s.player.pos.distanceTo(anchor)).toBeLessThan(start - 3);
    expect(s.player.grounded).toBe(false);
  });

  it('misses safely when nothing is in the cone, and you keep running', () => {
    const s = new RunSession(course([floor], [anchor.toArray() as [number, number, number]]), { gadget: GadgetId.Grapple, unlimited: true });
    run(s, idleInput(), 0.1);
    const away = new Vector3(0, 0, 50);
    const ev = s.step(aimAt(s, away, { action: true, actionPressed: true, forward: 1 }));
    expect(ev).toContain(GadgetEvent.GrappleMissed);
    run(s, { ...idleInput(), forward: 1 }, 0.5);
    expect(Math.hypot(s.player.vel.x, s.player.vel.z)).toBeGreaterThan(5);
  });

  it('cannot latch through a wall', () => {
    const wall = { center: [0, 5, -7] as [number, number, number], size: [20, 10, 1] as [number, number, number] };
    const s = new RunSession(course([floor, wall], [anchor.toArray() as [number, number, number]]), { gadget: GadgetId.Grapple, unlimited: true });
    run(s, idleInput(), 0.1);
    expect(s.step(aimAt(s, anchor, { action: true, actionPressed: true }))).toContain(GadgetEvent.GrappleMissed);
  });

  it('releasing keeps your momentum', () => {
    const s = new RunSession(course([floor], [anchor.toArray() as [number, number, number]]), { gadget: GadgetId.Grapple, unlimited: true });
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
    const s = new RunSession(course([floor], [anchor.toArray() as [number, number, number]]), { gadget: GadgetId.Grapple, unlimited: true });
    run(s, idleInput(), 0.1);
    s.step(aimAt(s, anchor, { action: true, actionPressed: true }));
    s.restart();
    expect((s.gadget as GrappleGadget).attached).toBe(false);
    expect(s.player.tethered).toBe(false);
  });
});

describe('rollerblades', () => {
  it('top out faster than running on flat ground, but not without limit', () => {
    const s = new RunSession(course([slab(0, 0, 0, 2000, 2000)]), { gadget: GadgetId.Rollerblades, unlimited: true });
    run(s, { ...idleInput(), forward: 1 }, 5);
    const speed = Math.hypot(s.player.vel.x, s.player.vel.z);
    expect(speed).toBeGreaterThan(MOVEMENT_CONFIG.groundSpeed);
    expect(speed).toBeCloseTo(ROLLERBLADE_CONFIG.pushSpeed, 1);
  });

  it('gain far more speed downhill than running', () => {
    const hill = [ramp([0, 40, 0], [0, 0, -200], 12)];
    const speedAfter = (gadget: GadgetId) => {
      const s = new RunSession({ ...course(hill), start: { pos: [0, 39.9, -1], yaw: 0 } }, { gadget, unlimited: true });
      run(s, { ...idleInput(), forward: 1 }, 5);
      return Math.hypot(s.player.vel.x, s.player.vel.z);
    };
    expect(speedAfter(GadgetId.Rollerblades)).toBeGreaterThan(speedAfter(GadgetId.LaunchPad) + 8);
  });

  it('tucking with the button held reports a tuck and coasts', () => {
    const s = new RunSession(course([slab(0, 0, 0, 2000, 2000)]), { gadget: GadgetId.Rollerblades, unlimited: true });
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

describe('usage limits', () => {
  const floor = slab(0, 0, 0, 2000, 2000);
  const anchor = new Vector3(0, 12, -15);

  it('a grapple miss is free; one finished swing spends it and the next slot takes over', () => {
    const s = new RunSession(course([floor], [anchor.toArray() as [number, number, number]]), {
      loadout: [GadgetId.Grapple, GadgetId.LaunchPad, GadgetId.Rollerblades],
    });
    run(s, idleInput(), 0.1);
    s.step(aimAt(s, new Vector3(0, 0, 50), { action: true, actionPressed: true }));
    expect(s.gadget?.id).toBe(GadgetId.Grapple);
    s.step(aimAt(s, anchor, { action: true, actionPressed: true }));
    run(s, aimAt(s, anchor, { action: true }), 0.4);
    const ev = s.step(aimAt(s, anchor));
    expect(ev).toContain('gadget-switched');
    expect(s.gadget?.id).toBe(GadgetId.LaunchPad);
    expect(s.slot).toBe(1);
  });

  it('pads can be re-thrown freely; the launch spends it', () => {
    const s = new RunSession(course([floor]), { loadout: [GadgetId.LaunchPad, GadgetId.Rollerblades, GadgetId.Grapple] });
    run(s, idleInput(), 0.1);
    s.step(aimAt(s, new Vector3(0, 0, -20), { action: true, actionPressed: true }));
    run(s, idleInput(), LAUNCH_PAD_CONFIG.throwCooldown + 0.05);
    s.step(aimAt(s, new Vector3(0, 0, -8), { action: true, actionPressed: true }));
    expect(s.gadget?.id).toBe(GadgetId.LaunchPad);
    const ev = run(s, { ...idleInput(), forward: 1 }, 1.5);
    expect(ev).toContain(GadgetEvent.PadLaunched);
    expect(ev).toContain('gadget-switched');
    expect(s.gadget?.id).toBe(GadgetId.Rollerblades);
  });

  it('rollerblades last 5 s on the ground, not counting air time', () => {
    const s = new RunSession(course([floor]), { loadout: [GadgetId.Rollerblades, GadgetId.Grapple, GadgetId.LaunchPad] });
    run(s, idleInput(), 0.1);
    // Air time is free.
    s.player.pos.y = 30;
    s.player.grounded = false;
    run(s, idleInput(), 1.5);
    expect(s.gadget?.id).toBe(GadgetId.Rollerblades);
    run(s, { ...idleInput(), forward: 1 }, USAGE_CONFIG.rollerbladeSeconds - 0.2);
    expect(s.gadget?.id).toBe(GadgetId.Rollerblades);
    run(s, { ...idleInput(), forward: 1 }, 0.5);
    expect(s.gadget?.id).toBe(GadgetId.Grapple);
  });

  it('after all three, you go on foot; a retry refills them', () => {
    const s = new RunSession(course([floor]), { loadout: [GadgetId.Rollerblades, GadgetId.Grapple, GadgetId.LaunchPad] });
    s.step({ ...idleInput(), forward: 1 });
    s.slot = 2;
    (s as unknown as { gadget: unknown }).gadget = null;
    run(s, { ...idleInput(), forward: 1 }, 0.5);
    expect(s.gadget).toBeNull();
    expect(Math.hypot(s.player.vel.x, s.player.vel.z)).toBeCloseTo(MOVEMENT_CONFIG.groundSpeed, 1);
    s.restart();
    expect(s.slot).toBe(0);
    expect(s.gadget?.id).toBe(GadgetId.Rollerblades);
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
