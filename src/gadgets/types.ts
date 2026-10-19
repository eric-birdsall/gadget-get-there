import type { Vector3 } from 'three';
import type { Box } from '../sim/collision';
import type { MovementConfig, PlayerState } from '../sim/player';

export enum GadgetId {
  Grapple = 'grapple',
  Rollerblades = 'rollerblades',
  LaunchPad = 'launch-pad',
}

export enum GadgetEvent {
  GrappleAttached = 'grapple-attached',
  GrappleMissed = 'grapple-missed',
  GrappleReleased = 'grapple-released',
  PadPlaced = 'pad-placed',
  PadInvalid = 'pad-invalid',
  PadLaunched = 'pad-launched',
  TuckStarted = 'tuck-started',
  TuckEnded = 'tuck-ended',
}

/** The gadget button and the crosshair ray for one tick. */
export interface GadgetInput {
  held: boolean;
  pressed: boolean;
  /** Camera heading, radians; 0 faces -Z. */
  yaw: number;
  aimOrigin: Vector3;
  /** Unit vector through the crosshair. */
  aimDir: Vector3;
}

export interface GadgetContext {
  player: PlayerState;
  boxes: readonly Box[];
  anchors: readonly Vector3[];
  input: GadgetInput;
  emit: (event: GadgetEvent) => void;
}

/**
 * One gadget for one attempt. Gadgets act only through the player's movement: they may change
 * the movement config, push velocity before the move, and constrain position after it.
 */
export interface GadgetRuntime {
  readonly id: GadgetId;
  /** False in training: the gadget never runs out. */
  limited: boolean;
  /** Share of this gadget's use left, 1 … 0. */
  readonly remaining: number;
  /** The movement config to use this tick (the base, or a modified copy). */
  movement(base: MovementConfig, ctx: GadgetContext): MovementConfig;
  beforeMove(ctx: GadgetContext): void;
  afterMove(ctx: GadgetContext): void;
  /** Clears tethers, pads and timers: on retry, respawn, and finish. */
  resetTransientState(player: PlayerState): void;
}

export interface GadgetDefinition {
  id: GadgetId;
  displayName: string;
  /** Short reminder of what the button does, for the HUD. */
  actionHint: string;
  /** Hotkey number in the selector. */
  slot: number;
  create(): GadgetRuntime;
}
