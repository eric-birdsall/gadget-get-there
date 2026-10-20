import { describe, expect, it } from 'vitest';
import { GadgetId } from '../gadgets/types';
import { RunSession } from '../game/session';
import { ascent } from './ascent';
import { type Waypoint, runRoute } from './routeBot';

// Ascent climbs: every gadget can finish on the running line, and the climbing lines (mantles,
// grapple, jetpack) and the dash beat it. Checkpoints off, so a fall would restart.

const START: Waypoint[] = [{ x: 0, z: -30 }];
const STAIRS: Waypoint[] = [
  { x: 0, z: -41, maxSpeed: 11 },
  { x: 0, z: -52, maxSpeed: 11 },
  { x: 0, z: -63, maxSpeed: 11 },
  { x: 0, z: -74, maxSpeed: 11 },
];
const RIGHT_RAMP: Waypoint[] = [
  { x: 10, z: -86 },
  { x: 28, z: -98 },
  { x: 28, z: -130 },
];
const LEFT_RAMP: Waypoint[] = [
  { x: -17, z: -142 },
  { x: -17, z: -188 },
  { x: -6, z: -196 },
];
const FINISH: Waypoint[] = [
  { x: 0, z: -206 },
  { x: 0, z: -244 },
  { x: 0, z: -256 },
];

const RUNNING_LINE = [...START, ...STAIRS, ...RIGHT_RAMP, ...LEFT_RAMP, ...FINISH];

/** Mantle up the three ledges instead of taking the right-hand ramp. */
const MANTLE_LINE: Waypoint[] = [
  ...START,
  ...STAIRS,
  { x: 0, z: -84 },
  { x: 0, z: -88, holdJump: true },
  { x: 0, z: -92, holdJump: true },
  { x: 0, z: -96, holdJump: true },
  { x: 0, z: -100, holdJump: true },
  { x: -4, z: -112 },
  ...LEFT_RAMP,
  ...FINISH,
];

/** Swing up both cliffs. */
const GRAPPLE_LINE: Waypoint[] = [
  ...START,
  ...STAIRS,
  // Beside the mantle ledges, which stand in the middle.
  { x: 6, z: -84 },
  { x: 6, z: -88, grapple: { at: [6, 32.4, -95], releaseZ: -99.5 }, noJump: true },
  { x: 2, z: -125 },
  // A route fires on reaching the waypoint before, so that one sets the range.
  { x: 0, z: -143 },
  { x: 0, z: -150, grapple: { at: [0, 49.25, -163], releaseZ: -170.5, releaseY: 36 }, noJump: true },
  { x: 0, z: -196 },
  ...FINISH,
];

/** Thrust straight up both cliff faces. */
const JETPACK_LINE: Waypoint[] = [
  ...START,
  ...STAIRS,
  { x: 0, z: -84 },
  { x: 0, z: -106, hold: true, noJump: true },
  { x: 0, z: -146 },
  { x: 0, z: -176, hold: true, noJump: true },
  { x: 0, z: -196 },
  ...FINISH,
];

/** The running line, with dashes up the long ramps. */
const DASH_LINE: Waypoint[] = [
  ...START,
  ...STAIRS,
  RIGHT_RAMP[0],
  { ...RIGHT_RAMP[1], press: true },
  RIGHT_RAMP[2],
  LEFT_RAMP[0],
  { x: -17, z: -150 },
  { x: -17, z: -170, press: true },
  ...LEFT_RAMP.slice(1),
  ...FINISH,
];

function run(gadget: GadgetId, route: Waypoint[]) {
  const session = new RunSession(ascent, { gadget, checkpointsEnabled: false, unlimited: true });
  return runRoute(session, route);
}

describe('Ascent', () => {
  const results = new Map<string, number>();

  it.each([
    ['running line', GadgetId.Wingsuit, RUNNING_LINE],
    ['mantle line', GadgetId.Wingsuit, MANTLE_LINE],
    ['grapple line', GadgetId.Grapple, GRAPPLE_LINE],
    ['jetpack line', GadgetId.Jetpack, JETPACK_LINE],
    ['dash line', GadgetId.Dash, DASH_LINE],
  ])('%s finishes without falling', (name, gadget, route) => {
    const r = run(gadget, route);
    results.set(name, r.seconds);
    expect(r.falls, `fell near (${r.last.toArray().map((n) => n.toFixed(1))}) heading for waypoint ${r.waypoint}`).toBe(0);
    expect(r.finished, `stuck near (${r.last.toArray().map((n) => n.toFixed(1))}) heading for waypoint ${r.waypoint}`).toBe(true);
  });

  it('the climbing lines and the dash beat plain running', () => {
    const base = results.get('running line')!;
    console.info(Object.fromEntries([...results].map(([k, v]) => [k, v.toFixed(2)])));
    for (const line of ['mantle line', 'grapple line', 'jetpack line', 'dash line']) expect(results.get(line)!).toBeLessThan(base);
  });
});
