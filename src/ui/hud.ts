import type { MedalThresholds } from '../course/types';
import { GADGETS, gadgetDefinition } from '../gadgets/registry';
import type { GadgetId } from '../gadgets/types';
import { Medal } from '../game/medals';
import { ABILITY_CONFIG } from '../config';
import { AttemptState } from '../game/session';
import { Action, type Bindings, USE_ACTIONS, device, keyName, useKeysName } from '../input/input';
import { GADGET_ICONS } from './icons';

const el = (id: string) => document.getElementById(id)!;

/** MM:SS.mmm */
export function formatTime(seconds: number): string {
  const ms = Math.floor(seconds * 1000 + 1e-6);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rest = ms % 1000;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(rest).padStart(3, '0')}`;
}

/**
 * Shows a time in the display face. Its digits differ in width, so each sits in a fixed-width
 * cell and a running clock doesn't wobble.
 */
export function setClockText(el: HTMLElement, text: string): void {
  el.innerHTML = [...text].map((c) => `<span class="${/\d/.test(c) ? 'cd' : 'cs'}">${c}</span>`).join('');
  el.setAttribute('aria-label', text);
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
  loadout: GadgetId[];
  checkpoints: boolean;
  thresholds: MedalThresholds;
}

/** Icons for a gadget order, left to right, for the finish card and menus. */
export function loadoutIcons(loadout: readonly GadgetId[]): string {
  return loadout.map((id) => `<span class="mini-icon" title="${gadgetDefinition(id).displayName}">${GADGET_ICONS[id]}</span>`).join('');
}



export class Hud {
  private readonly timer = el('timer');
  private readonly pbLine = el('pb-line');
  private readonly hint = el('hint');
  private readonly toast = el('toast');
  private readonly crosshair = el('crosshair');
  private readonly slideRing = el('slide-ring');
  private readonly slideArc = document.querySelector<SVGCircleElement>('#slide-ring .arc')!;
  private lastSlideKey = -2;
  private readonly stamina = el('stamina');
  private readonly staminaFill = document.querySelector<HTMLElement>('#stamina .fill')!;
  private readonly speedLines = el('speed-lines');
  private lastStaminaKey = -1;
  private readonly slots = el('slots');
  private readonly gadgetHint = el('gadget-hint');
  private readonly debug = el('debug');
  private readonly freeCursor = el('free-cursor');
  private readonly result = el('result');
  private lastTimer = '';
  private lastGadgetKey = '';
  private toastTimer = 0;

  private readonly slotEls: HTMLElement[] = [];

  constructor(private readonly bindings: Bindings) {
    for (let i = 0; i < GADGETS.length; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.innerHTML =
        `<span class="icon-square"><svg class="ring" viewBox="0 0 56 56"><rect x="2" y="2" width="52" height="52" rx="7" pathLength="100"/></svg>` +
        `<span class="icon"></span><span class="key"></span></span><span class="label"></span>`;
      this.slotEls.push(slot);
      this.slots.append(slot);
    }
    this.refreshKeys();
  }

  /** Rewrites every key shown on screen; call after the bindings change. */
  refreshKeys(): void {
    const b = this.bindings;
    el('hint').textContent = 'Move to start the clock';
    const pad = device.current === 'pad';
    el('controls-hint').textContent = pad
      ? `${keyName(b, Action.Retry)} retry · Menu pause`
      : `${keyName(b, Action.Retry)} retry · ${keyName(b, Action.ToggleGhost)} ghost · Esc pause`;
    el('result-retry').textContent = `${keyName(b, Action.Retry)} to go again · ${pad ? 'Menu' : 'Esc'} to change gadgets`;
    this.lastGadgetKey = '';
    for (const slot of this.slotEls) delete slot.dataset.gadget;
  }

  update(state: AttemptState, elapsed: number): void {
    const text = formatTime(elapsed);
    if (text !== this.lastTimer) {
      setClockText(this.timer, text);
      this.lastTimer = text;
    }
    this.hint.classList.toggle('show', state === AttemptState.Ready);
  }

  /** The level's best, under the timer. */
  setPersonalBest(seconds: number | null): void {
    this.pbLine.textContent = seconds === null ? 'No best yet' : `PB ${formatTime(seconds)}`;
  }

  /**
   * The chosen gadgets in slot order, each with its use key, its budget left underneath and its
   * outline counting down; glowing while it works, crossed out once used up.
   */
  setGadgets(loadout: readonly GadgetId[], active: readonly boolean[], remaining: readonly number[], labels: readonly string[], ready: boolean): void {
    const key = `${loadout.join()}|${active.join()}|${labels.join()}|${ready}`;
    if (key === this.lastGadgetKey) return;
    this.lastGadgetKey = key;
    // Only chosen gadgets get a slot on screen.
    this.slotEls.forEach((el, i) => el.classList.toggle('hidden', i >= loadout.length));
    loadout.forEach((id, i) => {
      const el = this.slotEls[i];
      if (el.dataset.gadget !== id) {
        el.dataset.gadget = id;
        el.querySelector('.icon')!.innerHTML = GADGET_ICONS[id];
        el.querySelector('.key')!.textContent = keyName(this.bindings, USE_ACTIONS[i]);
        el.title = gadgetDefinition(id).displayName;
      }
      const left = remaining[i] ?? 1;
      el.querySelector('.label')!.textContent = labels[i] ?? '';
      el.classList.toggle('active', !!active[i]);
      el.classList.toggle('used', left <= 0);
      // The outline traces down as the budget is spent.
      const ring = el.querySelector<SVGRectElement>('.ring rect')!;
      ring.style.strokeDasharray = '100';
      ring.style.strokeDashoffset = `${100 * (1 - left)}`;
    });
    // Start line only: the badges say it all during the run.
    const b = this.bindings;
    this.gadgetHint.textContent = !ready
      ? ''
      : loadout.length === 0
        ? `No gadgets · ${device.current === 'pad' ? 'Menu' : 'Esc'} to pick some`
        : loadout.length === 1
          ? `${useKeysName(b, 1)} uses your gadget`
          : `${useKeysName(b, loadout.length)} use your gadgets`;
  }

  /** Sprint stamina above the gadgets: shown while sprinting or refilling, hidden when full. */
  setStamina(stamina: number, sprinting: boolean): void {
    const key = Math.round(stamina * 200) * 2 + (sprinting ? 1 : 0);
    if (key === this.lastStaminaKey) return;
    this.lastStaminaKey = key;
    this.stamina.classList.toggle('show', sprinting || stamina < 0.999);
    this.stamina.classList.toggle('sprinting', sprinting);
    this.stamina.classList.toggle('low', stamina < ABILITY_CONFIG.sprintMinToStart);
    this.speedLines.classList.toggle('show', sprinting);
    this.staminaFill.style.transform = `scaleX(${stamina})`;
  }

  /** Ring round the crosshair while sliding: 0…1 fills, 1 glows (jump now for a burst), −1 hides. */
  setSlideCharge(charge: number): void {
    // Floor, not round: 99% and full must differ, or the ready glow would never show.
    const key = charge < 0 ? -1 : charge >= 1 ? 51 : Math.floor(charge * 50);
    if (key === this.lastSlideKey) return;
    this.lastSlideKey = key;
    this.slideRing.classList.toggle('show', charge >= 0);
    this.slideRing.classList.toggle('ready', charge >= 1);
    if (charge >= 0) this.slideArc.style.strokeDashoffset = `${100 * (1 - charge)}`;
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
    setClockText(el('result-time'), formatTime(info.seconds));
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
    el('result-meta').innerHTML = `${loadoutIcons(info.loadout)}<span>checkpoints ${info.checkpoints ? 'on' : 'off'}</span>`;
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
