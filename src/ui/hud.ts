import type { MedalThresholds } from '../course/types';
import { GADGETS, gadgetDefinition } from '../gadgets/registry';
import type { GadgetId } from '../gadgets/types';
import { Medal } from '../game/medals';
import { AttemptState } from '../game/session';

const el = (id: string) => document.getElementById(id)!;

/** MM:SS.mmm */
export function formatTime(seconds: number): string {
  const ms = Math.floor(seconds * 1000 + 1e-6);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rest = ms % 1000;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(rest).padStart(3, '0')}`;
}

/** +1.234 / −0.512 */
export function formatDelta(seconds: number): string {
  const sign = seconds < 0 ? '−' : '+';
  return `${sign}${Math.abs(seconds).toFixed(3)}`;
}

const MEDAL_LABELS: Record<Medal, string> = {
  [Medal.Gold]: 'Gold',
  [Medal.Silver]: 'Silver',
  [Medal.Bronze]: 'Bronze',
  [Medal.None]: 'Finished',
};

export interface DebugInfo {
  speed: number;
  hSpeed: number;
  vSpeed: number;
  grounded: boolean;
  state: AttemptState;
  fps: number;
  y: number;
}

export interface FinishInfo {
  seconds: number;
  medal: Medal;
  previousBest: number | null;
  newBest: boolean;
  gadget: GadgetId;
  checkpoints: boolean;
  thresholds: MedalThresholds;
}

export class Hud {
  private readonly timer = el('timer');
  private readonly pbLine = el('pb-line');
  private readonly hint = el('hint');
  private readonly toast = el('toast');
  private readonly crosshair = el('crosshair');
  private readonly slots = el('slots');
  private readonly gadgetHint = el('gadget-hint');
  private readonly debug = el('debug');
  private readonly freeCursor = el('free-cursor');
  private readonly result = el('result');
  private lastTimer = '';
  private lastGadgetKey = '';
  private toastTimer = 0;

  constructor() {
    for (const g of GADGETS) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.dataset.gadget = g.id;
      slot.innerHTML = `<span class="key">${g.slot}</span><span></span>`;
      slot.lastElementChild!.textContent = g.displayName;
      this.slots.append(slot);
    }
  }

  update(state: AttemptState, elapsed: number): void {
    const text = formatTime(elapsed);
    if (text !== this.lastTimer) {
      this.timer.textContent = text;
      this.lastTimer = text;
    }
    this.hint.classList.toggle('show', state === AttemptState.Ready);
  }

  /** The best for the current category, under the timer. */
  setPersonalBest(seconds: number | null, checkpoints: boolean): void {
    const mode = checkpoints ? 'checkpoints on' : 'checkpoints off';
    this.pbLine.textContent = seconds === null ? `No best yet · ${mode}` : `PB ${formatTime(seconds)} · ${mode}`;
  }

  /** Highlights the gadget in use; a different choice made mid-run shows as queued. */
  setGadgets(active: GadgetId, next: GadgetId): void {
    const key = `${active}|${next}`;
    if (key === this.lastGadgetKey) return;
    this.lastGadgetKey = key;
    for (const slot of this.slots.children as HTMLCollectionOf<HTMLElement>) {
      slot.classList.toggle('active', slot.dataset.gadget === active);
      slot.classList.toggle('queued', next !== active && slot.dataset.gadget === next);
    }
    this.gadgetHint.textContent =
      next !== active ? `${gadgetDefinition(next).displayName} next run · R to retry now` : gadgetDefinition(active).actionHint;
  }

  setCrosshairLocked(locked: boolean): void {
    this.crosshair.classList.toggle('locked', locked);
  }

  showToast(text: string, seconds = 1.2): void {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('show'), seconds * 1000);
  }

  showResult(info: FinishInfo | null): void {
    this.result.classList.toggle('hidden', !info);
    if (!info) return;
    el('result-time').textContent = formatTime(info.seconds);
    const medal = el('result-medal');
    medal.className = info.medal;
    medal.textContent = MEDAL_LABELS[info.medal];
    el('result-new').classList.toggle('hidden', !info.newBest);
    const rows = el('result-rows');
    rows.replaceChildren();
    const row = (label: string, value: string, cls = '') => {
      const l = document.createElement('div');
      l.textContent = label;
      const v = document.createElement('div');
      v.className = `v ${cls}`;
      v.textContent = value;
      rows.append(l, v);
    };
    if (info.previousBest !== null) {
      const best = Math.min(info.previousBest, info.seconds);
      row('Personal best', formatTime(best));
      const delta = info.seconds - info.previousBest;
      row('vs previous best', formatDelta(delta), delta < 0 ? 'delta-good' : 'delta-bad');
    } else {
      row('Personal best', formatTime(info.seconds));
    }
    el('result-meta').textContent = `${gadgetDefinition(info.gadget).displayName} · checkpoints ${info.checkpoints ? 'on' : 'off'}`;
    const t = info.thresholds;
    el('result-targets').textContent = `Gold ${t.goldSeconds}s · Silver ${t.silverSeconds}s · Bronze ${t.bronzeSeconds}s`;
  }

  setFreeCursorNotice(visible: boolean): void {
    this.freeCursor.classList.toggle('hidden', !visible);
  }

  setDebugVisible(visible: boolean): void {
    this.debug.classList.toggle('hidden', !visible);
  }

  updateDebug(d: DebugInfo): void {
    if (this.debug.classList.contains('hidden')) return;
    this.debug.textContent =
      `speed   ${d.speed.toFixed(1)} m/s\n` +
      `horiz   ${d.hSpeed.toFixed(1)}\n` +
      `vert    ${d.vSpeed.toFixed(1)}\n` +
      `height  ${d.y.toFixed(1)}\n` +
      `ground  ${d.grounded ? 'yes' : 'no'}\n` +
      `state   ${d.state}\n` +
      `fps     ${d.fps.toFixed(0)}`;
  }
}
