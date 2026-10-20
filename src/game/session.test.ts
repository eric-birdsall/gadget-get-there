import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DT } from '../config';
import { slab } from '../course/build';
import { crossing } from '../course/crossing';
import type { CourseDefinition } from '../course/types';
import { GadgetId } from '../gadgets/types';
import { AttemptState, RunSession, type SessionInput, SessionEvent, idleInput } from './session';

/** A 6 m start pad, a checkpoint pad 10 m ahead, a finish pad beyond, and a pit below. */
const tiny: CourseDefinition = {
  ...crossing,
  id: 'tiny',
  start: { pos: [0, 0, 0], yaw: 0 },
  pieces: [slab(0, 0, 0, 6, 6), slab(0, 0, -10, 6, 6), slab(0, 0, -20, 6, 6)],
  checkpoints: [{ center: [0, 1, -10], size: [6, 2, 6], respawn: { pos: [0, 0, -10], yaw: 0 } }],
  finish: { center: [0, 1, -21], size: [6, 2, 2] },
};

const go = (over: Partial<SessionInput> = {}): SessionInput => ({ ...idleInput(), forward: 1, ...over });

function stepUntil(s: RunSession, input: SessionInput, event: SessionEvent, maxSeconds = 10): boolean {
  for (let t = 0; t < maxSeconds; t += DT) if (s.step(input).includes(event)) return true;
  return false;
}

describe('attempt state machine', () => {
  it('waits in Ready, clock still, until a movement input', () => {
    const s = new RunSession(tiny);
    for (let i = 0; i < 60; i++) s.step(idleInput(i * 0.1));
    expect(s.state).toBe(AttemptState.Ready);
    expect(s.elapsed).toBe(0);
    expect(s.step(go())).toContain(SessionEvent.AttemptStarted);
    expect(s.state).toBe(AttemptState.Running);
    expect(s.elapsed).toBeCloseTo(DT);
  });

  it('a gadget press also starts the clock', () => {
    const s = new RunSession(tiny);
    s.step({ ...idleInput(), use: [false, true], usePressed: [false, true] });
    expect(s.state).toBe(AttemptState.Running);
  });

  it('restart clears velocity, clock, checkpoints and state', () => {
    const s = new RunSession(tiny);
    s.player.pos.set(0, 0, -10);
    s.step(go());
    expect(s.checkpoint).toBe(0);
    s.restart();
    expect(s.player.vel.length()).toBe(0);
    expect(s.player.pos.toArray()).toEqual([0, 0, 0]);
    expect(s.elapsed).toBe(0);
    expect(s.checkpoint).toBe(-1);
    expect(s.state).toBe(AttemptState.Ready);
  });
});

describe('checkpoints', () => {
  it('ON: a fall after a checkpoint respawns there and the clock keeps running', () => {
    const s = new RunSession(tiny, { checkpointsEnabled: true });
    s.player.pos.set(0, 0, -10);
    s.step(go());
    const before = s.elapsed;
    // Walk off the side.
    expect(stepUntil(s, go({ forward: 0, right: 1 }), SessionEvent.Fell)).toBe(true);
    expect(s.state).toBe(AttemptState.Running);
    expect(s.elapsed).toBeGreaterThan(before + 0.3);
    expect(s.player.pos.toArray()).toEqual([0, 0, -10]);
  });

  it('ON: a fall before any checkpoint returns to the start without resetting the clock', () => {
    const s = new RunSession(tiny, { checkpointsEnabled: true });
    expect(stepUntil(s, go({ right: 1, forward: 0 }), SessionEvent.Fell)).toBe(true);
    expect(s.state).toBe(AttemptState.Running);
    expect(s.elapsed).toBeGreaterThan(0.3);
    expect(s.player.pos.toArray()).toEqual([0, 0, 0]);
  });

  it('OFF: a fall restarts at the start with the clock reset', () => {
    const s = new RunSession(tiny, { checkpointsEnabled: false });
    s.player.pos.set(0, 0, -10);
    s.step(go());
    expect(s.checkpoint).toBe(-1);
    expect(stepUntil(s, go({ right: 1, forward: 0 }), SessionEvent.Fell)).toBe(true);
    expect(s.state).toBe(AttemptState.Ready);
    expect(s.elapsed).toBe(0);
    expect(s.player.pos.toArray()).toEqual([0, 0, 0]);
  });

  it('a mid-run setting change waits for the next attempt', () => {
    const s = new RunSession(tiny, { checkpointsEnabled: true });
    s.step(go());
    s.setCheckpointsEnabled(false);
    expect(s.checkpointsEnabled).toBe(true);
    s.restart();
    expect(s.checkpointsEnabled).toBe(false);
  });

  it('backtracking never moves the respawn point back', () => {
    const course: CourseDefinition = {
      ...tiny,
      checkpoints: [
        { center: [0, 1, -5], size: [6, 2, 2], respawn: { pos: [0, 0, -5], yaw: 0 } },
        { center: [0, 1, -10], size: [6, 2, 6], respawn: { pos: [0, 0, -10], yaw: 0 } },
      ],
    };
    const s = new RunSession(course);
    s.player.pos.set(0, 0, -10);
    s.step(go());
    expect(s.checkpoint).toBe(1);
    s.player.pos.set(0, 0, -5);
    s.step(go());
    expect(s.checkpoint).toBe(1);
  });
});

describe('finish', () => {
  it('stops the clock exactly once and records a result with a ghost', () => {
    const s = new RunSession(tiny, { gadget: GadgetId.Jetpack, checkpointsEnabled: false });
    s.player.pos.set(0, 0, -18);
    let finishes = 0;
    for (let t = 0; t < 3; t += DT) if (s.step(go()).includes(SessionEvent.Finished)) finishes++;
    expect(finishes).toBe(1);
    expect(s.state).toBe(AttemptState.Finished);
    const time = s.elapsed;
    s.step(go());
    expect(s.elapsed).toBe(time);
    expect(s.result?.seconds).toBe(time);
    expect(s.result?.loadout[0]).toBe(GadgetId.Jetpack);
    expect(s.result?.checkpointsEnabled).toBe(false);
    expect(s.result?.ghost.samples.length).toBeGreaterThan(0);
    // Coasting off the end afterwards keeps the result.
    for (let t = 0; t < 5; t += DT) s.step(go());
    expect(s.state).toBe(AttemptState.Finished);
    expect(s.result?.seconds).toBe(time);
  });

  it('a fall can never finish', () => {
    const course: CourseDefinition = { ...tiny, finish: { center: [0, -30, 0], size: [50, 4, 50] } };
    const s = new RunSession(course, { checkpointsEnabled: false });
    const events: SessionEvent[] = [];
    for (let t = 0; t < 5; t += DT) events.push(...(s.step(go({ right: 1, forward: 0 })) as SessionEvent[]));
    expect(events).toContain(SessionEvent.Fell);
    expect(events).not.toContain(SessionEvent.Finished);
  });
});

describe('gadget order', () => {
  it('clicking adds a gadget to the next free slot, and removes one already chosen', () => {
    const s = new RunSession(tiny, { loadout: [GadgetId.Grapple, GadgetId.LaunchPad, GadgetId.Jetpack] });
    expect(s.toggleGadget(GadgetId.Grapple)).toBe(true);
    // The rest move up.
    expect(s.loadout).toEqual([GadgetId.LaunchPad, GadgetId.Jetpack]);
    expect(s.gadgets[0]?.id).toBe(GadgetId.LaunchPad);
    s.toggleGadget(GadgetId.Grapple);
    expect(s.loadout).toEqual([GadgetId.LaunchPad, GadgetId.Jetpack, GadgetId.Grapple]);
    expect(s.loadout[1]).toBe(GadgetId.Jetpack);
  });

  it('clearing empties every slot, only at the start line', () => {
    const s = new RunSession(tiny, { loadout: [GadgetId.Grapple, GadgetId.LaunchPad] });
    expect(s.clearGadgets()).toBe(true);
    expect(s.loadout).toEqual([]);
    expect(s.gadgets).toEqual([]);
    expect(s.clearGadgets()).toBe(false);
    s.toggleGadget(GadgetId.Jetpack);
    s.step(go());
    expect(s.clearGadgets()).toBe(false);
    expect(s.loadout).toEqual([GadgetId.Jetpack]);
  });

  it('allows fewer than three gadgets, or none', () => {
    const s = new RunSession(tiny, { loadout: [GadgetId.Jetpack] });
    expect(s.loadout).toEqual([GadgetId.Jetpack]);
    s.toggleGadget(GadgetId.Jetpack);
    expect(s.loadout).toEqual([]);
    expect(s.gadgets).toEqual([]);
    s.step(go());
    expect(s.state).toBe(AttemptState.Running);
  });

  it('locks once the clock starts', () => {
    const s = new RunSession(tiny, { loadout: [GadgetId.Grapple, GadgetId.LaunchPad, GadgetId.Jetpack] });
    s.step(go());
    expect(s.toggleGadget(GadgetId.Grapple)).toBe(false);
    expect(s.loadout[0]).toBe(GadgetId.Grapple);
    expect(s.gadgets[0]?.id).toBe(GadgetId.Grapple);
  });

  it('a checkpoint respawn restores gadgets to how they were at that checkpoint', () => {
    const s = new RunSession(tiny, { checkpointsEnabled: true, loadout: [GadgetId.Grapple, GadgetId.Jetpack] });
    const jet = { ...idleInput(), use: [false, true] };
    s.step(go());
    // Burn a little fuel, then reach the checkpoint.
    for (let i = 0; i < 30; i++) s.step(jet);
    s.player.pos.set(0, 0, -10);
    s.player.vel.set(0, 0, 0);
    s.step(idleInput());
    expect(s.checkpoint).toBe(0);
    const atCheckpoint = s.gadgets[1].used;
    expect(atCheckpoint).toBeGreaterThan(0);
    // After it: burn more.
    for (let i = 0; i < 30; i++) s.step(jet);
    for (let i = 0; i < 120; i++) s.step(idleInput());
    expect(s.gadgets[1].used).toBeGreaterThan(atCheckpoint);
    // Fall: back to the checkpoint's state.
    expect(stepUntil(s, go({ right: 1, forward: 0 }), SessionEvent.Fell)).toBe(true);
    expect(s.state).toBe(AttemptState.Running);
    expect(s.gadgets[1].used).toBe(atCheckpoint);
    // A full retry refills everything.
    s.restart();
    expect(s.gadgets.every((g) => g.remaining === 1)).toBe(true);
  });

  it('a respawn before any checkpoint gives back the full start loadout', () => {
    const s = new RunSession(tiny, { checkpointsEnabled: true, loadout: [GadgetId.Jetpack, GadgetId.Grapple] });
    for (let i = 0; i < 30; i++) s.step({ ...idleInput(), use: [true] });
    for (let i = 0; i < 120; i++) s.step(idleInput());
    expect(s.gadgets[0].used).toBeGreaterThan(0);
    expect(stepUntil(s, go({ right: 1, forward: 0 }), SessionEvent.Fell)).toBe(true);
    expect(s.state).toBe(AttemptState.Running);
    expect(s.gadgets.every((g) => g.used === 0)).toBe(true);
  });
});

describe('falling into the void', () => {
  const twoLevels: CourseDefinition = { ...tiny, pieces: [slab(0, 0, 0, 6, 6), slab(30, -40, 0, 6, 6)] };

  it('counts as a fall soon after dropping off, without waiting for the kill plane', () => {
    const s = new RunSession(twoLevels, { checkpointsEnabled: false });
    let seconds = 0;
    while (!s.step(go()).includes(SessionEvent.Fell) && seconds < 10) seconds += DT;
    expect(seconds).toBeLessThan(1.5);
  });

  it('does not count while arcing toward a platform that is not yet below', () => {
    const s = new RunSession(twoLevels);
    s.player.pos.set(0, -20, 0);
    s.player.vel.set(25, -0.1, 0);
    expect(s.step(idleInput())).not.toContain(SessionEvent.Fell);
  });

  it('does not count while there is a platform below to land on', () => {
    const s = new RunSession(twoLevels);
    s.player.pos.set(30, 0, 0);
    let fell = false;
    for (let t = 0; t < 4; t += DT) fell ||= s.step(idleInput()).includes(SessionEvent.Fell);
    expect(fell).toBe(false);
    expect(s.player.pos.y).toBeCloseTo(-40, 2);
  });
});

it('spawns standing on The Crossing start runway', () => {
  const s = new RunSession(crossing);
  for (let i = 0; i < 30; i++) s.step(idleInput());
  expect(s.player.grounded).toBe(true);
  expect(s.player.pos.y).toBeCloseTo(crossing.start.pos[1], 2);
  expect(new Vector3(...crossing.start.pos).distanceTo(s.player.pos)).toBeLessThan(0.01);
});
