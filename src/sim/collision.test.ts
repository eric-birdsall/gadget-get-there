import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { ramp, slab } from '../course/build';
import { type Contact, capsuleBoxContact, makeBox, raycast } from './collision';

const contact = (): Contact => ({ normal: new Vector3(), depth: 0, onFace: true, point: new Vector3() });

describe('capsuleBoxContact', () => {
  const floor = makeBox(slab(0, 0, 0, 10, 10));

  it('pushes a capsule sunk into a floor straight up', () => {
    const c = capsuleBoxContact(new Vector3(0, 0.3, 0), new Vector3(0, 1.4, 0), 0.4, floor, contact());
    expect(c).not.toBeNull();
    expect(c!.normal.y).toBeCloseTo(1);
    expect(c!.depth).toBeCloseTo(0.1);
  });

  it('reports nothing for a capsule resting just above', () => {
    expect(capsuleBoxContact(new Vector3(0, 0.41, 0), new Vector3(0, 1.4, 0), 0.4, floor, contact())).toBeNull();
  });

  it('gives a sideways normal against a wall', () => {
    const wallBox = makeBox({ center: [2, 1, 0], size: [1, 2, 4] });
    const c = capsuleBoxContact(new Vector3(1.2, 0.4, 0), new Vector3(1.2, 1.4, 0), 0.4, wallBox, contact())!;
    expect(c.normal.x).toBeCloseTo(-1);
    expect(c.depth).toBeCloseTo(0.1);
  });

  it('gives the slope normal on a rotated ramp', () => {
    const r = makeBox(ramp([0, 0, 0], [0, 10, -10], 6));
    // A point above the middle of a 45° ramp, sunk in a little.
    const c = capsuleBoxContact(new Vector3(0, 5.3, -5), new Vector3(0, 6.4, -5), 0.4, r, contact())!;
    expect(c.normal.y).toBeCloseTo(Math.SQRT1_2, 2);
    expect(c.normal.z).toBeCloseTo(Math.SQRT1_2, 2);
  });
});

describe('raycast', () => {
  const boxes = [makeBox(slab(0, 0, 0, 10, 10)), makeBox({ center: [0, 2, -5], size: [10, 4, 1] })];

  it('hits the floor from above', () => {
    const hit = raycast(boxes, new Vector3(0, 5, 0), new Vector3(0, -1, 0), 20)!;
    expect(hit.distance).toBeCloseTo(5);
    expect(hit.normal.y).toBeCloseTo(1);
  });

  it('returns the nearest of several boxes', () => {
    const hit = raycast(boxes, new Vector3(0, 1, 5), new Vector3(0, 0, -1), 50)!;
    expect(hit.distance).toBeCloseTo(9.5);
    expect(hit.normal.z).toBeCloseTo(1);
  });

  it('misses past max distance', () => {
    expect(raycast(boxes, new Vector3(0, 5, 0), new Vector3(0, -1, 0), 3)).toBeNull();
  });
});
