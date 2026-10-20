import { describe, expect, it } from 'vitest';
import { GadgetId } from '../gadgets/types';
import { RunSession } from '../game/session';
import { gauntlet } from './gauntlet';
import { type Waypoint, runRoute } from './routeBot';

// Gauntlet: every gadget can finish on the running line (round every obstacle), and the lines
// through the obstacles beat it. Checkpoints off, so a fall would restart.

const START: Waypoint[] = [{ x: 0, z: -30 }];
/** Round the open ends of both barriers. */
const AROUND: Waypoint[] = [
  { x: 8.5, z: -50 },
  { x: 8.5, z: -60 },
  { x: 8.5, z: -75 },
  { x: 8.5, z: -85 },
];
const STONES: Waypoint[] = [
  { x: 7, z: -94, maxSpeed: 9 },
  { x: 13, z: -104, maxSpeed: 9 },
  { x: 13, z: -111, maxSpeed: 9 },
  { x: 6, z: -118 },
];
const RAMP: Waypoint[] = [
  { x: -14, z: -132 },
  { x: -14, z: -168 },
  { x: -6, z: -184 },
];
const BRIDGE: Waypoint[] = [
  { x: 12, z: -222, maxSpeed: 9 },
  { x: 12, z: -256, maxSpeed: 9 },
];
const FINISH: Waypoint[] = [
  { x: 2, z: -264 },
  { x: 0, z: -280 },
];

const RUNNING_LINE = [...START, ...AROUND, ...STONES, ...RAMP, ...BRIDGE, ...FINISH];

/** Through the middle of the track: the barriers, and straight at both gaps. */
const LOWER_TRACK: Waypoint[] = [{ x: 4, z: -200 }];

/** Slide under both barriers, and slide-jump the plunge (the burst carries you over). */
const SLIDE_LINE: Waypoint[] = [
  ...START,
  { x: 0, z: -48 },
  { x: 0, z: -60, crouch: true },
  { x: 0, z: -72 },
  { x: 0, z: -86, crouch: true },
  ...STONES,
  { x: 0, z: -128 },
  // Slide down the kicker, still sliding at the edge, so the jump is a slide-jump.
  { x: 0, z: -150, crouch: true },
  { x: 0, z: -170 },
  ...LOWER_TRACK,
  ...BRIDGE,
  ...FINISH,
];

/** Dash in the air over both gaps (a route fires on reaching the waypoint before: here, after the edge jump). */
const DASH_LINE: Waypoint[] = [
  ...START,
  ...AROUND,
  { x: 0, z: -92 },
  { x: 0, z: -102 },
  { x: 0, z: -118, press: true },
  { x: 0, z: -146 },
  { x: 0, z: -162, press: true },
  ...LOWER_TRACK,
  ...BRIDGE,
  ...FINISH,
];

const WINGSUIT_LINE: Waypoint[] = [
  ...START,
  ...AROUND,
  { x: 0, z: -92 },
  { x: 0, z: -102 },
  { x: 0, z: -118, hold: true },
  { x: 0, z: -146 },
  { x: 0, z: -164, hold: true },
  ...LOWER_TRACK,
  ...BRIDGE,
  ...FINISH,
];

const PAD_LINE: Waypoint[] = [
  ...START,
  ...AROUND,
  // Straight at the gap, so the pad faces across it.
  { x: 4, z: -88 },
  { x: 4, z: -92, pad: [4, 30, -97] },
  { x: 4, z: -97, noJump: true },
  { x: 0, z: -122 },
  { x: 0, z: -126, pad: [0, 28, -132] },
  { x: 0, z: -132, noJump: true },
  ...LOWER_TRACK,
  ...BRIDGE,
  ...FINISH,
];

const GRAPPLE_LINE: Waypoint[] = [
  ...START,
  ...AROUND,
  { x: 0, z: -89 },
  { x: 0, z: -94, grapple: { at: [0, 43.4, -107], releaseZ: -110 }, noJump: true },
  { x: 0, z: -124 },
  { x: 0, z: -136 },
  { x: 0, z: -142, grapple: { at: [0, 35.4, -152], releaseZ: -158 }, noJump: true },
  { x: 0, z: -184 },
  { x: 0, z: -226 },
  { x: 0, z: -230, grapple: { at: [0, 31.4, -242], releaseZ: -246 }, noJump: true },
  ...FINISH,
];

/** Across the corridor on its walls: run the left one, kick across, run the right one. */
const WALL_LINE: Waypoint[] = [
  ...SLIDE_LINE.slice(0, SLIDE_LINE.indexOf(LOWER_TRACK[0]) + 1),
  { x: -3.4, z: -216 },
  // Jump in right at the edge (on reaching this point, 2.5 m short of it), so the run starts high.
  { x: -3.4, z: -231.5 },
  { x: -3.4, z: -236, jump: true, noJump: true },
  { x: -3.4, z: -241, noJump: true },
  { x: 3.4, z: -247, kick: true, noJump: true },
  { x: 3.4, z: -256, noJump: true },
  ...FINISH,
];

const JETPACK_LINE: Waypoint[] = [
  ...START,
  ...AROUND,
  { x: 0, z: -92 },
  { x: 0, z: -102 },
  { x: 0, z: -118, hold: true, noJump: true },
  { x: 0, z: -146 },
  { x: 0, z: -162, hold: true, noJump: true },
  { x: 0, z: -228 },
  { x: 0, z: -256, hold: true, noJump: true },
  ...FINISH,
];

function run(gadget: GadgetId, route: Waypoint[]) {
  const session = new RunSession(gauntlet, { gadget, checkpointsEnabled: false, unlimited: true });
  return runRoute(session, route);
}

describe('Gauntlet', () => {
  const results = new Map<string, number>();

  it.each([
    ['running line', GadgetId.Jetpack, RUNNING_LINE],
    ['slide line', GadgetId.Jetpack, SLIDE_LINE],
    ['dash line', GadgetId.Dash, DASH_LINE],
    ['wingsuit line', GadgetId.Wingsuit, WINGSUIT_LINE],
    ['launch pad line', GadgetId.LaunchPad, PAD_LINE],
    ['grapple line', GadgetId.Grapple, GRAPPLE_LINE],
    ['jetpack line', GadgetId.Jetpack, JETPACK_LINE],
    ['wall line', GadgetId.Jetpack, WALL_LINE],
  ])('%s finishes without falling', (name, gadget, route) => {
    const r = run(gadget, route);
    results.set(name, r.seconds);
    expect(r.falls, `fell near (${r.last.toArray().map((n) => n.toFixed(1))}) heading for waypoint ${r.waypoint}`).toBe(0);
    expect(r.finished, `stuck near (${r.last.toArray().map((n) => n.toFixed(1))}) heading for waypoint ${r.waypoint}`).toBe(true);
  });

  it('every line through the obstacles beats going round them', () => {
    const base = results.get('running line')!;
    console.info(Object.fromEntries([...results].map(([k, v]) => [k, v.toFixed(2)])));
    for (const [name, seconds] of results) if (name !== 'running line') expect(seconds, name).toBeLessThan(base);
  });

  it('a plain running jump does not clear the plunge (it takes a slide-jump or a gadget)', () => {
    const upToKicker = SLIDE_LINE.findIndex((w) => w.z === -128);
    expect(upToKicker).toBeGreaterThan(0);
    const route: Waypoint[] = [...SLIDE_LINE.slice(0, upToKicker + 1), { x: 0, z: -170 }];
    const r = runRoute(new RunSession(gauntlet, { loadout: [], checkpointsEnabled: true }), route, 20);
    expect(r.falls).toBeGreaterThan(0);
  });
});
