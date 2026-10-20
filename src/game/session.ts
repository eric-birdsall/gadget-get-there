import { Vector3 } from 'three';
import { CAMERA_CONFIG, DT, MOVEMENT_CONFIG, PLAYER_SHAPE, WORLD_CONFIG } from '../config';
import type { CourseDefinition, TriggerVolume } from '../course/types';
import { GrappleGadget } from '../gadgets/grapple';
import { DEFAULT_LOADOUT, gadgetDefinition } from '../gadgets/registry';
import { type GadgetContext, GadgetEvent, type GadgetId, type GadgetRuntime } from '../gadgets/types';
import { type Box, makeBox, raycast } from '../sim/collision';
import { type MovementConfig, type PlayerInput, type PlayerState, createPlayer, resetPlayer, stepPlayer } from '../sim/player';
import { type GhostData, GhostRecorder } from './ghost';

export enum AttemptState {
  /** At the start line; the clock starts on the first movement or gadget input. */
  Ready = 'ready',
  Running = 'running',
  Finished = 'finished',
}

export enum SessionEvent {
  AttemptStarted = 'attempt-started',
  Jumped = 'jumped',
  Landed = 'landed',
  Fell = 'fell',
  SlideStarted = 'slide-started',
  /** A slide has gone on long enough that jumping now gives the speed burst. */
  SlideReady = 'slide-ready',
  /** A jump out of a long slide gave its speed burst. */
  SlideJumped = 'slide-jumped',
  Mantled = 'mantled',
  CheckpointReached = 'checkpoint-reached',
  Finished = 'finished',
  /** The player was placed at a spawn point; views should snap rather than glide there. */
  Spawned = 'spawned',
  /** The gadget in hand changed (scroll wheel or 1/2/3). */
  GadgetSwitched = 'gadget-switched',
}

export type AnyEvent = SessionEvent | GadgetEvent;

export interface SessionInput extends PlayerInput {
  /** Gadget button held. */
  action: boolean;
  /** Gadget button went down since the last tick. */
  actionPressed: boolean;
  aimOrigin: Vector3;
  aimDir: Vector3;
}

export interface RunResult {
  seconds: number;
  /** Gadget order used. */
  loadout: GadgetId[];
  checkpointsEnabled: boolean;
  ghost: GhostData;
}

/** A crosshair ray as the default camera would see it, for tests and tools without a renderer. */
export function aimFromView(feet: Vector3, yaw: number, pitch: number): { aimOrigin: Vector3; aimDir: Vector3 } {
  const back = new Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  const pivot = new Vector3(feet.x, feet.y + CAMERA_CONFIG.height, feet.z);
  return { aimOrigin: pivot.clone().addScaledVector(back, CAMERA_CONFIG.distance), aimDir: back.negate() };
}

export function idleInput(yaw = 0): SessionInput {
  return {
    forward: 0,
    right: 0,
    yaw,
    jump: false,
    crouch: false,
    action: false,
    actionPressed: false,
    aimOrigin: new Vector3(),
    aimDir: new Vector3(0, 0, -1),
  };
}

/** True for any input that counts as starting a run. Mouse look alone doesn't. */
export function isMovementInput(input: SessionInput): boolean {
  return input.forward !== 0 || input.right !== 0 || input.jump || input.actionPressed;
}

/** The lowest point of any piece, minus a margin: below this you've fallen. */
export function killPlaneY(boxes: readonly Box[]): number {
  let lowest = Infinity;
  for (const b of boxes) lowest = Math.min(lowest, b.center.y - b.bound);
  return lowest - WORLD_CONFIG.killDepth;
}

/** Whether the player's capsule (as an upright box) overlaps an axis-aligned trigger. */
export function inVolume(p: PlayerState, v: TriggerVolume): boolean {
  const r = PLAYER_SHAPE.radius;
  return (
    Math.abs(p.pos.x - v.center[0]) <= v.size[0] / 2 + r &&
    Math.abs(p.pos.z - v.center[2]) <= v.size[2] / 2 + r &&
    p.pos.y + PLAYER_SHAPE.height >= v.center[1] - v.size[1] / 2 &&
    p.pos.y <= v.center[1] + v.size[1] / 2
  );
}

export interface SessionOptions {
  /** Gadget order: each gadget once. */
  loadout?: GadgetId[];
  /** Shortcut: this gadget first, the rest in default order. */
  gadget?: GadgetId;
  /** Training: gadgets never run out. */
  unlimited?: boolean;
  checkpointsEnabled?: boolean;
  movement?: MovementConfig;
}

/**
 * One course being played: the player, the selected gadget, the attempt state machine, the
 * clock, checkpoints and the ghost recording.
 */
export class RunSession {
  readonly boxes: Box[];
  readonly anchors: Vector3[];
  readonly killY: number;
  readonly player: PlayerState;
  state = AttemptState.Ready;
  /** Seconds since the attempt started, accumulated from sim ticks (never wall clock). */
  elapsed = 0;
  attempt = 0;
  /** Index of the furthest checkpoint reached this attempt, or -1. */
  checkpoint = -1;
  /** Gadget order for the run (0 to MAX_SLOTS gadgets, each once). Locked once the clock starts. */
  readonly loadout: GadgetId[];
  /** Index into `loadout` of the gadget in hand. */
  slot = 0;
  /** One runtime per chosen gadget, alive for the whole run so budgets and thrown pads persist. */
  gadgets: GadgetRuntime[] = [];
  private readonly unlimited: boolean;
  /** Checkpoint rule for this attempt; a change mid-run waits in `queuedCheckpoints`. */
  checkpointsEnabled: boolean;
  queuedCheckpoints: boolean | null = null;
  /** Set on finishing. */
  result: RunResult | null = null;
  /** Direction the body faces, for the ghost: follows horizontal velocity. */
  facing = 0;
  /** Camera heading to use after the latest spawn. */
  spawnYaw = 0;
  private readonly movement: MovementConfig;
  private readonly startPos: Vector3;
  private readonly recorder = new GhostRecorder();
  /** Feet height when last on the ground, for spotting a fall into the void early. */
  private lastGroundY = 0;
  private events: AnyEvent[] = [];
  private readonly emit = (e: GadgetEvent) => this.events.push(e);

  constructor(
    readonly course: CourseDefinition,
    options: SessionOptions = {},
  ) {
    this.movement = options.movement ?? MOVEMENT_CONFIG;
    this.boxes = course.pieces.map(makeBox);
    this.anchors = course.anchors.map((a) => new Vector3(...a));
    this.killY = killPlaneY(this.boxes);
    this.startPos = new Vector3(...course.start.pos);
    this.player = createPlayer(this.startPos);
    this.unlimited = options.unlimited ?? false;
    const order = options.loadout ?? DEFAULT_LOADOUT;
    const picked = options.gadget ? [options.gadget, ...order.filter((g) => g !== options.gadget)] : [...order];
    this.loadout = [...new Set(picked)].slice(0, MAX_SLOTS);
    this.checkpointsEnabled = options.checkpointsEnabled ?? true;
    this.restart();
  }

  /** The gadget in hand, or null with no gadgets chosen. */
  get gadget(): GadgetRuntime | null {
    return this.gadgets[this.slot] ?? null;
  }

  /** Fresh runtimes (full budgets) for every chosen gadget, slot 1 in hand. */
  private refill(): void {
    for (const g of this.gadgets) g.resetTransientState(this.player);
    this.gadgets = this.loadout.map((id) => {
      const g = gadgetDefinition(id).create();
      g.limited = !this.unlimited;
      return g;
    });
    this.slot = 0;
  }

  /** Switch the gadget in hand, any time before the finish. Returns false if nothing changed. */
  selectSlot(index: number): boolean {
    if (this.state === AttemptState.Finished || index === this.slot || !this.gadgets[index]) return false;
    const current = this.gadget;
    const wasSwinging = current instanceof GrappleGadget && current.attached;
    current?.unequip(this.player);
    if (wasSwinging) this.events.push(GadgetEvent.GrappleReleased);
    this.slot = index;
    this.events.push(SessionEvent.GadgetSwitched);
    return true;
  }

  selectGadget(id: GadgetId): boolean {
    return this.selectSlot(this.loadout.indexOf(id));
  }

  /** Scroll: the next (or previous) gadget in slot order that has budget left, wrapping round. */
  cycleGadget(step: 1 | -1): boolean {
    const n = this.gadgets.length;
    for (let k = 1; k < n; k++) {
      const j = (((this.slot + step * k) % n) + n) % n;
      if (this.gadgets[j].remaining > 0) return this.selectSlot(j);
    }
    return false;
  }

  /** Events raised between ticks (switching gadgets from input). */
  takeEvents(): AnyEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** At the start line: empty every slot. Returns false if nothing changed. */
  clearGadgets(): boolean {
    if (this.state !== AttemptState.Ready || this.loadout.length === 0) return false;
    this.loadout.length = 0;
    this.refill();
    return true;
  }

  /**
   * At the start line: a gadget not in the loadout goes into the next free slot; one already in
   * it is removed, and the slots after it move up. Returns false if nothing changed.
   */
  toggleGadget(id: GadgetId): boolean {
    if (this.state !== AttemptState.Ready) return false;
    const at = this.loadout.indexOf(id);
    if (at >= 0) this.loadout.splice(at, 1);
    else if (this.loadout.length < MAX_SLOTS) this.loadout.push(id);
    else return false;
    this.refill();
    return true;
  }

  /** Applies now at the start line; otherwise from the next attempt, so rules never change mid-run. */
  setCheckpointsEnabled(enabled: boolean): void {
    if (this.state === AttemptState.Ready) {
      this.checkpointsEnabled = enabled;
      this.queuedCheckpoints = null;
    } else {
      this.queuedCheckpoints = enabled === this.checkpointsEnabled ? null : enabled;
    }
  }

  /** A fresh attempt from the start line: clock zeroed, checkpoints cleared, queued choices applied. */
  restart(): AnyEvent[] {
    // A full retry refills every gadget.
    this.refill();
    if (this.queuedCheckpoints !== null) this.checkpointsEnabled = this.queuedCheckpoints;
    this.queuedCheckpoints = null;
    resetPlayer(this.player, this.startPos);
    this.lastGroundY = this.startPos.y;
    this.state = AttemptState.Ready;
    this.elapsed = 0;
    this.checkpoint = -1;
    this.result = null;
    this.facing = this.spawnYaw = this.course.start.yaw;
    this.recorder.reset();
    this.attempt++;
    return [SessionEvent.Spawned];
  }

  /** Back to the latest checkpoint (or the start) with the clock still running. */
  private respawn(): void {
    // Budgets and the gadget in hand stay as they were; ropes and thrown pads are cleared.
    for (const g of this.gadgets) g.resetTransientState(this.player);
    const cp = this.checkpoint >= 0 ? this.course.checkpoints[this.checkpoint].respawn : null;
    const pos = cp ? new Vector3(...cp.pos) : this.startPos;
    resetPlayer(this.player, pos);
    this.lastGroundY = pos.y;
    this.facing = this.spawnYaw = cp ? cp.yaw : this.course.start.yaw;
    this.events.push(SessionEvent.Spawned);
  }

  /** Coasting off the edge after the finish keeps the result: you're put back at the gate. */
  private respawnAtFinish(): void {
    const f = this.course.finish;
    resetPlayer(this.player, new Vector3(f.center[0], f.center[1] - f.size[1] / 2, f.center[2]));
    this.lastGroundY = this.player.pos.y;
    this.spawnYaw = this.facing;
    this.events.push(SessionEvent.Spawned);
  }

  /** Advances one fixed tick. */
  step(input: SessionInput): AnyEvent[] {
    // Events from switching gadgets since the last tick are delivered with this one.
    if (this.state === AttemptState.Ready && isMovementInput(input)) {
      this.state = AttemptState.Running;
      this.events.push(SessionEvent.AttemptStarted);
    }
    // After the finish line the run is over: coast to a stop with the gadget off.
    const live = this.state !== AttemptState.Finished;
    const ctx: GadgetContext = {
      player: this.player,
      boxes: this.boxes,
      anchors: this.anchors,
      input: {
        held: live && input.action,
        pressed: live && input.actionPressed,
        yaw: input.yaw,
        aimOrigin: input.aimOrigin,
        aimDir: input.aimDir,
      },
      emit: this.emit,
    };
    // Gadgets not in hand get no button, but keep working (a thrown pad still launches you).
    const idle: GadgetContext = { ...ctx, input: { ...ctx.input, held: false, pressed: false } };
    const moveInput = live ? input : { ...input, forward: 0, right: 0, jump: false };
    const g = this.gadget;
    const cfg = g ? g.movement(this.movement, ctx) : this.movement;
    for (const each of this.gadgets) each.beforeMove(each === g ? ctx : idle);
    stepPlayer(this.player, moveInput, this.boxes, cfg);
    if (this.player.justMantled && g instanceof GrappleGadget && g.attached) {
      // Pulling up onto a ledge ends the swing.
      g.unequip(this.player);
      this.events.push(GadgetEvent.GrappleReleased);
    }
    for (const each of this.gadgets) each.afterMove(each === g ? ctx : idle);

    const p = this.player;
    if (Math.hypot(p.vel.x, p.vel.z) > 0.5) this.facing = Math.atan2(-p.vel.x, -p.vel.z);
    if (this.state === AttemptState.Running) this.elapsed += DT;
    if (p.justJumped) this.events.push(SessionEvent.Jumped);
    if (p.justLanded) this.events.push(SessionEvent.Landed);
    if (p.justSlid) this.events.push(SessionEvent.SlideStarted);
    if (p.justSlideReady) this.events.push(SessionEvent.SlideReady);
    if (p.justSlideJumped) this.events.push(SessionEvent.SlideJumped);
    if (p.justMantled) this.events.push(SessionEvent.Mantled);
    if (p.grounded) this.lastGroundY = p.pos.y;

    if (this.state === AttemptState.Running) {
      this.recorder.sample(this.elapsed, p.pos, this.facing, this.grappleAnchor());
      this.checkTriggers();
    }

    if (this.hasFallen()) {
      this.events.push(SessionEvent.Fell);
      if (this.state === AttemptState.Finished) this.respawnAtFinish();
      else if (this.state === AttemptState.Running && this.checkpointsEnabled) this.respawn();
      else this.events.push(...this.restart());
    }
    return this.takeEvents();
  }

  private grappleAnchor(): number {
    const grapple = this.gadgets.find((g): g is GrappleGadget => g instanceof GrappleGadget);
    return grapple ? grapple.anchorIndex : -1;
  }

  private checkTriggers(): void {
    const p = this.player;
    if (this.checkpointsEnabled) {
      // Only checkpoints beyond the current one count, so backtracking never moves you back.
      for (let i = this.checkpoint + 1; i < this.course.checkpoints.length; i++) {
        if (inVolume(p, this.course.checkpoints[i])) {
          this.checkpoint = i;
          this.events.push(SessionEvent.CheckpointReached);
        }
      }
    }
    if (inVolume(p, this.course.finish)) {
      this.state = AttemptState.Finished;
      this.recorder.sample(this.elapsed, p.pos, this.facing, this.grappleAnchor(), true);
      for (const g of this.gadgets) g.resetTransientState(p);
      this.result = {
        seconds: this.elapsed,
        loadout: [...this.loadout],
        checkpointsEnabled: this.checkpointsEnabled,
        ghost: this.recorder.finish(),
      };
      this.events.push(SessionEvent.Finished);
    }
  }

  /**
   * Below the kill plane, or well below the last footing with nothing underneath and nothing
   * along the arc you're falling on. Never while on a grapple line.
   */
  private hasFallen(): boolean {
    const { pos, vel } = this.player;
    if (pos.y < this.killY) return true;
    if (this.player.grounded || this.player.tethered || vel.y >= 0) return false;
    if (pos.y > this.lastGroundY - WORLD_CONFIG.voidFallDepth) return false;
    if (raycast(this.boxes, pos, DOWN, pos.y - this.killY)) return false;
    return !this.arcHitsAnything();
  }

  /** Traces the ballistic path ahead in short segments, down to the kill plane. */
  private arcHitsAnything(): boolean {
    const g = this.movement.gravity;
    const { pos: p0, vel: v } = this.player;
    arcFrom.copy(p0);
    for (let t = ARC_STEP; arcFrom.y > this.killY && t <= ARC_MAX_SECONDS; t += ARC_STEP) {
      arcTo.set(p0.x + v.x * t, p0.y + v.y * t - 0.5 * g * t * t, p0.z + v.z * t);
      arcDir.subVectors(arcTo, arcFrom);
      const len = arcDir.length();
      if (raycast(this.boxes, arcFrom, arcDir.divideScalar(len), len)) return true;
      arcFrom.copy(arcTo);
    }
    return false;
  }
}

/** Gadget slots per run. */
export const MAX_SLOTS = 3;

const DOWN = new Vector3(0, -1, 0);
const ARC_STEP = 0.2;
const ARC_MAX_SECONDS = 4;
const arcFrom = new Vector3();
const arcTo = new Vector3();
const arcDir = new Vector3();
