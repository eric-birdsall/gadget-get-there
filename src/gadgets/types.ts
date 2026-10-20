import type { Vector3 } from 'three';
import type { Box } from '../sim/collision';
import type { MovementConfig, PlayerState } from '../sim/player';

export enum GadgetId {
  Grapple = 'grapple',
  Jetpack = 'jetpack',
  Dash = 'dash',
  Wingsuit = 'wingsuit',
  LaunchPad = 'launch-pad',
}

export enum GadgetEvent {
  GrappleAttached = 'grapple-attached',
  GrappleMissed = 'grapple-missed',
  GrappleReleased = 'grapple-released',
  PadPlaced = 'pad-placed',
  PadInvalid = 'pad-invalid',
  PadLaunched = 'pad-launched',
  JetpackOn = 'jetpack-on',
  JetpackOff = 'jetpack-off',
  Dashed = 'dashed',
  GlideStarted = 'glide-started',
  GlideEnded = 'glide-ended',
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
  /** Share of this gadget's budget left, 1 … 0. */
  readonly remaining: number;
  /** Working right now (or just fired), for the HUD glow. */
  readonly active: boolean;
  /** Budget left, for the HUD: '3.2s', 'x1'. */
  readonly usageLabel: string;
  /** The movement config to use this tick (the base, or a modified copy). */
  movement(base: MovementConfig, ctx: GadgetContext): MovementConfig;
  beforeMove(ctx: GadgetContext): void;
  afterMove(ctx: GadgetContext): void;
  /** Clears tethers, pads and timers: on retry, respawn, and finish. */
  resetTransientState(player: PlayerState): void;
  /** Stop whatever this gadget is doing right now (the grapple lets go of its rope). */
  unequip(player: PlayerState): void;
  /** How much has been used (swings, launches, seconds…): saved at checkpoints, restored on respawn. */
  used: number;
}

export interface GadgetDefinition {
  id: GadgetId;
  displayName: string;
  /** Number key that adds or removes it at the start line. */
  slot: number;
  /** Full budget, for the menu: '5s', 'x2'. */
  budgetLabel: string;
  /** One sentence on what it does, for the menu's info modal. */
  summary: string;
  /** Label/value pairs for the menu's info modal. */
  stats: [string, string][];
  create(): GadgetRuntime;
}
