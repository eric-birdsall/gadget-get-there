import { AdditiveBlending, DoubleSide, Mesh, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';

// The kill boundary: a red hazard grid at the height where a fall ends the attempt, so players
// can see how far they can dip. Faint from high up, brighter as you near it; it follows the
// player across the course and fades out toward its edges.

const SIZE = 700;

export class KillBoundary {
  readonly mesh: Mesh;
  private readonly material: ShaderMaterial;

  constructor() {
    this.material = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      fog: false,
      uniforms: { uPlayer: { value: new Vector3() }, uTime: { value: 0 } },
      vertexShader: `varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`,
      fragmentShader: `varying vec3 vWorld;
uniform vec3 uPlayer;
uniform float uTime;
void main() {
  vec2 g = abs(fract(vWorld.xz / 6.0 + 0.5) - 0.5) * 6.0;
  vec2 fw = fwidth(vWorld.xz) * 1.2 + 1e-4;
  vec2 l = 1.0 - smoothstep(0.06 - fw, 0.06 + fw, g);
  float line = max(l.x, l.y);
  // Hazard stripes along the lines, slowly sliding.
  float stripe = step(0.5, fract((vWorld.x + vWorld.z) / 3.0 - uTime * 0.25));
  float height = uPlayer.y - vWorld.y;
  float near = 0.18 + 0.75 * (1.0 - smoothstep(4.0, 45.0, height));
  float edge = 1.0 - smoothstep(180.0, ${(SIZE / 2).toFixed(1)}, length(vWorld.xz - uPlayer.xz));
  float pulse = 0.85 + 0.15 * sin(uTime * 3.0);
  float a = (line * (0.7 + 0.3 * stripe) + 0.05) * near * edge * pulse;
  gl_FragColor = vec4(vec3(1.0, 0.23, 0.36) * a, a);
}`,
    });
    this.mesh = new Mesh(new PlaneGeometry(SIZE, SIZE), this.material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /** Puts the boundary at `y` (the course's kill height). */
  setHeight(y: number): void {
    this.mesh.position.y = y;
  }

  /** Follows the player; call once per frame. */
  update(dt: number, player: Vector3): void {
    this.mesh.position.x = player.x;
    this.mesh.position.z = player.z;
    const u = this.material.uniforms;
    u.uPlayer.value.copy(player);
    u.uTime.value += dt;
  }
}
