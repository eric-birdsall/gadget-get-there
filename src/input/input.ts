import { CAMERA_CONFIG } from '../config';
import { type KeyLookState, newKeyLookState, stepKeyLook } from './keyLook';
import { keyLabel, keyRangeLabel } from './keyNames';

export enum Action {
  Forward = 'forward',
  Back = 'back',
  Left = 'left',
  Right = 'right',
  Jump = 'jump',
  Crouch = 'crouch',
  /** Use the gadget in slot 1, 2 or 3. */
  UseSlot1 = 'use-slot-1',
  UseSlot2 = 'use-slot-2',
  UseSlot3 = 'use-slot-3',
  LookLeft = 'look-left',
  LookRight = 'look-right',
  LookUp = 'look-up',
  LookDown = 'look-down',
  Retry = 'retry',
  /** At the start line: add or remove gadget N (palette order). */
  PickGadget1 = 'slot-1',
  PickGadget2 = 'slot-2',
  PickGadget3 = 'slot-3',
  PickGadget4 = 'slot-4',
  PickGadget5 = 'slot-5',
  ToggleGhost = 'toggle-ghost',
  ToggleDebug = 'toggle-debug',
}

/** Key codes (KeyboardEvent.code) or `Mouse0`..`Mouse4` per action: a main key and an alternate. Remappable. */
export type Bindings = Record<Action, string[]>;
export const MAX_KEYS_PER_ACTION = 2;

export const DEFAULT_BINDINGS: Bindings = {
  [Action.Forward]: ['KeyW', 'ArrowUp'],
  [Action.Back]: ['KeyS', 'ArrowDown'],
  [Action.Left]: ['KeyA', 'ArrowLeft'],
  [Action.Right]: ['KeyD', 'ArrowRight'],
  [Action.Jump]: ['Space'],
  [Action.Crouch]: ['ShiftLeft', 'ShiftRight'],
  [Action.UseSlot1]: ['KeyE'],
  [Action.UseSlot2]: ['KeyQ'],
  [Action.UseSlot3]: ['KeyF'],
  [Action.LookLeft]: ['KeyJ'],
  [Action.LookRight]: ['KeyL'],
  [Action.LookUp]: ['KeyI'],
  [Action.LookDown]: ['KeyK'],
  [Action.Retry]: ['KeyR', 'Enter'],
  [Action.PickGadget1]: ['Digit1', 'Numpad1'],
  [Action.PickGadget2]: ['Digit2', 'Numpad2'],
  [Action.PickGadget3]: ['Digit3', 'Numpad3'],
  [Action.PickGadget4]: ['Digit4', 'Numpad4'],
  [Action.PickGadget5]: ['Digit5', 'Numpad5'],
  [Action.ToggleGhost]: ['KeyG'],
  [Action.ToggleDebug]: ['Backquote'],
};

/** Use keys, by slot. */
export const USE_ACTIONS = [Action.UseSlot1, Action.UseSlot2, Action.UseSlot3] as const;
/** Start-line add/remove keys, by palette position. */
export const PICK_ACTIONS = [Action.PickGadget1, Action.PickGadget2, Action.PickGadget3, Action.PickGadget4, Action.PickGadget5] as const;

/** The action's main key as shown on screen, e.g. "E". */
export function keyName(bindings: Bindings, action: Action): string {
  const code = bindings[action][0];
  return code ? keyLabel(code) : 'unbound';
}

/** The add/remove keys together: "1–5" by default. */
export function pickKeysName(bindings: Bindings): string {
  return keyRangeLabel(PICK_ACTIONS.map((a) => keyName(bindings, a)));
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
  /** Once a lock has worked, a later refusal is just the browser's re-lock cooldown after Esc. */
  private everLocked = false;
  /** Cursor x as a fraction of the window width, or null when unknown. */
  private cursorX: number | null = null;

  constructor(private readonly target: HTMLElement) {
    document.addEventListener('keydown', (e) => {
      if (!this.locked) return;
      // Esc belongs to the pause/fullscreen handling in main.
      if (e.code === 'Escape') return;
      // Bound keys belong to the game, not the browser (Tab, ', / and Space all do things there).
      if (this.bound.has(e.code) || e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.held.add(e.code);
    });
    document.addEventListener('keyup', (e) => this.held.delete(e.code));
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.pressed.add(`Mouse${e.button}`);
      this.held.add(`Mouse${e.button}`);
    });
    document.addEventListener('mouseup', (e) => this.held.delete(`Mouse${e.button}`));
    document.addEventListener('mousemove', (e) => {
      this.cursorX = e.clientX / window.innerWidth;
      if (!this.locked) return;
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
    return this.freeCursor ? this.fakeLocked : document.pointerLockElement === this.target;
  }

  get usingFreeCursor(): boolean {
    return this.freeCursor;
  }

  lock(): void {
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

  /** Keyboard look and free-cursor edge turning; call once per frame while playing. */
  update(dt: number): void {
    const view = stepKeyLook(
      this.keyLook,
      { turn: this.axis(Action.LookRight, Action.LookLeft), tilt: this.axis(Action.LookUp, Action.LookDown) },
      this,
      dt,
      { speed: this.keyLookSpeed, invertY: this.invertY, autoLevel: this.autoLevel },
    );
    this.yaw = view.yaw;
    this.pitch = view.pitch;
    if (!this.freeCursor || !this.fakeLocked || this.cursorX === null) return;
    const zone = CAMERA_CONFIG.freeCursorEdgeZone;
    const push = this.cursorX < zone ? (this.cursorX - zone) / zone : this.cursorX > 1 - zone ? (this.cursorX - (1 - zone)) / zone : 0;
    this.yaw -= Math.max(-1, Math.min(1, push)) * CAMERA_CONFIG.freeCursorTurnSpeed * this.sensitivity * dt;
  }

  unlock(): void {
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
    return this.bindings[action].some((code) => this.held.has(code));
  }

  /** True once per physical press; consumed by the call. */
  consumePress(action: Action): boolean {
    let hit = false;
    for (const code of this.bindings[action]) {
      if (this.pressed.delete(code)) hit = true;
    }
    return hit;
  }

  /** Drops presses nobody consumed this frame, so they don't fire later. */
  endFrame(): void {
    this.pressed.clear();
  }

  axis(positive: Action, negative: Action): number {
    return (this.isHeld(positive) ? 1 : 0) - (this.isHeld(negative) ? 1 : 0);
  }

  private releaseAll(): void {
    this.held.clear();
    this.pressed.clear();
  }
}
