import { Vector3 } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { GadgetId } from '../gadgets/types';
import { RecordStore } from '../storage/records';
import { GHOST_STRIDE, type GhostData, GhostPlayer, GhostRecorder, type GhostPose, isValidGhost } from './ghost';
import { Medal, medalFor } from './medals';

/** A Map-backed localStorage for node. */
function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

beforeEach(() => {
  Object.assign(globalThis, { localStorage: fakeStorage() });
});

const ghost = (n: number): GhostData => {
  const r = new GhostRecorder();
  for (let i = 0; i <= n; i++) r.sample(i * 0.05, new Vector3(i, 0, 0), 0, null, true);
  return r.finish();
};

describe('medals', () => {
  const t = { goldSeconds: 30, silverSeconds: 40, bronzeSeconds: 55 };
  it('are inclusive at the boundaries', () => {
    expect(medalFor(30, t)).toBe(Medal.Gold);
    expect(medalFor(30.001, t)).toBe(Medal.Silver);
    expect(medalFor(40, t)).toBe(Medal.Silver);
    expect(medalFor(55, t)).toBe(Medal.Bronze);
    expect(medalFor(55.001, t)).toBe(Medal.None);
  });
});

describe('personal bests', () => {
  const ORDER = [GadgetId.Grapple, GadgetId.LaunchPad, GadgetId.Jetpack];
  const run = (seconds: number, g: GhostData | null = null, checkpoints = false) => ({
    seconds,
    loadout: ORDER,
    checkpoints,
    date: 1,
    ghost: g,
  });

  it('the first finish sets the PB and its ghost', () => {
    const r = new RecordStore();
    expect(r.submit('c', run(50, ghost(10)))).toBe(true);
    expect(r.best('c')?.seconds).toBe(50);
    expect(r.best('c')?.ghost?.samples.length).toBeGreaterThan(0);
  });

  it('a faster run replaces PB and ghost; a slower one changes neither', () => {
    const r = new RecordStore();
    r.submit('c', run(50, ghost(10)));
    expect(r.submit('c', { ...run(55, ghost(3)), loadout: [...ORDER].reverse() })).toBe(false);
    expect(r.best('c')?.loadout).toEqual(ORDER);
    expect(r.submit('c', run(45, ghost(3)))).toBe(true);
    const best = r.best('c')!;
    expect(best.seconds).toBe(45);
    expect(best.ghost!.samples.length).toBe(4 * GHOST_STRIDE);
  });

  it('one best per level, whatever the checkpoint setting', () => {
    const r = new RecordStore();
    r.submit('c', run(40, null, false));
    expect(r.submit('c', run(30, null, true))).toBe(true);
    expect(r.best('c')?.checkpoints).toBe(true);
    expect(r.best('other')).toBeNull();
  });

  it('a saved best whose loadout used a removed gadget keeps its time; the gadget drops out', () => {
    localStorage.setItem(
      'gadget-get-there.records',
      JSON.stringify({ version: 2, levels: { c: { seconds: 31, loadout: ['rollerblades', 'grapple'], checkpoints: false, date: 1, ghost: null } } }),
    );
    const b = new RecordStore().best('c');
    expect(b?.seconds).toBe(31);
    expect(b?.loadout).toEqual([GadgetId.Grapple]);
  });

  it('survive a reload', () => {
    new RecordStore().submit('c', run(33, ghost(5)));
    const again = new RecordStore().best('c');
    expect(again?.seconds).toBe(33);
    expect(again?.ghost).not.toBeNull();
  });

  it('corrupt or obsolete saves fail gracefully', () => {
    localStorage.setItem('gadget-get-there.records', '{not json');
    expect(new RecordStore().best('c')).toBeNull();
    // The old per-checkpoint-mode format is dropped.
    localStorage.setItem('gadget-get-there.records', JSON.stringify({ version: 1, courses: { c: {} } }));
    expect(new RecordStore().best('c')).toBeNull();
    // A good time with a broken ghost keeps the time, drops the ghost.
    localStorage.setItem(
      'gadget-get-there.records',
      JSON.stringify({ version: 2, levels: { c: { seconds: 31, loadout: ORDER, checkpoints: false, date: 1, ghost: { version: 1, samples: [1, 2] } } } }),
    );
    const b = new RecordStore().best('c');
    expect(b?.seconds).toBe(31);
    expect(b?.ghost).toBeNull();
  });

  it('storage being unavailable does not stop play', () => {
    Object.assign(globalThis, {
      localStorage: {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
      },
    });
    const r = new RecordStore();
    expect(r.submit('c', run(30))).toBe(true);
    expect(r.best('c')?.seconds).toBe(30);
  });
});

describe('ghost', () => {
  const pose = (): GhostPose => ({ pos: new Vector3(), yaw: 0, rope: null });

  it('interpolates between samples at any time, including after dropped frames', () => {
    const g = new GhostPlayer(ghost(20));
    expect(g.poseAt(0.025, pose()).pos.x).toBeCloseTo(0.5);
    // Jump ahead, then back: the cursor copes with both.
    expect(g.poseAt(0.775, pose()).pos.x).toBeCloseTo(15.5);
    expect(g.poseAt(0.1, pose()).pos.x).toBeCloseTo(2);
    // Past the end it holds the last pose.
    expect(g.poseAt(99, pose()).pos.x).toBeCloseTo(20);
  });

  it('snaps across a respawn instead of gliding', () => {
    const r = new GhostRecorder();
    r.sample(0, new Vector3(0, 0, 0), 0, null, true);
    r.sample(0.05, new Vector3(50, 0, 0), 0, null, true);
    const g = new GhostPlayer(r.finish());
    expect(g.poseAt(0.04, pose()).pos.x).toBe(0);
  });

  it('only records at the sample rate', () => {
    const r = new GhostRecorder();
    for (let t = 0; t < 1; t += 1 / 120) r.sample(t, new Vector3(), 0, null);
    expect(r.finish().samples.length / GHOST_STRIDE).toBeLessThanOrEqual(21);
  });

  it('validates saved data', () => {
    expect(isValidGhost(ghost(3))).toBe(true);
    expect(isValidGhost({ version: 1, samples: ghost(3).samples })).toBe(false);
    expect(isValidGhost({ version: 1, samples: [1, 2, 3] })).toBe(false);
    expect(isValidGhost({ version: 1, samples: [0, 0, 0, 0, 0, 0, 0, 0, 'x'] })).toBe(false);
    expect(isValidGhost(null)).toBe(false);
  });
});
