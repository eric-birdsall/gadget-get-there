import { GadgetId } from '../gadgets/types';
import { SurfaceKind } from '../sim/collision';
import { overhead, ramp, runWall, slab } from './build';
import type { CourseDefinition } from './types';

/**
 * "Ascent": an uphill course that climbs from y 10 to y 40 over about 260 m. Forward is -Z.
 * Where The Crossing rewards carrying speed downhill, this one rewards getting up fast:
 *
 * 1. Start runway, then stair hops up the middle (+1 m each), or a gentle ramp on the left.
 * 2. Hub A, at the foot of an 8 m cliff. Ways up: a ramp along the right side; a stack of three
 *    ledges in the middle to mantle one after another; a jetpack straight up the face; or the
 *    grapple, swinging from a beam over the cliff top.
 * 3. The shelf, at the foot of a 12 m cliff: a long ramp up the left side (a wall beside it to
 *    run), or jetpack and grapple straight up the face (the rope hauls you up the last of it).
 * 4. The summit, a last ramp up and the finish gate.
 */
export const ascent: CourseDefinition = {
  id: 'ascent',
  name: 'Ascent',
  environmentTheme: 'day',
  start: { pos: [0, 10, 4], yaw: 0 },
  medalThresholds: { goldSeconds: 21, silverSeconds: 26, bronzeSeconds: 36 },
  availableGadgetIds: [GadgetId.Grapple, GadgetId.Jetpack, GadgetId.LaunchPad, GadgetId.Dash, GadgetId.Wingsuit],
  referenceTargetDurationSeconds: 40,

  pieces: [
    // 1. Start runway, stair hops up the middle, and the ramp on the left.
    slab(0, 10, -12, 16, 44),
    slab(0, 11, -41, 8, 8),
    slab(0, 12, -52, 8, 8),
    slab(0, 13, -63, 8, 8),
    slab(0, 14, -74, 8, 8),
    ramp([-10, 10, -34], [-10, 14, -80], 7),

    // 2. Hub A, under the first cliff.
    slab(8, 14, -90, 48, 20),
    // Three ledges to mantle, each 2.3 m above the last.
    slab(0, 16.3, -90, 6, 4, SurfaceKind.Accent, 2.3),
    slab(0, 18.6, -94, 6, 4, SurfaceKind.Accent, 4.6),
    slab(0, 20.9, -98, 6, 4, SurfaceKind.Accent, 6.9),
    // The ramp up the right side.
    ramp([28, 14, -100], [28, 22, -130], 7),

    // 3. The shelf: the top of the first cliff, at the foot of the second.
    slab(4, 22, -135, 40, 70, SurfaceKind.Platform, 8),
    // The long ramp up the left side of the second cliff.
    ramp([-17, 22, -140], [-17, 34, -190], 9.5),
    // A wall beside it, to run along.
    runWall(-22.5, 30, -165, 12, 30),

    // 4. The summit (the top of the second cliff), the last ramp and the finish.
    slab(0, 34, -190, 24, 40, SurfaceKind.Platform, 12),
    ramp([0, 34, -210], [0, 40, -234], 10),
    slab(0, 40, -244, 14, 20),

    // Grapple beams hanging just out from each cliff face (so the rope clears the edge), and a few
    // more along the way.
    overhead(4, 33, -95, 12, 1.2, 3),
    overhead(0, 50, -163, 14, 1.5, 3),
    overhead(0, 22, -50, 12, 1.2, 2.5),
    overhead(28, 30, -118, 3, 1.2, 12),
    overhead(0, 48, -232, 10, 1.2, 3),
  ],

  checkpoints: [
    { center: [8, 15.5, -90], size: [48, 4, 20], respawn: { pos: [0, 14, -84], yaw: 0 } },
    { center: [4, 23.5, -135], size: [40, 4, 70], respawn: { pos: [0, 22, -106], yaw: 0 } },
    { center: [0, 35.5, -190], size: [24, 4, 40], respawn: { pos: [0, 34, -178], yaw: 0 } },
  ],

  finish: { center: [0, 42.5, -250], size: [12, 5, 2] },
};
