import { describe, expect, it } from 'vitest';
import { GadgetId } from '../gadgets/types';
import { RunSession } from '../game/session';
import { crossing } from './crossing';
import { type Waypoint, runRoute } from './routeBot';

// Every gadget must be able to finish The Crossing, and each one's own line should beat the
// plain running line. Runs with checkpoints off, so a fall would restart rather than help.

const arc = (cx: number, cz: number, r: number, degrees: number[]): Waypoint[] =>
  degrees.map((d) => ({ x: cx + Math.cos((d * Math.PI) / 180) * r, z: cz - Math.sin((d * Math.PI) / 180) * r }));

const START: Waypoint[] = [{ x: 0, z: -30 }];
const HOPS: Waypoint[] = [
  { x: 0, z: -41, maxSpeed: 11 },
  { x: 0, z: -53, maxSpeed: 11 },
  { x: 0, z: -65, maxSpeed: 11 },
  { x: 2, z: -78, maxSpeed: 11 },
];
const STONES: Waypoint[] = [
  { x: 7, z: -85, maxSpeed: 7 },
  { x: 8, z: -92, maxSpeed: 7 },
  { x: 6, z: -98.5, maxSpeed: 7 },
];
const TO_HUB_A: Waypoint[] = [
  { x: 0, z: -107 },
  { x: 0, z: -125 },
  { x: 0, z: -150 },
];
const ZIGZAG: Waypoint[] = [
  { x: -6, z: -157, maxSpeed: 9 },
  { x: -9, z: -165, maxSpeed: 9 },
  { x: -13, z: -174.5, maxSpeed: 9 },
  { x: -9, z: -183, maxSpeed: 9 },
  { x: -4, z: -193 },
];
const BYPASS: Waypoint[] = [
  { x: 8, z: -205 },
  { x: 18, z: -232 },
  { x: 18, z: -268 },
  { x: 7, z: -292 },
];
// Round the barrier's open side.
const FINAL: Waypoint[] = [
  { x: 0, z: -305 },
  { x: 0, z: -338, maxSpeed: 12 },
  { x: 9.5, z: -348, maxSpeed: 11 },
  { x: 9.5, z: -356 },
  { x: 2, z: -366 },
  ...arc(16, -370, 16, [165, 150, 135, 120, 105, 90]),
  { x: 40, z: -386 },
  { x: 55, z: -386 },
];

export /** Mantle straight across the central gap, slide under the barrier. */
const ABILITY_LINE: Waypoint[] = [
  ...START,
  ...HOPS,
  ...STONES,
  ...TO_HUB_A,
  { x: 0, z: -157, holdJump: true },
  { x: 0, z: -167, holdJump: true },
  { x: 0, z: -178 },
  { x: 0, z: -192 },
  ...BYPASS,
  { x: 0, z: -305 },
  { x: 0, z: -340, crouch: true },
  { x: 0, z: -355, crouch: true },
  { x: 2, z: -366, maxSpeed: 12 },
  ...arc(16, -370, 16, [165, 150, 135, 120, 105, 90]),
  { x: 40, z: -386 },
  { x: 55, z: -386 },
];

const RUNNING_LINE = [...START, ...HOPS, ...STONES, ...TO_HUB_A, ...ZIGZAG, ...BYPASS, ...FINAL];

export const GRAPPLE_LINE: Waypoint[] = [
  ...START,
  ...HOPS,
  { x: 0, z: -80, grapple: { anchor: 0, releaseZ: -91 }, noJump: true },
  { x: 0, z: -107 },
  ...TO_HUB_A.slice(1),
  ...ZIGZAG,
  { x: 0, z: -205 },
  { x: 0, z: -207, grapple: { anchor: 1, releaseZ: -240 }, noJump: true },
  { x: 0, z: -248, grapple: { anchor: 2, releaseZ: -276 }, noJump: true },
  { x: 0, z: -300, noJump: true },
  ...FINAL,
];

export const ROLLERBLADE_LINE: Waypoint[] = [
  { x: -3, z: -5, press: true },
  { x: -5, z: -30 },
  { x: -9, z: -40, hold: true },
  { x: -22, z: -80, hold: true },
  { x: -22, z: -110 },
  { x: -7, z: -143, maxSpeed: 12 },
  { x: 0, z: -150, maxSpeed: 9 },
  ...ZIGZAG,
  ...BYPASS,
  ...FINAL,
];

export const PAD_LINE: Waypoint[] = [
  ...START,
  ...HOPS.slice(0, 3),
  { x: 0, z: -72, pad: [0, 36, -78] },
  { x: 0, z: -78, noJump: true },
  { x: 0, z: -107 },
  ...TO_HUB_A.slice(1),
  { x: 0, z: -152, pad: [0, 30, -158] },
  { x: 0, z: -158, noJump: true },
  { x: 0, z: -192 },
  ...BYPASS,
  ...FINAL,
];

function run(gadget: GadgetId, route: Waypoint[]) {
  // Training-style: one gadget, never runs out. This checks each gadget's lines on their own.
  const session = new RunSession(crossing, { gadget, checkpointsEnabled: false, unlimited: true });
  return runRoute(session, route);
}

describe('The Crossing', () => {
  const results = new Map<string, number>();

  it.each([
    ['running line, grapple equipped', GadgetId.Grapple, RUNNING_LINE],
    ['running line, rollerblades', GadgetId.Rollerblades, [{ x: 0, z: -5, press: true }, ...RUNNING_LINE]],
    ['running line, launch pad equipped', GadgetId.LaunchPad, RUNNING_LINE],
    ['grapple line', GadgetId.Grapple, GRAPPLE_LINE],
    ['rollerblade line', GadgetId.Rollerblades, ROLLERBLADE_LINE],
    ['launch pad line', GadgetId.LaunchPad, PAD_LINE],
    ['ability line (mantle + slide)', GadgetId.Grapple, ABILITY_LINE],
  ])('%s finishes without falling', (name, gadget, route) => {
    const r = run(gadget, route);
    results.set(name, r.seconds);
    expect(r.falls, `fell near (${r.last.toArray().map((n) => n.toFixed(1))}) heading for waypoint ${r.waypoint}`).toBe(0);
    expect(r.finished, `stuck near (${r.last.toArray().map((n) => n.toFixed(1))}) heading for waypoint ${r.waypoint}`).toBe(true);
    expect(r.seconds).toBeGreaterThan(20);
    expect(r.seconds).toBeLessThan(70);
  });

  it('a mixed run (swing, pad, then blades, switching between them) finishes and beats plain running', () => {
    const session = new RunSession(crossing, {
      loadout: [GadgetId.Grapple, GadgetId.LaunchPad, GadgetId.Rollerblades],
      checkpointsEnabled: false,
    });
    const route: Waypoint[] = [
      ...START,
      ...HOPS,
      { x: 0, z: -80, grapple: { anchor: 0, releaseZ: -91 }, noJump: true },
      { x: 0, z: -107 },
      ...TO_HUB_A.slice(1),
      { x: 0, z: -152, select: GadgetId.LaunchPad, pad: [0, 30, -158] },
      { x: 0, z: -158, noJump: true },
      { x: 0, z: -192, maxSpeed: 14 },
      { ...BYPASS[0], select: GadgetId.Rollerblades, press: true },
      ...BYPASS.slice(1),
      ...FINAL,
    ];
    const r = runRoute(session, route);
    expect(r.falls, `fell near (${r.last.toArray().map((n) => n.toFixed(1))}) heading for waypoint ${r.waypoint}`).toBe(0);
    expect(r.finished, `stuck near (${r.last.toArray().map((n) => n.toFixed(1))})`).toBe(true);
    expect(r.events.filter((e) => e === 'gadget-switched').length).toBe(2);
    expect(session.gadgets.map((g) => g.usageLabel)).toEqual(['x1', 'x0', '0.0s']);
    results.set('mixed run', r.seconds);
    expect(r.seconds).toBeLessThan(results.get('running line, grapple equipped')!);
  });

  it("each gadget's own line beats plain running", () => {
    const base = results.get('running line, grapple equipped')!;
    console.info(Object.fromEntries([...results].map(([k, v]) => [k, v.toFixed(2)])));
    expect(results.get('grapple line')!).toBeLessThan(base);
    expect(results.get('rollerblade line')!).toBeLessThan(base);
    expect(results.get('launch pad line')!).toBeLessThan(base);
    expect(results.get('ability line (mantle + slide)')!).toBeLessThan(base);
  });
});
