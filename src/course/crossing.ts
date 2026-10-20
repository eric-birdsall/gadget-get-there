import { GadgetId } from '../gadgets/types';
import { SurfaceKind } from '../sim/collision';
import { bankedCurve, overhead, ramp, runWall, slab, wall } from './build';
import type { CourseDefinition } from './types';

/**
 * "The Crossing": a floating course that drops from y 40 to y 10 over about 420 m.
 * Forward is -Z. Every section has a plain running-and-jumping line that any gadget can take,
 * plus a faster line that one gadget is built for:
 *
 * 1. Start runway.
 * 2. First split: platform hops down the middle to a 20 m gap (a beam above it to grapple, a
 *    launch pad clears it, runners take stepping stones to the right), then a long ramp down to
 *    hub A; or a long smooth downhill on the left.
 * 3. Central gap: a 27 m drop-gap a launch pad crosses in one arc; the zigzag stones go around,
 *    and two blocks straight across are reachable only by mantling.
 * 4. Elevated bypass: two beams over the void to grapple across, or a long gently descending ramp loop
 *    to the right.
 * 5. Final sprint: a steep down ramp, a broad platform with a barrier (slide under its middle
 *    or go round), a banked right turn (a block above the corner) and the finish gate.
 *
 * Tall walls for wall running sit beside the runway, beside the big gap, and in a zigzag across
 * the bypass void.
 *
 * The grapple hooks any surface, so the course also floats gold beams, blocks and ceilings well
 * above the path (out of jump reach) to swing from.
 */
export const crossing: CourseDefinition = {
  id: 'the-crossing',
  name: 'The Crossing',
  environmentTheme: 'day',
  start: { pos: [0, 40, 4], yaw: 0 },
  medalThresholds: { goldSeconds: 32, silverSeconds: 40, bronzeSeconds: 55 },
  availableGadgetIds: [GadgetId.Grapple, GadgetId.Jetpack, GadgetId.LaunchPad, GadgetId.Dash, GadgetId.Wingsuit],
  referenceTargetDurationSeconds: 45,

  pieces: [
    // 1. Start runway.
    slab(0, 40, -12, 16, 44),

    // 2. Middle hops (8 m deep, so they still work at dash speed).
    slab(0, 39, -41, 7, 8),
    slab(0, 38, -53, 7, 8),
    slab(0, 37, -65, 7, 8),
    slab(0, 36, -77, 8, 8),
    // Stepping stones around the big gap, to the right.
    slab(7, 36, -85, 6, 6, SurfaceKind.Accent),
    slab(8, 35.5, -92, 6, 6, SurfaceKind.Accent),
    slab(7, 35, -98.5, 6, 6, SurfaceKind.Accent),
    // Across the gap: a long landing that runs down to hub A, so swing and launch speed carries.
    slab(0, 34, -107, 10, 12),
    ramp([0, 34, -113], [0, 30, -141], 8),
    // Left: the long smooth downhill.
    ramp([-7, 40, -34], [-22, 33, -80], 8),
    ramp([-22, 33, -80], [-22, 32, -110], 8),
    ramp([-22, 32, -110], [-7, 30, -143], 8),
    // Hub A.
    slab(0, 30, -150, 22, 20),

    // 3. Central gap: zigzag stones on the left.
    slab(-9, 29.5, -165, 7, 7, SurfaceKind.Accent),
    slab(-13, 28.5, -174.5, 7, 7, SurfaceKind.Accent),
    slab(-9, 27.5, -183, 7, 7, SurfaceKind.Accent),
    // Straight across: the first block is 2.3 m above hub A, too high to jump onto. Mantle it.
    slab(0, 32.3, -167, 5, 5),
    slab(0, 30.5, -178, 5, 5),
    // Hub B.
    slab(0, 26, -197, 22, 20),

    // 4. Elevated bypass: the safe ramp loop to the right…
    ramp([8, 26, -207], [18, 23, -232], 8),
    ramp([18, 23, -232], [18, 20, -268], 8),
    ramp([18, 20, -268], [7, 18, -292], 8),
    // …and a small rest platform under the beams.
    slab(0, 22, -250, 6, 6, SurfaceKind.Accent),
    // Hub C.
    slab(0, 18, -300, 22, 20),

    // 5. Final sprint.
    ramp([0, 18, -310], [0, 10, -340], 12),
    slab(0, 10, -355, 24, 30),
    // A barrier across the platform: slide under its middle slot, or go round the open sides.
    wall(-4.75, -352, 4.5, 2, 10, 14),
    wall(4.75, -352, 4.5, 2, 10, 14),
    { center: [0, 12.55, -352], size: [5, 2.9, 2], kind: SurfaceKind.Wall },
    ...bankedCurve(16, 10, -370, 16, 180, 90, 10, 16, 12),
    slab(36, 10, -386, 40, 10),

    // Wall-run walls. A test wall beside the start runway (jump off its right edge onto it)…
    runWall(9.5, 43.5, -20, 7, 28),
    // …one beside the big gap in section 2, to run past it on the left…
    runWall(-6.5, 38, -91, 12, 26),
    // …and a zigzag of five across the bypass void: run one, kick across to the next. Each starts
    // before the last one ends, so a kick always has a wall waiting.
    // Tall, so chained kicks (which gain height on fast runs) never clear the top.
    runWall(-3.5, 27, -219, 22, 20),
    runWall(3.5, 26, -234, 22, 20),
    runWall(-3.5, 25, -249, 22, 20),
    runWall(3.5, 24, -264, 22, 20),
    runWall(-3.5, 23, -279, 22, 20),

    // Overhead grapple points: beams, blocks and ceilings high above the path.
    overhead(0, 50, -15, 16, 1.2, 2.5),
    overhead(0, 48, -55, 12, 1.2, 2.5),
    overhead(0, 50, -91, 16, 1.5, 3),
    overhead(-20, 45, -95, 3, 1.5, 12),
    overhead(0, 40.5, -150, 22, 1, 10),
    overhead(-6, 38, -175, 16, 1.2, 3),
    overhead(0, 41, -232, 14, 1.5, 3),
    overhead(0, 39, -264, 14, 1.5, 3),
    overhead(18, 33, -250, 3, 1.2, 14),
    overhead(0, 28, -325, 14, 1.2, 3),
    overhead(14, 27, -378, 4, 2, 4),
  ],

  checkpoints: [
    { center: [0, 31.5, -150], size: [22, 4, 20], respawn: { pos: [0, 30, -145], yaw: 0 } },
    { center: [0, 27.5, -197], size: [22, 4, 20], respawn: { pos: [0, 26, -192], yaw: 0 } },
    { center: [0, 19.5, -300], size: [22, 4, 20], respawn: { pos: [0, 18, -295], yaw: 0 } },
    { center: [0, 11.5, -355], size: [24, 4, 30], respawn: { pos: [0, 10, -346], yaw: 0 } },
  ],

  finish: { center: [50, 12.5, -386], size: [2, 5, 10] },
};
