import { Euler, Quaternion, Vector3 } from 'three';
import { type BoxSpec, SurfaceKind } from '../sim/collision';
import type { Vec3Tuple } from './types';

// Helpers for writing courses by their walkable surfaces rather than box centres.

const DEG = 180 / Math.PI;
const DEFAULT_THICKNESS = 1;

/** A flat slab whose top is at `top`, centred on (x, z). */
export function slab(
  x: number,
  top: number,
  z: number,
  width: number,
  depth: number,
  kind = SurfaceKind.Platform,
  thickness = DEFAULT_THICKNESS,
): BoxSpec {
  return { center: [x, top - thickness / 2, z], size: [width, thickness, depth], kind };
}

/** A straight slope whose top surface runs from `from` to `to` (centre-line points). */
export function ramp(from: Vec3Tuple, to: Vec3Tuple, width: number, kind = SurfaceKind.Ramp, thickness = DEFAULT_THICKNESS): BoxSpec {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const run = Math.hypot(dx, dz);
  const length = Math.hypot(run, dy);
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(dy, run);
  return tiltedSlab(from, to, width, length, thickness, [yaw * DEG, pitch * DEG, 0], kind);
}

function tiltedSlab(
  from: Vec3Tuple,
  to: Vec3Tuple,
  width: number,
  length: number,
  thickness: number,
  rotation: Vec3Tuple,
  kind: SurfaceKind,
): BoxSpec {
  const q = new Quaternion().setFromEuler(new Euler(rotation[1] / DEG, rotation[0] / DEG, rotation[2] / DEG, 'YXZ'));
  const up = new Vector3(0, 1, 0).applyQuaternion(q);
  const mid = new Vector3((from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2).addScaledVector(
    up,
    -thickness / 2,
  );
  return { center: [mid.x, mid.y, mid.z], size: [width, thickness, length], rotation, kind };
}

/**
 * A banked curve: `segments` slabs around (cx, cz) at `radius`, from angle `fromDeg` to `toDeg`
 * (0° is +X, 90° is -Z), with the outer edge raised by up to `bankDeg`. The bank eases in and
 * out, so both ends sit flush with flat ground.
 */
export function bankedCurve(
  cx: number,
  top: number,
  cz: number,
  radius: number,
  fromDeg: number,
  toDeg: number,
  width: number,
  bankDeg: number,
  segments: number,
): BoxSpec[] {
  const out: BoxSpec[] = [];
  const step = (toDeg - fromDeg) / segments;
  // Turning counter-clockwise seen from above puts the centre on the left.
  const side = step > 0 ? 1 : -1;
  const point = (deg: number): Vec3Tuple => {
    const r = deg / DEG;
    return [cx + Math.cos(r) * radius, top, cz - Math.sin(r) * radius];
  };
  for (let i = 0; i < segments; i++) {
    const from = point(fromDeg + step * i);
    const to = point(fromDeg + step * (i + 1));
    const dx = to[0] - from[0];
    const dz = to[2] - from[2];
    // Slightly long, so neighbouring slabs overlap and leave no seam on the outside of the turn.
    const length = Math.hypot(dx, dz) + width * Math.abs(Math.sin(step / DEG)) + 0.2;
    const yaw = Math.atan2(-dx, -dz) * DEG;
    const roll = side * bankDeg * Math.sin((Math.PI * (i + 0.5)) / segments);
    out.push(tiltedSlab(from, to, width, length, DEFAULT_THICKNESS, [yaw, 0, roll], SurfaceKind.Ramp));
  }
  return out;
}

/** An upright wall from `bottom` to `top`. */
export function wall(x: number, z: number, width: number, depth: number, bottom: number, top: number, yaw = 0): BoxSpec {
  return { center: [x, (bottom + top) / 2, z], size: [width, top - bottom, depth], rotation: [yaw, 0, 0], kind: SurfaceKind.Wall };
}

/** A floating beam or ceiling to grapple, its centre at (x, y, z). */
export function overhead(x: number, y: number, z: number, width: number, height: number, depth: number): BoxSpec {
  return { center: [x, y, z], size: [width, height, depth], kind: SurfaceKind.Overhead };
}

/** A tall, thin wall to run along, lying along Z: centre (x, y, z), `height` tall, `length` long. */
export function runWall(x: number, y: number, z: number, height: number, length: number): BoxSpec {
  return { center: [x, y, z], size: [1, height, length], kind: SurfaceKind.Wall };
}
