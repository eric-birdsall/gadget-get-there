import { Action } from './actions';

// An Xbox-style controller through the browser's Gamepad API ("standard" layout), alongside
// the keyboard and mouse. The sticks are fixed (move, look) and Menu pauses; the buttons for the
// other actions can be rebound, one button each.

/** Standard-layout button indices. */
export enum PadButton {
  A = 0,
  B = 1,
  X = 2,
  Y = 3,
  LB = 4,
  RB = 5,
  LT = 6,
  RT = 7,
  View = 8,
  Menu = 9,
  LeftStick = 10,
  RightStick = 11,
  Up = 12,
  Down = 13,
  Left = 14,
  Right = 15,
}

/** Which button does each action while playing (actions left out have none). */
export type PadBindings = Partial<Record<Action, PadButton>>;

/** Actions a controller button can be bound to. Moving and looking are the sticks. */
export const PAD_BINDABLE: readonly Action[] = [
  Action.Jump,
  Action.Crouch,
  Action.UseSlot1,
  Action.UseSlot2,
  Action.UseSlot3,
  Action.Retry,
  Action.ToggleGhost,
];

export const DEFAULT_PAD_BINDINGS: Readonly<PadBindings> = {
  [Action.Jump]: PadButton.A,
  [Action.Crouch]: PadButton.B,
  [Action.UseSlot1]: PadButton.RT,
  [Action.UseSlot2]: PadButton.LT,
  [Action.UseSlot3]: PadButton.RB,
  [Action.Retry]: PadButton.View,
};

/** Menu always pauses, so it can't be bound (like Esc on the keyboard). */
export const PAD_RESERVED: ReadonlySet<PadButton> = new Set([PadButton.Menu]);

/** How a button is written on screen. */
export const PAD_BUTTON_NAMES: Record<PadButton, string> = {
  [PadButton.A]: 'A',
  [PadButton.B]: 'B',
  [PadButton.X]: 'X',
  [PadButton.Y]: 'Y',
  [PadButton.LB]: 'LB',
  [PadButton.RB]: 'RB',
  [PadButton.LT]: 'LT',
  [PadButton.RT]: 'RT',
  [PadButton.View]: 'View',
  [PadButton.Menu]: 'Menu',
  [PadButton.LeftStick]: 'LS click',
  [PadButton.RightStick]: 'RS click',
  [PadButton.Up]: 'D-pad ↑',
  [PadButton.Down]: 'D-pad ↓',
  [PadButton.Left]: 'D-pad ←',
  [PadButton.Right]: 'D-pad →',
};

export function isPadButton(v: unknown): v is PadButton {
  return typeof v === 'number' && Number.isInteger(v) && v in PAD_BUTTON_NAMES;
}

/** Stick travel ignored around the centre (worn sticks rest off-centre). */
const DEADZONE = 0.18;
/** Stick travel past this counts as fully pushed. */
const OUTER = 0.92;
/** How far a trigger must go down to count as pressed. */
const TRIGGER_PRESS = 0.3;

export interface PadState {
  /** Left stick: +1 forward, +1 right. */
  forward: number;
  right: number;
  /** Right stick: +1 turns right, +1 looks up. Curved, so small pushes aim finely. */
  turn: number;
  tilt: number;
  /** Buttons down right now. */
  down: Set<PadButton>;
}

/** A stick's two axes with a round deadzone, rescaled so the usable travel spans 0…1. */
export function stick(x: number, y: number): [number, number] {
  const len = Math.hypot(x, y);
  if (len <= DEADZONE) return [0, 0];
  const mag = Math.min(1, (len - DEADZONE) / (OUTER - DEADZONE));
  return [(x / len) * mag, (y / len) * mag];
}

type PadLike = Pick<Gamepad, 'axes' | 'buttons'>;

/** Reads one controller. Stick y axes point down, so they're flipped. */
export function readPad(pad: PadLike): PadState {
  const [lx, ly] = stick(pad.axes[0] ?? 0, pad.axes[1] ?? 0);
  const [rx, ry] = stick(pad.axes[2] ?? 0, pad.axes[3] ?? 0);
  // Squared look response keeps small pushes fine and full pushes fast.
  const curve = (v: number) => Math.sign(v) * v * v;
  const down = new Set<PadButton>();
  pad.buttons.forEach((b, i) => {
    const isTrigger = i === PadButton.LT || i === PadButton.RT;
    if (isTrigger ? b.value > TRIGGER_PRESS || b.pressed : b.pressed) down.add(i);
  });
  return { forward: -ly, right: lx, turn: curve(rx), tilt: -curve(ry), down };
}

/** The first connected controller, if any. */
export function firstPad(): Gamepad | null {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
  for (const pad of navigator.getGamepads()) if (pad?.connected) return pad;
  return null;
}
