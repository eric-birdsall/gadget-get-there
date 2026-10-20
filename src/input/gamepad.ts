import { Action } from './actions';

// An Xbox-style controller through the browser's Gamepad API ("standard" layout). The mapping
// is fixed; the keyboard and mouse keep working alongside it.

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

/** Buttons that act as game actions while playing. */
export const PAD_ACTIONS: readonly [PadButton, Action][] = [
  [PadButton.A, Action.Jump],
  [PadButton.B, Action.Crouch],
  [PadButton.RT, Action.UseSlot1],
  [PadButton.LT, Action.UseSlot2],
  [PadButton.RB, Action.UseSlot3],
  [PadButton.View, Action.Retry],
];

/** How each mapped action's button is written on screen, while playing with the controller. */
export const PAD_LABELS: Partial<Record<Action, string>> = {
  [Action.Jump]: 'A',
  [Action.Crouch]: 'B',
  [Action.UseSlot1]: 'RT',
  [Action.UseSlot2]: 'LT',
  [Action.UseSlot3]: 'RB',
  [Action.Retry]: 'View',
};

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
