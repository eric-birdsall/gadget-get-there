import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { CAMERA_CONFIG } from '../config';
import { type Box, raycast } from '../sim/collision';

const smoothstep = (t: number) => t * t * (3 - 2 * t);
/** Frame-rate independent exponential approach factor. */
const follow = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

/** Orbit camera behind and above the player, pulled in when geometry is in the way. */
export class ThirdPersonCamera {
  readonly camera = new PerspectiveCamera(CAMERA_CONFIG.fieldOfView, 1, 0.1, 2000);
  /** Base FOV from settings; the high-speed FOV keeps the same widening on top. */
  baseFov: number = CAMERA_CONFIG.fieldOfView;
  /** Lowers the orbit pivot, e.g. while sliding, m. */
  pivotDrop = 0;
  /** Extra field of view, degrees (sprinting widens the view); eased by the caller. */
  fovBoost = 0;
  private readonly pivot = new Vector3();
  private distance: number = CAMERA_CONFIG.distance;
  private fov: number = CAMERA_CONFIG.fieldOfView;
  private readonly back = new Vector3();
  private readonly target = new Vector3();
  private readonly lookAt = new Vector3();

  /** Jumps straight to the player, for spawns. */
  snap(feet: Vector3): void {
    this.pivot.set(feet.x, feet.y + CAMERA_CONFIG.height, feet.z);
    this.distance = CAMERA_CONFIG.distance;
  }

  update(dt: number, feet: Vector3, speed: number, yaw: number, pitch: number, boxes: readonly Box[]): void {
    const c = CAMERA_CONFIG;
    this.target.set(feet.x, feet.y + c.height - this.pivotDrop, feet.z);
    const k = follow(c.smoothing, dt);
    const kv = follow(c.verticalSmoothing, dt);
    this.pivot.x += (this.target.x - this.pivot.x) * k;
    this.pivot.z += (this.target.z - this.pivot.z) * k;
    this.pivot.y += (this.target.y - this.pivot.y) * kv;

    const [s0, s1] = c.speedForFovTransition;
    const t = smoothstep(MathUtils.clamp((speed - s0) / (s1 - s0), 0, 1));
    const wanted = c.distance + c.highSpeedExtraDistance * t;
    const fovWanted = this.baseFov + (c.highSpeedFieldOfView - c.fieldOfView) * t + this.fovBoost;
    this.fov += (fovWanted - this.fov) * follow(4, dt);

    this.back.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    // Pull in instantly when something blocks the view; ease back out once it clears.
    const hit = raycast(boxes, this.pivot, this.back, wanted + c.collisionAvoidanceDistance);
    const allowed = hit ? Math.max(0.6, hit.distance - c.collisionAvoidanceDistance) : wanted;
    this.distance = allowed < this.distance ? allowed : this.distance + (allowed - this.distance) * follow(5, dt);

    this.camera.position.copy(this.pivot).addScaledVector(this.back, this.distance);
    this.lookAt.copy(this.pivot);
    this.lookAt.y += 0.35;
    this.camera.lookAt(this.lookAt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
