import {
  BoxGeometry,
  CircleGeometry,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NearestFilter,
  PlaneGeometry,
  RingGeometry,
  Vector3,
} from 'three';
import type { CheckpointDefinition, TriggerVolume } from '../course/types';
import type { Pad } from '../gadgets/launchPad';
import { PlayerModel } from './playerModel';

const follow = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const UP = new Vector3(0, 1, 0);

export const MARKER_COLORS = {
  grappleTarget: '#7ff6ff',
  checkpointIdle: '#ffffff',
  checkpointReached: '#5dff9d',
  pad: '#ff8a3d',
  padPreview: '#ffffff',
  padInvalid: '#ff4d6d',
  rope: '#fff3c4',
  ghostRope: '#bdf3ff',
};

/** A post with a flag beside each checkpoint's respawn point; the flag lights up once reached. */
export class CheckpointFlags {
  readonly group = new Group();
  private readonly flags: MeshStandardMaterial[] = [];

  constructor(checkpoints: readonly CheckpointDefinition[]) {
    const pole = new MeshStandardMaterial({ color: '#2b2f45', roughness: 0.6 });
    for (const cp of checkpoints) {
      const [x, y, z] = cp.respawn.pos;
      const post = new Mesh(new CylinderGeometry(0.08, 0.08, 4, 8), pole);
      // Off to one side of the respawn spot, so it never blocks the camera after a respawn.
      const side = cp.size[0] / 2 - 1;
      post.position.set(x - side, y + 2, z);
      post.castShadow = true;
      const mat = new MeshStandardMaterial({ color: MARKER_COLORS.checkpointIdle, side: DoubleSide, emissive: '#000000' });
      const flag = new Mesh(new PlaneGeometry(1.4, 0.9), mat);
      flag.position.set(x - side + 0.75, y + 3.5, z);
      this.flags.push(mat);
      this.group.add(post, flag);
    }
  }

  /** Lights every flag up to and including `reached` (-1 for none). */
  setReached(reached: number): void {
    this.flags.forEach((m, i) => {
      const on = i <= reached;
      m.color.set(on ? MARKER_COLORS.checkpointReached : MARKER_COLORS.checkpointIdle);
      m.emissive.set(on ? '#1d8f4e' : '#000000');
    });
  }
}

function checkerTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 2;
  const g = c.getContext('2d')!;
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 2; y++) {
      g.fillStyle = (x + y) % 2 ? '#1c1f3a' : '#ffffff';
      g.fillRect(x, y, 1, 1);
    }
  }
  const t = new CanvasTexture(c);
  t.magFilter = NearestFilter;
  return t;
}

/** A chequered arch over the finish trigger. */
export function finishGate(finish: TriggerVolume): Group {
  const g = new Group();
  const [cx, cy, cz] = finish.center;
  const [sx, sy, sz] = finish.size;
  const base = cy - sy / 2;
  const height = sy + 1.5;
  // The gate spans the trigger's wider horizontal side.
  const alongZ = sz >= sx;
  const span = alongZ ? sz : sx;
  const pillarMat = new MeshStandardMaterial({ color: '#ff5d8f', roughness: 0.5 });
  for (const s of [-1, 1]) {
    const pillar = new Mesh(new BoxGeometry(0.6, height, 0.6), pillarMat);
    pillar.position.set(cx + (alongZ ? 0 : (s * span) / 2), base + height / 2, cz + (alongZ ? (s * span) / 2 : 0));
    pillar.castShadow = true;
    g.add(pillar);
  }
  const banner = new Mesh(
    new BoxGeometry(alongZ ? 0.4 : span + 0.6, 1, alongZ ? span + 0.6 : 0.4),
    new MeshStandardMaterial({ map: checkerTexture(), roughness: 0.6 }),
  );
  banner.position.set(cx, base + height - 0.5, cz);
  banner.castShadow = true;
  g.add(banner);
  return g;
}

/** A glowing ring on the surface the grapple would hook, shown while it's in hand and in range. */
export class GrappleMarker {
  readonly group = new Group();
  private readonly ring: Mesh;
  private readonly dot: Mesh;
  private time = 0;

  constructor() {
    const mat = new MeshBasicMaterial({ color: MARKER_COLORS.grappleTarget, transparent: true, opacity: 0.9, side: DoubleSide, depthWrite: false });
    this.ring = new Mesh(new RingGeometry(0.45, 0.6, 32), mat);
    this.dot = new Mesh(new CircleGeometry(0.12, 16), mat);
    this.group.add(this.ring, this.dot);
    this.group.visible = false;
  }

  update(dt: number, target: { point: Vector3; normal: Vector3 } | null): void {
    this.time += dt;
    this.group.visible = !!target;
    if (!target) return;
    this.group.position.copy(target.point).addScaledVector(target.normal, 0.03);
    this.group.quaternion.setFromUnitVectors(Z, target.normal);
    this.ring.scale.setScalar(1 + 0.12 * Math.sin(this.time * 8));
  }
}
const Z = new Vector3(0, 0, 1);

/** A rope drawn as a thin cylinder between two points. */
export class RopeView {
  readonly mesh: Mesh;
  private readonly dir = new Vector3();

  constructor(color: string, opacity = 1) {
    this.mesh = new Mesh(
      new CylinderGeometry(0.035, 0.035, 1, 6, 1),
      new MeshBasicMaterial({ color, transparent: opacity < 1, opacity }),
    );
    this.mesh.visible = false;
  }

  set(from: Vector3 | null, to: Vector3 | null): void {
    if (!from || !to) {
      this.mesh.visible = false;
      return;
    }
    this.dir.subVectors(to, from);
    const len = this.dir.length();
    this.mesh.visible = len > 0.01;
    this.mesh.position.copy(from).addScaledVector(this.dir, 0.5);
    this.mesh.scale.set(1, len, 1);
    this.mesh.quaternion.setFromUnitVectors(UP, this.dir.divideScalar(len || 1));
  }
}

/** The thrown launch pad (with an arrow along its heading), and the aim preview disc. */
export class PadViews {
  readonly group = new Group();
  private readonly pad = new Group();
  private readonly preview: Mesh;
  private readonly previewMat: MeshBasicMaterial;
  private pop = 0;
  private lastPad: Pad | null = null;

  constructor() {
    const disc = new Mesh(
      new CylinderGeometry(1.2, 1.35, 0.25, 24),
      new MeshStandardMaterial({ color: MARKER_COLORS.pad, emissive: MARKER_COLORS.pad, emissiveIntensity: 0.35 }),
    );
    disc.position.y = 0.12;
    disc.castShadow = true;
    const arrow = new Mesh(new ConeGeometry(0.45, 1, 3), new MeshBasicMaterial({ color: '#ffffff' }));
    arrow.rotation.x = -Math.PI / 2;
    arrow.position.set(0, 0.3, -0.25);
    arrow.scale.set(1, 1, 0.3);
    this.pad.add(disc, arrow);
    this.pad.visible = false;

    this.previewMat = new MeshBasicMaterial({ color: MARKER_COLORS.padPreview, transparent: true, opacity: 0.5, side: DoubleSide, depthWrite: false });
    this.preview = new Mesh(new RingGeometry(0.9, 1.3, 32), this.previewMat);
    this.preview.visible = false;
    this.group.add(this.pad, this.preview);
  }

  update(dt: number, pad: Pad | null, preview: { pos: Vector3; normal: Vector3 } | null, previewValid: boolean, showPreview: boolean): void {
    if (pad !== this.lastPad) {
      this.lastPad = pad;
      this.pop = pad ? 1 : 0;
    }
    this.pad.visible = !!pad;
    if (pad) {
      this.pad.position.copy(pad.pos);
      this.pad.quaternion.setFromUnitVectors(UP, pad.normal);
      // Turn the arrow to the pad's heading, in the pad's own plane.
      this.pad.rotateY(Math.atan2(-pad.heading.x, -pad.heading.z));
      this.pop = Math.max(0, this.pop - dt * 4);
      const s = 1 + 0.4 * this.pop * this.pop + (pad.rearm > 0 ? 0.15 : 0);
      this.pad.scale.set(s, 1, s);
    }
    this.preview.visible = showPreview && !!preview;
    if (preview && showPreview) {
      this.preview.position.copy(preview.pos).addScaledVector(preview.normal, 0.05);
      this.preview.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), preview.normal);
      this.previewMat.color.set(previewValid ? MARKER_COLORS.padPreview : MARKER_COLORS.padInvalid);
    }
  }
}

/** The personal-best ghost: a translucent copy of the player, with its rope when it swung. */
export class GhostView {
  readonly group = new Group();
  readonly model = new PlayerModel(true);
  readonly rope = new RopeView(MARKER_COLORS.ghostRope, 0.5);
  private readonly hand = new Vector3();
  private fade = 0;
  /** Where it was last frame, for working out its velocity (the recording has none). */
  private readonly prev = new Vector3();
  private readonly vel = new Vector3();
  private placed = false;

  constructor() {
    this.group.add(this.model.root, this.rope.mesh);
    this.group.visible = false;
  }

  /** `pose` null hides the ghost. */
  update(dt: number, pose: { pos: Vector3; yaw: number; rope: Vector3 | null } | null, handHeight: number): void {
    this.fade += ((pose ? 1 : 0) - this.fade) * follow(8, dt);
    this.group.visible = this.fade > 0.02;
    if (!pose) {
      this.placed = false;
      return;
    }
    this.animate(dt, pose.pos, pose.yaw);
    this.hand.set(pose.pos.x, pose.pos.y + handHeight, pose.pos.z);
    this.rope.set(pose.rope ? this.hand : null, pose.rope);
  }

  /**
   * Runs the same animation as the player from the ghost's own movement. It counts as on the
   * ground unless it's climbing or falling fast; a big jump in one frame (a respawn, the run
   * starting over) snaps it there instead.
   */
  private animate(dt: number, pos: Vector3, yaw: number): void {
    if (!this.placed || pos.distanceTo(this.prev) > GHOST_SNAP_DISTANCE) {
      this.model.place(pos, yaw);
      this.model.face(yaw);
      this.prev.copy(pos);
      this.placed = true;
      return;
    }
    if (dt > 0) this.vel.subVectors(pos, this.prev).divideScalar(dt);
    this.prev.copy(pos);
    this.model.update(dt, { feet: pos, vel: this.vel, grounded: Math.abs(this.vel.y) < GHOST_GROUNDED_VY }, 0, false);
  }
}

/** Moving farther than this in one frame is a teleport, not motion, m. */
const GHOST_SNAP_DISTANCE = 5;
/** Slower than this up or down, the ghost counts as on the ground, m/s. */
const GHOST_GROUNDED_VY = 3;
