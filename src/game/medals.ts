import type { MedalThresholds } from '../course/types';

export enum Medal {
  Gold = 'gold',
  Silver = 'silver',
  Bronze = 'bronze',
  /** Finished, slower than bronze. */
  None = 'none',
}

/** Inclusive: a time exactly on a threshold earns that medal. */
export function medalFor(seconds: number, t: MedalThresholds): Medal {
  if (seconds <= t.goldSeconds) return Medal.Gold;
  if (seconds <= t.silverSeconds) return Medal.Silver;
  if (seconds <= t.bronzeSeconds) return Medal.Bronze;
  return Medal.None;
}
