import { CAMERA_CONFIG } from '../config';

export enum Action {
  Forward = 'forward',
  Back = 'back',
  Left = 'left',
  Right = 'right',
  Jump = 'jump',
  Crouch = 'crouch',
  Gadget = 'gadget',
  Retry = 'retry',
  Slot1 = 'slot-1',
  Slot2 = 'slot-2',
  Slot3 = 'slot-3',
  NextGadget = 'next-gadget',
  PrevGadget = 'prev-gadget',
  ToggleGhost = 'toggle-ghost',
  ToggleDebug = 'toggle-debug',
}

/** Key codes (KeyboardEvent.code) or `Mouse0`..`Mouse2` per action. Remappable. */
export type Bindings = Record<Action, string[]>;

export const DEFAULT_BINDINGS: Bindings = {
  [Action.Forward]: ['KeyW', 'ArrowUp'],
  [Action.Back]: ['KeyS', 'ArrowDown'],
  [Action.Left]: ['KeyA', 'ArrowLeft'],
  [Action.Right]: ['KeyD', 'ArrowRight'],
  [Action.Jump]: ['Space'],
  [Action.Crouch]: ['ShiftLeft', 'ShiftRight'],
  [Action.Gadget]: ['Mouse0'],
  [Action.Retry]: ['KeyR', 'Enter'],
  [Action.Slot1]: ['Digit1', 'Numpad1'],
  [Action.Slot2]: ['Digit2', 'Numpad2'],
  [Action.Slot3]: ['Digit3', 'Numpad3'],
  [Action.NextGadget]: ['KeyE'],
  [Action.PrevGadget]: ['KeyQ'],
  [Action.ToggleGhost]: ['KeyG'],
  [Action.ToggleDebug]: ['Backquote'],
};

/** Keyboard and pointer-locked mouse. The game reads held state and one-shot presses each frame. */
export class InputManager {
  yaw = 0;
  /** Positive looks down. */
  pitch: number = CAMERA_CONFIG.defaultPitch;
  sensitivity = 1;
  invertY = false;
  bindings: Bindings = DEFAULT_BINDINGS;
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
      if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
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

  /** Free-cursor edge turning; call once per frame while playing. */
  update(dt: number): void {
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
