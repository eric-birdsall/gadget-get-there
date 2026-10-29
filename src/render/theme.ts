import { SurfaceKind } from '../sim/collision';

// The look of the world: deep space, or a city at night. Same courses, same physics; only the
// colours, the light and the backdrop change.

export type Theme = 'space' | 'city';

export interface ThemeLook {
  /**
   * Each surface kind's base colour, its grid-line colour, and its outline colour (the line
   * colour times `edgeBrightness` when not given).
   */
  surfaces: Record<SurfaceKind, { base: string; line: string; edge?: string }>;
  /** How much the grid lines glow on their own (0 = lit only). */
  lineGlow: number;
  /** Outline colour factor for surfaces with no edge colour of their own. */
  edgeBrightness: number;
  /** How much weathering shows as soft blotches across surfaces (0 = clean). */
  grime: number;
  background: string;
  fog: { color: string; near: number; far: number };
  fill: { sky: string; ground: string; intensity: number };
  sun: { color: string; intensity: number };
}

export const THEMES: Record<Theme, ThemeLook> = {
  space: {
    surfaces: {
      [SurfaceKind.Platform]: { base: '#eef1f7', line: '#aab8d4' },
      [SurfaceKind.Ramp]: { base: '#7fe0cc', line: '#3fae98' },
      [SurfaceKind.Wall]: { base: '#a596ff', line: '#7a68e8' },
      [SurfaceKind.Accent]: { base: '#ffbd70', line: '#e58a2e' },
      [SurfaceKind.Overhead]: { base: '#ffd86b', line: '#d9a520' },
    },
    lineGlow: 0,
    edgeBrightness: 0.7,
    grime: 0,
    background: '#070918',
    fog: { color: '#070918', near: 220, far: 900 },
    fill: { sky: '#a9b8ff', ground: '#2a2050', intensity: 1.25 },
    sun: { color: '#fff6e8', intensity: 3.0 },
  },
  // Night: weathered concrete roofs with paving seams and pale parapet edges, steel ramps, walls as
  // billboards or brick (see pieces.ts), brick water-tower stones, crane-yellow beams; cool
  // moonlight and purple haze. Nothing on the course glows: the neon is in the skyline.
  city: {
    surfaces: {
      [SurfaceKind.Platform]: { base: '#5a5b61', line: '#6c6d73', edge: '#a3a5ab' },
      [SurfaceKind.Ramp]: { base: '#4f5762', line: '#6a727e', edge: '#a6aebb' },
      [SurfaceKind.Wall]: { base: '#3e4352', line: '#555b6b', edge: '#8c929e' },
      [SurfaceKind.Accent]: { base: '#7a4a38', line: '#9a7a68', edge: '#c09a80' },
      [SurfaceKind.Overhead]: { base: '#d6a51c', line: '#b88c14', edge: '#f0d060' },
    },
    lineGlow: 0,
    edgeBrightness: 1,
    grime: 0.35,
    background: '#0b0820',
    fog: { color: '#160e2e', near: 90, far: 560 },
    fill: { sky: '#7d84e8', ground: '#3a1f4d', intensity: 1.1 },
    sun: { color: '#c8d6ff', intensity: 1.9 },
  },
};
