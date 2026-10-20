import { GadgetId } from '../gadgets/types';
import { SurfaceKind } from '../sim/collision';
import { overhead, ramp, runWall, slab, wall } from './build';
import type { CourseDefinition } from './types';

/** A barrier across the track at `z`: slide under the slot in the middle, or run round the open ends. */
function barrier(z: number, top: number) {
  return [
    wall(-4.75, z, 4.5, 2, top, top + 4),
    wall(4.75, z, 4.5, 2, top, top + 4),
    { center: [0, top + 2.55, z] as [number, number, number], size: [5, 2.9, 2] as [number, number, number], kind: SurfaceKind.Wall },
  ];
}

/**
 * "Gauntlet": a fast, mostly flat course from y 30 down to y 20 over about 280 m. Forward is -Z.
 * Each obstacle has a slower way round on foot and a faster way through:
 *
 * 1. Start straight with two barriers: slide under the middle, or run round the ends.
 * 2. A 14 m gap down to a lower island: stepping stones round the right; or dash, glide,
 *    launch, swing or wall-run straight across.
 * 3. The plunge: a steep downhill kicker, then a 4 m drop over a 14 m gap. A ramp down the left; or
 *    slide down the kicker and slide-jump (the burst carries you), dash, glide, launch or swing.
 * 4. The corridor: a 24 m gap between two tall walls. A narrow bridge on the right; or wall-run
 *    and kick across, or swing.
 */
export const gauntlet: CourseDefinition = {
  id: 'gauntlet',
  name: 'Gauntlet',
  environmentTheme: 'day',
  start: { pos: [0, 30, 4], yaw: 0 },
  medalThresholds: { goldSeconds: 21, silverSeconds: 26, bronzeSeconds: 36 },
  availableGadgetIds: [GadgetId.Grapple, GadgetId.Jetpack, GadgetId.LaunchPad, GadgetId.Dash, GadgetId.Wingsuit],
  referenceTargetDurationSeconds: 32,

  pieces: [
    // 1. The start straight and its barriers.
    slab(0, 30, -45, 20, 110),
    ...barrier(-55, 30),
    ...barrier(-80, 30),

    // 2. The gap, stepping stones round the right, and the island beyond.
    slab(13, 29.4, -104, 5, 5, SurfaceKind.Accent),
    slab(13, 28.7, -111, 5, 5, SurfaceKind.Accent),
    runWall(-11.5, 32, -107, 8, 22),
    slab(0, 28, -124, 32, 20),

    // 3. The plunge: a short kicker down to the edge (a slide gains speed on it), the ramp down
    // the left, and the lower track.
    ramp([0, 28, -134], [0, 24, -146], 12),
    ramp([-14, 28, -134], [-14, 20, -168], 6),
    slab(0, 20, -195, 32, 70),

    // 4. The corridor: walls either side of the gap, the bridge on the right, the finish.
    // The walls run on past the far edge, so a wall run ends over the finish platform.
    runWall(-4.5, 24, -243, 12, 24),
    runWall(4.5, 24, -243, 12, 24),
    slab(12, 20, -242, 3, 24, SurfaceKind.Accent),
    slab(0, 20, -266, 30, 24),

    // Grapple beams over each gap, and more along the way.
    overhead(0, 44, -107, 14, 1.2, 3),
    overhead(0, 36, -152, 14, 1.2, 3),
    overhead(0, 32, -242, 6, 1.2, 3),
    overhead(0, 42, -30, 14, 1.2, 2.5),
    overhead(-12, 34, -200, 3, 1.2, 14),
  ],

  checkpoints: [
    { center: [0, 29.5, -124], size: [32, 4, 20], respawn: { pos: [0, 28, -118], yaw: 0 } },
    { center: [0, 21.5, -195], size: [32, 4, 70], respawn: { pos: [0, 20, -165], yaw: 0 } },
  ],

  finish: { center: [0, 22.5, -272], size: [12, 5, 2] },
};
