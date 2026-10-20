import type { BoxSpec } from '../sim/collision';

export type Vec3Tuple = [number, number, number];

export interface MedalThresholds {
  goldSeconds: number;
  silverSeconds: number;
  bronzeSeconds: number;
}

export interface TriggerVolume {
  /** Axis-aligned box. */
  center: Vec3Tuple;
  size: Vec3Tuple;
}

export interface CheckpointDefinition extends TriggerVolume {
  respawn: { pos: Vec3Tuple; yaw: number };
}

export interface CourseDefinition {
  id: string;
  name: string;
  environmentTheme: string;
  /** Feet position and facing (radians, 0 faces -Z) at the start of every attempt. */
  start: { pos: Vec3Tuple; yaw: number };
  pieces: BoxSpec[];
  /** In course order; reaching a later one never moves the respawn back. */
  checkpoints: CheckpointDefinition[];
  finish: TriggerVolume;
  medalThresholds: MedalThresholds;
  availableGadgetIds: string[];
  referenceTargetDurationSeconds: number;
}
