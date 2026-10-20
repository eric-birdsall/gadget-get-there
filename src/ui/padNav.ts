import { PadButton, type PadState } from '../input/gamepad';

// Moving round the menus with the controller: the D-pad or left stick moves focus to the
// nearest control in that direction (left/right adjusts a focused slider or dropdown), A presses
// it, B goes back, Y opens a gadget's info. Each gadget is one stop: its small "i" button is
// skipped (Y does its job), so it can't steal moves meant for the gadgets and levels around it.

type Dir = 'up' | 'down' | 'left' | 'right';

/** A held direction repeats after this long, then this often, s. */
const REPEAT_DELAY = 0.4;
const REPEAT_EVERY = 0.13;
/** Left stick travel that counts as a direction. */
const STICK_DIR = 0.55;

export interface PadNavHandlers {
  /** The element to navigate inside right now (a modal, or the menu card). */
  root: () => HTMLElement;
  /** Press a control (A). */
  activate: (el: HTMLElement) => void;
  /** Go back a level (B). */
  back: () => void;
}

export class PadNav {
  private held: Dir | null = null;
  private heldFor = 0;
  private nextRepeat = 0;
  /** Where the highlight was in each view, to put it back on returning (closing a pop-up). */
  private readonly lastIn = new WeakMap<HTMLElement, HTMLElement>();
  private root: HTMLElement | null = null;

  constructor(private readonly h: PadNavHandlers) {}

  /** Call once per frame while a menu is up. */
  update(dt: number, pad: PadState | null, edges: ReadonlySet<PadButton>): void {
    if (!pad) return;
    this.trackRoot();
    const dir = direction(pad);
    if (dir !== this.held) {
      this.held = dir;
      this.heldFor = 0;
      this.nextRepeat = REPEAT_DELAY;
      if (dir) this.move(dir);
    } else if (dir) {
      this.heldFor += dt;
      if (this.heldFor >= this.nextRepeat) {
        this.nextRepeat += REPEAT_EVERY;
        this.move(dir);
      }
    }
    if (edges.has(PadButton.A)) this.press();
    if (edges.has(PadButton.B)) this.h.back();
    if (edges.has(PadButton.Y)) this.info();
    this.trackRoot();
    // Views that change (Back, a modal opening) move focus themselves: keep the highlight on it.
    const list = this.controls();
    if (!list.some((el) => el.classList.contains('pad-focus'))) {
      const a = document.activeElement as HTMLElement | null;
      if (a && list.includes(a)) mark(a);
    }
  }

  /** Puts focus on `el` (e.g. Play when the menu opens), if it's showing. */
  focus(el: HTMLElement): void {
    if (visible(el)) mark(el);
  }

  private controls(): HTMLElement[] {
    return [...this.h.root().querySelectorAll<HTMLElement>('button, input, select')].filter(
      (el) => visible(el) && !(el as HTMLButtonElement).disabled && !el.classList.contains('info-button'),
    );
  }

  /** On moving between views (a pop-up opening or closing), remembers and restores the highlight. */
  private trackRoot(): void {
    const root = this.h.root();
    if (root === this.root) return;
    const marked = this.root?.querySelector<HTMLElement>('.pad-focus');
    if (this.root && marked) this.lastIn.set(this.root, marked);
    this.root = root;
    const back = this.lastIn.get(root);
    if (back && visible(back)) mark(back);
  }

  /** Y on a gadget: its info button. */
  private info(): void {
    const el = this.current(this.controls());
    const button = el?.closest('.gadget-tile')?.querySelector<HTMLElement>('.info-button');
    if (button) this.h.activate(button);
  }

  /** The control the controller is on: the marked one, else whatever has focus. */
  private current(list: HTMLElement[]): HTMLElement | null {
    const marked = list.find((el) => el.classList.contains('pad-focus'));
    if (marked) return marked;
    const a = document.activeElement as HTMLElement | null;
    return a && list.includes(a) ? a : null;
  }

  private press(): void {
    const list = this.controls();
    const el = this.current(list);
    if (!el) return this.land(list[0]);
    if (el instanceof HTMLSelectElement) return stepSelect(el, 1);
    // A slider has nothing to press: left/right moves it.
    if (el instanceof HTMLInputElement && el.type === 'range') return;
    this.h.activate(el);
  }

  private move(dir: Dir): void {
    const list = this.controls();
    const el = this.current(list);
    if (!el) return this.land(list[0]);
    const sideways = dir === 'left' || dir === 'right';
    if (sideways && el instanceof HTMLInputElement && el.type === 'range') {
      if (dir === 'left') el.stepDown();
      else el.stepUp();
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (sideways && el instanceof HTMLSelectElement) return stepSelect(el, dir === 'left' ? -1 : 1);
    this.land(nearest(el, list, dir));
  }

  private land(el: HTMLElement | null | undefined): void {
    if (!el) return;
    mark(el);
    el.scrollIntoView({ block: 'nearest' });
  }
}

/**
 * Focuses `el` and marks it with a class too, so the highlight shows even while the window
 * itself isn't focused (where :focus doesn't match).
 */
function mark(el: HTMLElement): void {
  for (const old of document.querySelectorAll('.pad-focus')) old.classList.remove('pad-focus');
  el.classList.add('pad-focus');
  el.focus({ preventScroll: true });
}

function visible(el: HTMLElement): boolean {
  return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
}

function direction(pad: PadState): Dir | null {
  const d = pad.down;
  if (d.has(PadButton.Up)) return 'up';
  if (d.has(PadButton.Down)) return 'down';
  if (d.has(PadButton.Left)) return 'left';
  if (d.has(PadButton.Right)) return 'right';
  const { forward: f, right: r } = pad;
  if (Math.max(Math.abs(f), Math.abs(r)) < STICK_DIR) return null;
  if (Math.abs(f) >= Math.abs(r)) return f > 0 ? 'up' : 'down';
  return r > 0 ? 'right' : 'left';
}

function stepSelect(el: HTMLSelectElement, step: number): void {
  const n = el.options.length;
  el.selectedIndex = (el.selectedIndex + step + n) % n;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * The control to move to. Controls in line with this one (sharing some of its row for left and
 * right, or its column for up and down) come first, the closest of them; only with none in line
 * does it move off to the side, to the nearest weighing sideways distance heavily.
 */
export function nearest(from: HTMLElement, list: readonly HTMLElement[], dir: Dir): HTMLElement | null {
  const a = from.getBoundingClientRect();
  const horizontal = dir === 'left' || dir === 'right';
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of list) {
    if (el === from) continue;
    const b = el.getBoundingClientRect();
    // Gap from this control's edge to the other's, in the direction of travel.
    const gap = dir === 'right' ? b.left - a.right : dir === 'left' ? a.left - b.right : dir === 'down' ? b.top - a.bottom : a.top - b.bottom;
    // The other's centre must lie that way, and it must not sit mostly behind this one's edge.
    const centre = horizontal ? b.left + b.width / 2 - (a.left + a.width / 2) : b.top + b.height / 2 - (a.top + a.height / 2);
    if ((dir === 'right' || dir === 'down' ? centre : -centre) <= 4 || gap < -Math.min(a.width, a.height) / 2) continue;
    const overlap = horizontal
      ? Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      : Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const across = horizontal
      ? Math.abs(b.top + b.height / 2 - (a.top + a.height / 2))
      : Math.abs(b.left + b.width / 2 - (a.left + a.width / 2));
    // In line: ranked by distance alone, always ahead of anything off to the side.
    const score = overlap > 0 ? Math.max(0, gap) + across * 0.1 : 1e6 + Math.max(0, gap) + across * 3;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}
