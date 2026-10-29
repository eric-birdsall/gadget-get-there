import { Color, MeshStandardMaterial } from 'three';
import type { SurfaceKind } from '../sim/collision';
import { NOISE_GLSL } from './space';
import { THEMES, type ThemeLook } from './theme';

/** Walkable tops in the base colour, sides darker, so ledges read at speed (the space look). */
export const SURFACE_COLORS = THEMES.space.surfaces;

/** Brick courses on upright faces: each brick's length and height, and the mortar's half-width, m. */
const BRICK = { length: 0.9, height: 0.3, mortar: 0.025 };

/**
 * A standard material with a world-space grid drawn on it. The grid gives a constant sense of
 * scale and speed without textures, and lines up across neighbouring pieces. `brick` lays brick
 * courses on the upright faces instead (tops keep the grid), each brick a slightly different shade.
 */
export function gridMaterial(
  kind: SurfaceKind,
  look: ThemeLook = THEMES.space,
  colors: { base: string; line: string } = look.surfaces[kind],
  brick = false,
): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ color: colors.base, roughness: 0.85, metalness: 0 });
  const lineColor = new Color(colors.line);
  if (brick) mat.defines = { BRICK: '' };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLineColor = { value: lineColor };
    shader.uniforms.uLineGlow = { value: look.lineGlow };
    shader.uniforms.uGrime = { value: look.grime };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGridPos;\nvarying vec3 vGridNormal;')
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvGridPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvGridNormal = normalize(mat3(modelMatrix) * objectNormal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vGridPos;
varying vec3 vGridNormal;
uniform vec3 uLineColor;
uniform float uLineGlow;
uniform float uGrime;
${NOISE_GLSL}
float gridLine(vec2 p, float size, float width) {
  vec2 g = abs(fract(p / size - 0.5) - 0.5) * size;
  vec2 fw = fwidth(p) * 0.75 + 1e-4;
  vec2 l = 1.0 - smoothstep(vec2(width) - fw, vec2(width) + fw, g);
  return max(l.x, l.y);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec3 an = abs(vGridNormal);
vec2 gp = an.y > max(an.x, an.z) ? vGridPos.xz : (an.x > an.z ? vGridPos.zy : vGridPos.xy);
float major = gridLine(gp, 4.0, 0.05);
float minor = gridLine(gp, 1.0, 0.02) * 0.45;
float lineAmount = max(major, minor);
#ifdef BRICK
if (an.y < max(an.x, an.z)) {
  vec2 size = vec2(${BRICK.length}, ${BRICK.height});
  vec2 b = gp / size;
  // Every other course shifted by half a brick.
  b.x += mod(floor(b.y), 2.0) * 0.5;
  vec2 edge = min(fract(b), 1.0 - fract(b)) * size;
  vec2 bw = fwidth(gp) * 0.75 + 1e-4;
  vec2 m = 1.0 - smoothstep(vec2(${BRICK.mortar}) - bw, vec2(${BRICK.mortar}) + bw, edge);
  lineAmount = max(m.x, m.y);
  major = 0.0;
  minor = 0.0;
  diffuseColor.rgb *= 0.82 + 0.3 * hash(vec3(floor(b), 0.0));
}
#endif
diffuseColor.rgb = mix(diffuseColor.rgb, uLineColor, lineAmount * 0.8);
// Weathering: broad soft blotches and a finer mottle, darkening more than lightening.
float grime = noise(vGridPos * 0.18) * 0.7 + noise(vGridPos * 1.3) * 0.3;
diffuseColor.rgb *= 1.0 - uGrime * (grime - 0.35);
// Sides and undersides darker than walkable tops.
diffuseColor.rgb *= mix(0.68, 1.0, smoothstep(0.3, 0.8, vGridNormal.y));`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
// Neon: the grid lines glow on their own (none in space, where the sun lights them).
totalEmissiveRadiance += uLineColor * (major + minor * 0.25) * uLineGlow;`,
      );
  };
  return mat;
}
