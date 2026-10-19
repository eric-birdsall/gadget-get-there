import {
  BoxGeometry,
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
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from 'three';
import type { CheckpointDefinition, TriggerVolume } from '../course/types';
import type { Pad } from '../gadgets/launchPad';
import { PlayerModel } from './playerModel';

const follow = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
const UP = new Vector3(0, 1, 0);

export const MARKER_COLORS = {
  anchor: '#ffd54a',
  anchorTarget: '#ffffff',
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

/** Glowing grapple anchors. The one under the crosshair grows and turns white. */
export class AnchorViews {
  readonly group = new Group();
  private readonly cores: Mesh[] = [];
  private readonly rings: Mesh[] = [];
  private time = 0;

  constructor(anchors: readonly Vector3[]) {
    for (const a of anchors) {
      const core = new Mesh(
        new SphereGeometry(0.85, 16, 12),
        new MeshStandardMaterial({ color: MARKER_COLORS.anchor, emissive: MARKER_COLORS.anchor, emissiveIntensity: 0.9 }),
      );
      core.position.copy(a);
      const ring = new Mesh(
        new TorusGeometry(1.6, 0.1, 8, 32),
        new MeshBasicMaterial({ color: MARKER_COLORS.anchor, transparent: true, opacity: 0.8 }),
      );
      ring.position.copy(a);
      this.cores.push(core);
      this.rings.push(ring);
      this.group.add(core, ring);
    }
  }

  /** `visible` hides them for gadgets that can't use them; `target` is the aimed anchor or -1. */
  update(dt: number, cameraPos: Vector3, visible: boolean, target: number): void {
    this.time += dt;
    this.cores.forEach((core, i) => {
      core.visible = this.rings[i].visible = true;
      const aimed = visible && i === target;
      const mat = core.material as MeshStandardMaterial;
      mat.emissiveIntensity = visible ? 0.9 : 0.25;
      mat.color.set(aimed ? MARKER_COLORS.anchorTarget : MARKER_COLORS.anchor);
      const ring = this.rings[i];
      ring.lookAt(cameraPos);
      const pulse = aimed ? 1.35 : 1 + 0.06 * Math.sin(this.time * 3 + i);
      ring.scale.setScalar(pulse);
      ring.visible = visible;
      (ring.material as MeshBasicMaterial).color.set(aimed ? MARKER_COLORS.anchorTarget : MARKER_COLORS.anchor);
    });
  }
}

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

  constructor() {
    this.group.add(this.model.root, this.rope.mesh);
    this.group.visible = false;
  }

  /** `pose` null hides the ghost. */
  update(dt: number, pose: { pos: Vector3; yaw: number; anchor: number } | null, anchors: readonly Vector3[], handHeight: number): void {
    this.fade += ((pose ? 1 : 0) - this.fade) * follow(8, dt);
    this.group.visible = this.fade > 0.02;
    if (!pose) return;
    this.model.place(pose.pos, pose.yaw);
    this.hand.set(pose.pos.x, pose.pos.y + handHeight, pose.pos.z);
    this.rope.set(pose.anchor >= 0 ? this.hand : null, pose.anchor >= 0 ? anchors[pose.anchor] ?? null : null);
  }
}
