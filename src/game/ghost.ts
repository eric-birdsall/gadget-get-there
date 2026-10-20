import { Vector3 } from 'three';
import { GHOST_CONFIG } from '../config';

/** v2 records where the rope is fixed (any surface) instead of an anchor number. */
export const GHOST_VERSION = 2;
/** Numbers per sample: time, x, y, z, facing yaw, on a rope (0/1), rope x, y, z. */
export const GHOST_STRIDE = 9;

export interface GhostData {
  version: number;
  samples: number[];
}

export interface GhostPose {
  pos: Vector3;
  yaw: number;
  /** Where the ghost's rope is fixed while it swings, or null. */
  rope: Vector3 | null;
}

/** Records the player's path against run time, at a fixed rate, for a PB ghost. */
export class GhostRecorder {
  private samples: number[] = [];
  private next = 0;

  reset(): void {
    this.samples = [];
    this.next = 0;
  }

  /** Records a sample if one is due at `time` (or `force` it, e.g. the final frame). */
  sample(time: number, pos: Vector3, yaw: number, rope: Vector3 | null, force = false): void {
    if (!force && time < this.next) return;
    if (time > GHOST_CONFIG.maxSeconds) return;
    // Millimetres and milliseconds are plenty, and keep saves small.
    const r = (n: number) => Math.round(n * 1000) / 1000;
    this.samples.push(r(time), r(pos.x), r(pos.y), r(pos.z), r(yaw), rope ? 1 : 0, r(rope?.x ?? 0), r(rope?.y ?? 0), r(rope?.z ?? 0));
    this.next = time + 1 / GHOST_CONFIG.sampleRate;
  }

  finish(): GhostData {
    return { version: GHOST_VERSION, samples: this.samples.slice() };
  }
}

/** Checks a saved ghost's shape; anything off means no ghost rather than a broken one. */
export function isValidGhost(g: unknown): g is GhostData {
  if (!g || typeof g !== 'object') return false;
  const { version, samples } = g as GhostData;
  return (
    version === GHOST_VERSION &&
    Array.isArray(samples) &&
    samples.length >= GHOST_STRIDE &&
    samples.length % GHOST_STRIDE === 0 &&
    samples.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

const shortestAngle = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** Plays a ghost back by interpolating its recorded samples at a given run time. */
export class GhostPlayer {
  private cursor = 0;

  constructor(readonly data: GhostData) {}

  get duration(): number {
    const s = this.data.samples;
    return s[s.length - GHOST_STRIDE];
  }

  /** The pose at run time `t`, clamped to the recording. Works for any order of times. */
  poseAt(t: number, out: GhostPose): GhostPose {
    const s = this.data.samples;
    const count = s.length / GHOST_STRIDE;
    if (this.cursor >= count - 1 || s[this.cursor * GHOST_STRIDE] > t) this.cursor = 0;
    while (this.cursor < count - 1 && s[(this.cursor + 1) * GHOST_STRIDE] <= t) this.cursor++;
    const i = this.cursor * GHOST_STRIDE;
    if (this.cursor >= count - 1 || t <= s[i]) {
      out.pos.set(s[i + 1], s[i + 2], s[i + 3]);
      out.yaw = s[i + 4];
      this.rope(s, i, out);
      return out;
    }
    const j = i + GHOST_STRIDE;
    const jump = Math.hypot(s[j + 1] - s[i + 1], s[j + 2] - s[i + 2], s[j + 3] - s[i + 3]);
    // A respawn between samples: hold the old spot, then appear at the new one.
    const k = jump > GHOST_CONFIG.teleportDistance ? 0 : (t - s[i]) / (s[j] - s[i]);
    out.pos.set(s[i + 1] + (s[j + 1] - s[i + 1]) * k, s[i + 2] + (s[j + 2] - s[i + 2]) * k, s[i + 3] + (s[j + 3] - s[i + 3]) * k);
    out.yaw = s[i + 4] + shortestAngle(s[i + 4], s[j + 4]) * k;
    this.rope(s, k < 0.5 ? i : j, out);
    return out;
  }

  private rope(s: number[], i: number, out: GhostPose): void {
    if (s[i + 5] === 0) {
      out.rope = null;
      return;
    }
    out.rope = (out.rope ?? new Vector3()).set(s[i + 6], s[i + 7], s[i + 8]);
  }
}
