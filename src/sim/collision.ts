import { Euler, Quaternion, Vector3 } from 'three';

/** What a surface is for, so the renderer can colour safe ground, ramps and walls apart. */
export enum SurfaceKind {
  Platform = 'platform',
  Ramp = 'ramp',
  Wall = 'wall',
  Accent = 'accent',
}

/** A solid oriented box: every piece of course geometry is one of these. */
export interface Box {
  center: Vector3;
  /** Half the size along each local axis. */
  half: Vector3;
  rot: Quaternion;
  invRot: Quaternion;
  /** Radius of a sphere around the box, for cheap rejection. */
  bound: number;
  kind: SurfaceKind;
}

export interface BoxSpec {
  center: [number, number, number];
  size: [number, number, number];
  /** Degrees: yaw about Y, pitch about X, roll about Z, applied yaw first. */
  rotation?: [number, number, number];
  kind?: SurfaceKind;
}

const DEG = Math.PI / 180;

export function makeBox(spec: BoxSpec): Box {
  const [yaw, pitch, roll] = spec.rotation ?? [0, 0, 0];
  const rot = new Quaternion().setFromEuler(new Euler(pitch * DEG, yaw * DEG, roll * DEG, 'YXZ'));
  const half = new Vector3(spec.size[0] / 2, spec.size[1] / 2, spec.size[2] / 2);
  return {
    center: new Vector3(...spec.center),
    half,
    rot,
    invRot: rot.clone().invert(),
    bound: half.length(),
    kind: spec.kind ?? SurfaceKind.Platform,
  };
}

export interface Contact {
  /** World-space direction to push the capsule out along. */
  normal: Vector3;
  depth: number;
  /** True when touching a flat face, false on an edge or corner (where the normal is rounded). */
  onFace: boolean;
  /** World-space point on the box nearest the capsule. */
  point: Vector3;
}

const la = new Vector3();
const lb = new Vector3();
const seg = new Vector3();
const p = new Vector3();
const q = new Vector3();
const d = new Vector3();

function clampToBox(v: Vector3, half: Vector3, out: Vector3): Vector3 {
  return out.set(
    Math.min(half.x, Math.max(-half.x, v.x)),
    Math.min(half.y, Math.max(-half.y, v.y)),
    Math.min(half.z, Math.max(-half.z, v.z)),
  );
}

/**
 * Penetration of a capsule (segment a→b, radius r) into a box, or null if they don't touch.
 * Finds the closest segment point to the box by alternating projection, which converges
 * quickly for a segment against a convex box.
 */
export function capsuleBoxContact(a: Vector3, b: Vector3, r: number, box: Box, out: Contact): Contact | null {
  // Cheap reject: the segment's midpoint sphere against the box's bounding sphere.
  const reach = box.bound + r + a.distanceTo(b) / 2;
  if (p.addVectors(a, b).multiplyScalar(0.5).distanceToSquared(box.center) > reach * reach) return null;

  la.subVectors(a, box.center).applyQuaternion(box.invRot);
  lb.subVectors(b, box.center).applyQuaternion(box.invRot);
  seg.subVectors(lb, la);
  const segLenSq = seg.lengthSq();

  let t = 0.5;
  for (let i = 0; i < 6; i++) {
    p.copy(la).addScaledVector(seg, t);
    clampToBox(p, box.half, q);
    const next = segLenSq > 1e-12 ? Math.min(1, Math.max(0, d.subVectors(q, la).dot(seg) / segLenSq)) : 0;
    if (Math.abs(next - t) < 1e-5) break;
    t = next;
  }
  p.copy(la).addScaledVector(seg, t);
  clampToBox(p, box.half, q);
  d.subVectors(p, q);
  const distSq = d.lengthSq();
  if (distSq >= r * r) return null;

  const dist = Math.sqrt(distSq);
  if (dist > 1e-6) {
    out.normal.copy(d).divideScalar(dist);
    out.depth = r - dist;
    const clamped = +(Math.abs(p.x) > box.half.x) + +(Math.abs(p.y) > box.half.y) + +(Math.abs(p.z) > box.half.z);
    out.onFace = clamped <= 1;
  } else {
    out.onFace = true;
    // The segment point is inside the box: push out through the nearest face.
    const ex = box.half.x - Math.abs(p.x);
    const ey = box.half.y - Math.abs(p.y);
    const ez = box.half.z - Math.abs(p.z);
    if (ey <= ex && ey <= ez) out.normal.set(0, Math.sign(p.y) || 1, 0), (out.depth = ey + r);
    else if (ex <= ez) out.normal.set(Math.sign(p.x) || 1, 0, 0), (out.depth = ex + r);
    else out.normal.set(0, 0, Math.sign(p.z) || 1), (out.depth = ez + r);
  }
  out.normal.applyQuaternion(box.rot);
  out.point.copy(q).applyQuaternion(box.rot).add(box.center);
  return out;
}

export interface RayHit {
  distance: number;
  point: Vector3;
  normal: Vector3;
  box: Box;
}

const ro = new Vector3();
const rd = new Vector3();

/** Distance along a ray to a box (slab test in box space), or null. Also fills the local hit normal. */
function rayBox(origin: Vector3, dir: Vector3, box: Box, maxDist: number, normalOut: Vector3): number | null {
  ro.subVectors(origin, box.center).applyQuaternion(box.invRot);
  rd.copy(dir).applyQuaternion(box.invRot);
  let tMin = 0;
  let tMax = maxDist;
  let axis = -1;
  let sign = 0;
  for (let i = 0; i < 3; i++) {
    const o = ro.getComponent(i);
    const v = rd.getComponent(i);
    const h = box.half.getComponent(i);
    if (Math.abs(v) < 1e-9) {
      if (o < -h || o > h) return null;
      continue;
    }
    let t1 = (-h - o) / v;
    let t2 = (h - o) / v;
    let s = -1;
    if (t1 > t2) [t1, t2, s] = [t2, t1, 1];
    if (t1 > tMin) {
      tMin = t1;
      axis = i;
      sign = s;
    }
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  // Starting inside the box isn't a hit: the camera and aim rays begin inside the player.
  if (axis < 0) return null;
  normalOut.set(0, 0, 0).setComponent(axis, sign).applyQuaternion(box.rot);
  return tMin;
}

const hitNormal = new Vector3();

/** Nearest box hit along a ray (dir must be normalized). */
export function raycast(boxes: readonly Box[], origin: Vector3, dir: Vector3, maxDist: number): RayHit | null {
  let best: RayHit | null = null;
  for (const box of boxes) {
    const t = rayBox(origin, dir, box, best ? best.distance : maxDist, hitNormal);
    if (t === null) continue;
    best = {
      distance: t,
      point: origin.clone().addScaledVector(dir, t),
      normal: hitNormal.clone(),
      box,
    };
  }
  return best;
}
