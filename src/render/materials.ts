import { Color, MeshStandardMaterial } from 'three';
import type { SurfaceKind } from '../sim/collision';
import { THEMES, type ThemeLook } from './theme';

/** Walkable tops in the base colour, sides darker, so ledges read at speed (the space look). */
export const SURFACE_COLORS = THEMES.space.surfaces;

/**
 * A standard material with a world-space grid drawn on it. The grid gives a constant sense of
 * scale and speed without textures, and lines up across neighbouring pieces.
 */
export function gridMaterial(kind: SurfaceKind, look: ThemeLook = THEMES.space): MeshStandardMaterial {
  const colors = look.surfaces[kind];
  const mat = new MeshStandardMaterial({ color: colors.base, roughness: 0.85, metalness: 0 });
  const lineColor = new Color(colors.line);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLineColor = { value: lineColor };
    shader.uniforms.uLineGlow = { value: look.lineGlow };
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
diffuseColor.rgb = mix(diffuseColor.rgb, uLineColor, lineAmount * 0.8);
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
