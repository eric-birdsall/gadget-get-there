import { CAMERA_CONFIG } from '../config';
import { Action } from './actions';
import { DEFAULT_PAD_BINDINGS, PAD_BUTTON_NAMES, type PadBindings, PadButton, type PadState, firstPad, readPad } from './gamepad';
import { type KeyLookState, newKeyLookState, stepKeyLook } from './keyLook';
import { keyLabel } from './keyNames';

export { Action };

/** Key codes (KeyboardEvent.code) or `Mouse0`..`Mouse4` per action: a main key and an alternate. Remappable. */
export type Bindings = Record<Action, string[]>;
export const MAX_KEYS_PER_ACTION = 2;

export const DEFAULT_BINDINGS: Bindings = {
  [Action.Forward]: ['KeyW', 'ArrowUp'],
  [Action.Back]: ['KeyS', 'ArrowDown'],
  [Action.Left]: ['KeyA', 'ArrowLeft'],
  [Action.Right]: ['KeyD', 'ArrowRight'],
  [Action.Jump]: ['Space'],
  [Action.Crouch]: ['KeyC'],
  [Action.Sprint]: ['ShiftLeft', 'ShiftRight'],
  [Action.UseSlot1]: ['KeyE'],
  [Action.UseSlot2]: ['KeyQ'],
  [Action.UseSlot3]: ['KeyF'],
  [Action.LookLeft]: ['KeyJ'],
  [Action.LookRight]: ['KeyL'],
  [Action.LookUp]: ['KeyI'],
  [Action.LookDown]: ['KeyK'],
  [Action.Retry]: ['KeyR', 'Enter'],
  [Action.ToggleGhost]: ['KeyG'],
  [Action.ToggleDebug]: ['Backquote'],
};

/** Use keys, by slot. */
export const USE_ACTIONS = [Action.UseSlot1, Action.UseSlot2, Action.UseSlot3] as const;

export type InputDevice = 'keys' | 'pad';

/**
 * What the player chose to play with (the other device is ignored, and on-screen labels show
 * this one's buttons), and the controller's bindings.
 */
export const device: { current: InputDevice; pad: PadBindings } = { current: 'keys', pad: { ...DEFAULT_PAD_BINDINGS } };

/** The action's main key as shown on screen, e.g. "E" (or "RT" when playing with the controller). */
export function keyName(bindings: Bindings, action: Action): string {
  const button = device.pad[action];
  if (device.current === 'pad' && button !== undefined) return PAD_BUTTON_NAMES[button];
  const code = bindings[action][0];
  return code ? keyLabel(code) : 'unbound';
}

/** The use keys for `slots` slots together: "E / Q / F" by default. */
export function useKeysName(bindings: Bindings, slots: number = USE_ACTIONS.length): string {
  return USE_ACTIONS.slice(0, slots).map((a) => keyName(bindings, a)).join(' / ');
}

/** Keyboard and pointer-locked mouse. The game reads held state and one-shot presses each frame. */
export class InputManager {
  yaw = 0;
  /** Positive looks down. */
  pitch: number = CAMERA_CONFIG.defaultPitch;
  sensitivity = 1;
  invertY = false;
  /** Keyboard look: turn-speed multiplier, and easing back to level after looking up/down. */
  keyLookSpeed = 1;
  autoLevel = true;
  private keyLook: KeyLookState = newKeyLookState();
  bindings: Bindings = DEFAULT_BINDINGS;
  private bound = new Set<string>();
  /**
   * Called when the browser refuses to capture the mouse. `switchedToFreeCursor` is true when
   * the game fell back to playing with a visible cursor.
   */
  onLockError: (switchedToFreeCursor: boolean) => void = () => {};

  private held = new Set<string>();
  private pressed = new Set<string>();
  /**
   * Playing without pointer lock: ?nolock, or automatically when the browser refuses the lock
   * (embedded panes do). Mouse look works while the cursor is inside the window, and holding it
   * near or past the left/right edge keeps turning.
   */
  private freeCursor = new URLSearchParams(location.search).has('nolock');
  private fakeLocked = false;
  /** Resumed from the controller: playing without the mouse captured (browsers only grant that to a click or key). */
  private padLocked = false;
  private pad: PadState | null = null;
  private padDown = new Set<PadButton>();
  private padPressed = new Set<PadButton>();
  /** Every button down at the last poll, and the ones that went down since. */
  private padPrev = new Set<PadButton>();
  private edges = new Set<PadButton>();
  /** Buttons held when play resumed (A on Resume): ignored until let go, so they don't jump. */
  private padSuppressed = new Set<PadButton>();
  /** Once a lock has worked, a later refusal is just the browser's re-lock cooldown after Esc. */
  private everLocked = false;
  /** Cursor x as a fraction of the window width, or null when unknown. */
  private cursorX: number | null = null;

  constructor(private readonly target: HTMLElement) {
    document.addEventListener('keydown', (e) => {
      if (!this.locked) return;
      // Esc belongs to the pause/fullscreen handling in main.
      if (e.code === 'Escape') return;
      // Playing with the controller: keys don't play.
      if (device.current === 'pad') return;
      // Bound keys belong to the game, not the browser (Tab, ', / and Space all do things there).
      if (this.bound.has(e.code) || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.held.add(e.code);
    });
    document.addEventListener('keyup', (e) => this.held.delete(e.code));
    document.addEventListener('mousedown', (e) => {
      if (!this.locked || device.current === 'pad') return;
      this.pressed.add(`Mouse${e.button}`);
      this.held.add(`Mouse${e.button}`);
    });
    document.addEventListener('mouseup', (e) => this.held.delete(`Mouse${e.button}`));
    document.addEventListener('mousemove', (e) => {
      this.cursorX = e.clientX / window.innerWidth;
      // Playing with the controller, the cursor is free: it doesn't look around.
      if (!this.locked || this.padLocked || device.current === 'pad') return;
      this.yaw -= e.movementX * CAMERA_CONFIG.horizontalSensitivity * this.sensitivity;
      const dy = e.movementY * CAMERA_CONFIG.verticalSensitivity * this.sensitivity * (this.invertY ? -1 : 1);
      // The mouse set the tilt: leave it where it is.
      if (e.movementY !== 0) this.keyLook.keyTilted = false;
      this.pitch = Math.min(CAMERA_CONFIG.maxPitch, Math.max(CAMERA_CONFIG.minPitch, this.pitch + dy));
    });
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    // Leaving the window keeps the last edge position, so pushing past the edge keeps turning.
    document.documentElement.addEventListener('mouseleave', (e) => {
      this.cursorX = e.clientX <= 0 ? 0 : e.clientX >= window.innerWidth - 1 ? 1 : null;
    });
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === this.target) this.everLocked = true;
      if (!this.locked) this.releaseAll();
    });
    document.addEventListener('pointerlockerror', () => this.lockFailed());
    window.addEventListener('blur', () => this.releaseAll());
  }

  get locked(): boolean {
    return this.freeCursor ? this.fakeLocked : this.padLocked || document.pointerLockElement === this.target;
  }

  get usingFreeCursor(): boolean {
    return this.freeCursor;
  }

  lock(): void {
    this.padLocked = false;
    if (this.freeCursor) {
      this.fakeLocked = true;
      document.dispatchEvent(new Event('pointerlockchange'));
      return;
    }
    // Rejects where the browser refuses the lock, as some embedded panes do.
    try {
      Promise.resolve(this.target.requestPointerLock()).catch(() => this.lockFailed());
    } catch {
      this.lockFailed();
    }
  }

  private lockFailed(): void {
    // Browsers may report one refusal both as an event and a rejected promise.
    if (this.freeCursor) return;
    if (this.everLocked) {
      this.onLockError(false);
      return;
    }
    // This browser won't capture the mouse at all: play with a visible cursor instead.
    this.freeCursor = true;
    this.onLockError(true);
    this.lock();
  }

  /**
   * Resume from the controller's Menu button. A controller press can't capture the mouse (or go
   * fullscreen), so play carries on with the cursor free and the mouse not looking.
   */
  lockFromPad(): void {
    this.padSuppressed = new Set(this.padPrev);
    if (this.freeCursor) return this.lock();
    this.padLocked = true;
    document.dispatchEvent(new Event('pointerlockchange'));
  }

  /**
   * Reads the controller; call once per frame, paused or not. In the menus it always counts (so
   * either device can drive them); in play only when playing with it.
   */
  pollPad(): void {
    const gp = firstPad();
    const read = gp ? readPad(gp) : null;
    if (device.current !== 'pad' && this.locked) {
      this.pad = null;
      this.edges = new Set();
      this.padPrev = new Set();
      this.padDown = new Set();
      return;
    }
    this.pad = read;
    const down = this.pad?.down ?? new Set<PadButton>();
    this.edges = new Set([...down].filter((b) => !this.padPrev.has(b)));
    this.padPrev = down;
    for (const b of this.padSuppressed) if (!down.has(b)) this.padSuppressed.delete(b);
    if (this.locked) {
      for (const b of this.edges) if (!this.padSuppressed.has(b)) this.padPressed.add(b);
      this.padDown = new Set([...down].filter((b) => !this.padSuppressed.has(b)));
    } else this.padDown = new Set();
  }

  /** The controller this frame (sticks and buttons), or null with none connected. */
  get padState(): PadState | null {
    return this.pad;
  }

  /** Controller buttons that went down this frame, paused or not. */
  get padEdges(): ReadonlySet<PadButton> {
    return this.edges;
  }

  get device(): InputDevice {
    return device.current;
  }

  /** Switches what the player plays with; everything held on the other device is let go. */
  setDevice(d: InputDevice): void {
    if (device.current === d) return;
    device.current = d;
    this.releaseAll();
  }

  /** Movement from keys and the left stick: +1 forward, +1 right. */
  get moveForward(): number {
    return clamp1(this.axis(Action.Forward, Action.Back) + (this.locked ? (this.pad?.forward ?? 0) : 0));
  }

  get moveRight(): number {
    return clamp1(this.axis(Action.Right, Action.Left) + (this.locked ? (this.pad?.right ?? 0) : 0));
  }

  /** Keyboard and right-stick look, and free-cursor edge turning; call once per frame while playing. */
  update(dt: number): void {
    const view = stepKeyLook(
      this.keyLook,
      {
        turn: clamp1(this.axis(Action.LookRight, Action.LookLeft) + (this.pad?.turn ?? 0)),
        tilt: clamp1(this.axis(Action.LookUp, Action.LookDown) + (this.pad?.tilt ?? 0)),
      },
      this,
      dt,
      { speed: this.keyLookSpeed, invertY: this.invertY, autoLevel: this.autoLevel },
    );
    this.yaw = view.yaw;
    this.pitch = view.pitch;
    if (!this.freeCursor || !this.fakeLocked || this.cursorX === null || device.current === 'pad') return;
    const zone = CAMERA_CONFIG.freeCursorEdgeZone;
    const push = this.cursorX < zone ? (this.cursorX - zone) / zone : this.cursorX > 1 - zone ? (this.cursorX - (1 - zone)) / zone : 0;
    this.yaw -= Math.max(-1, Math.min(1, push)) * CAMERA_CONFIG.freeCursorTurnSpeed * this.sensitivity * dt;
  }

  unlock(): void {
    if (this.padLocked) {
      this.padLocked = false;
      document.dispatchEvent(new Event('pointerlockchange'));
      return;
    }
    if (this.freeCursor) {
      this.fakeLocked = false;
      document.dispatchEvent(new Event('pointerlockchange'));
    } else document.exitPointerLock();
  }

  setBindings(bindings: Bindings): void {
    this.bindings = bindings;
    this.bound = new Set(Object.values(bindings).flat());
  }

  isHeld(action: Action): boolean {
    if (this.bindings[action].some((code) => this.held.has(code))) return true;
    const b = device.pad[action];
    return b !== undefined && this.padDown.has(b);
  }

  /** True once per physical press; consumed by the call. */
  consumePress(action: Action): boolean {
    let hit = false;
    const b = device.pad[action];
    if (b !== undefined && this.padPressed.delete(b)) hit = true;
    for (const code of this.bindings[action]) {
      if (this.pressed.delete(code)) hit = true;
    }
    return hit;
  }

  /** Drops presses nobody consumed this frame, so they don't fire later. */
  endFrame(): void {
    this.pressed.clear();
    this.padPressed.clear();
  }

  axis(positive: Action, negative: Action): number {
    return (this.isHeld(positive) ? 1 : 0) - (this.isHeld(negative) ? 1 : 0);
  }

  private releaseAll(): void {
    this.held.clear();
    this.pressed.clear();
    this.padPressed.clear();
  }
}

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v));
