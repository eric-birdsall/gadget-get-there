import { Color, MeshStandardMaterial } from 'three';
import { SurfaceKind } from '../sim/collision';

/** Walkable tops in the base colour, sides darker, so ledges read at speed. */
export const SURFACE_COLORS: Record<SurfaceKind, { base: string; line: string }> = {
  [SurfaceKind.Platform]: { base: '#eef1f7', line: '#aab8d4' },
  [SurfaceKind.Ramp]: { base: '#7fe0cc', line: '#3fae98' },
  [SurfaceKind.Wall]: { base: '#a596ff', line: '#7a68e8' },
  [SurfaceKind.Accent]: { base: '#ffbd70', line: '#e58a2e' },
};

/**
 * A standard material with a world-space grid drawn on it. The grid gives a constant sense of
 * scale and speed without textures, and lines up across neighbouring pieces.
 */
export function gridMaterial(kind: SurfaceKind): MeshStandardMaterial {
  const colors = SURFACE_COLORS[kind];
  const mat = new MeshStandardMaterial({ color: colors.base, roughness: 0.85, metalness: 0 });
  const lineColor = new Color(colors.line);
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLineColor = { value: lineColor };
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
diffuseColor.rgb = mix(diffuseColor.rgb, uLineColor, max(major, minor) * 0.8);
// Sides and undersides darker than walkable tops.
diffuseColor.rgb *= mix(0.68, 1.0, smoothstep(0.3, 0.8, vGridNormal.y));`,
      );
  };
  return mat;
}
