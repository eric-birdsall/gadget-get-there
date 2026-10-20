import { SurfaceKind } from '../sim/collision';

// The look of the world: deep space, or a city at night. Same courses, same physics; only the
// colours, the light and the backdrop change.

export type Theme = 'space' | 'city';

export interface ThemeLook {
  /** Each surface kind's base colour, its grid-line colour, and how much the lines glow (0 = lit only). */
  surfaces: Record<SurfaceKind, { base: string; line: string }>;
  lineGlow: number;
  /** Outline colour factor: below 1 darkens the line colour (space), 1 is full neon (city). */
  edgeBrightness: number;
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
    background: '#070918',
    fog: { color: '#070918', near: 220, far: 900 },
    fill: { sky: '#a9b8ff', ground: '#2a2050', intensity: 1.25 },
    sun: { color: '#fff6e8', intensity: 3.0 },
  },
  // Night: dark concrete roofs with cyan neon lines, teal glass ramps, dark glass walls edged in
  // magenta, warm water-tower stones, crane-yellow beams; cool moonlight and purple haze.
  city: {
    surfaces: {
      [SurfaceKind.Platform]: { base: '#3a3f52', line: '#3fe6ff' },
      [SurfaceKind.Ramp]: { base: '#2d6b78', line: '#7ff6ff' },
      [SurfaceKind.Wall]: { base: '#2a2546', line: '#ff4fd8' },
      [SurfaceKind.Accent]: { base: '#7a5532', line: '#ffb347' },
      [SurfaceKind.Overhead]: { base: '#e8b923', line: '#fff07a' },
    },
    lineGlow: 0.6,
    edgeBrightness: 1,
    background: '#0b0820',
    fog: { color: '#160e2e', near: 90, far: 560 },
    fill: { sky: '#7d84e8', ground: '#3a1f4d', intensity: 1.1 },
    sun: { color: '#c8d6ff', intensity: 1.9 },
  },
};
