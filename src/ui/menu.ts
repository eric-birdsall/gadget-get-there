import { GADGETS, gadgetDefinition } from '../gadgets/registry';
import type { GadgetId } from '../gadgets/types';
import { type Settings, saveSettings } from '../storage/settings';
import { MAX_SLOTS } from '../game/session';
import { formatTime } from './hud';
import { GADGET_ICONS } from './icons';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface MenuHandlers {
  play: () => void;
  restart: () => void;
  tuning: () => void;
  /** Add `id` to the next free slot, or remove it if it's already in one. Mid-run this restarts. */
  toggleGadget: (id: GadgetId) => void;
  /** Empty every slot. Mid-run this restarts. */
  clearGadgets: () => void;
  settingsChanged: () => void;
}

type NumberKey = 'sensitivity' | 'fov' | 'musicVolume' | 'sfxVolume';
type BoolKey = 'invertY' | 'checkpoints' | 'ghost' | 'shadows';

const percent = (v: number) => `${Math.round(v * 100)}%`;

/** The pause/start overlay: shown whenever the mouse isn't captured. */
export class Menu {
  private readonly overlay = el('overlay');
  private readonly note = el('menu-note');
  private readonly playButton = el<HTMLButtonElement>('play');
  private readonly slotEls: HTMLButtonElement[] = [];
  /** Each gadget's pick button in the palette. */
  private readonly tileEls = new Map<GadgetId, HTMLButtonElement>();
  private loadout: GadgetId[] = [];
  private loadoutKey = '';

  constructor(
    private readonly settings: Settings,
    private readonly handlers: MenuHandlers,
  ) {
    this.playButton.addEventListener('click', handlers.play);
    el('restart').addEventListener('click', handlers.restart);
    el('tuning').addEventListener('click', handlers.tuning);
    el('open-settings').addEventListener('click', () => this.showSettings(true));
    el('close-settings').addEventListener('click', () => this.showSettings(false));

    this.buildLoadoutPicker();

    this.slider('set-sensitivity', 'sensitivity', (v) => v.toFixed(2));
    this.slider('set-fov', 'fov', (v) => `${v}°`);
    this.slider('set-music', 'musicVolume', percent);
    this.slider('set-sfx', 'sfxVolume', percent);
    this.checkbox('set-invert', 'invertY');
    this.checkbox('set-checkpoints', 'checkpoints');
    this.checkbox('set-ghost', 'ghost');
    this.checkbox('set-shadows', 'shadows');
  }

  private changed(): void {
    saveSettings(this.settings);
    this.handlers.settingsChanged();
  }

  private slider(id: string, key: NumberKey, format: (v: number) => string): void {
    const input = el<HTMLInputElement>(id);
    const output = input.nextElementSibling as HTMLOutputElement;
    input.value = String(this.settings[key]);
    output.textContent = format(this.settings[key]);
    input.addEventListener('input', () => {
      this.settings[key] = Number(input.value);
      output.textContent = format(this.settings[key]);
      this.changed();
    });
  }

  private checkbox(id: string, key: BoolKey): void {
    const input = el<HTMLInputElement>(id);
    input.checked = this.settings[key];
    input.addEventListener('change', () => {
      this.settings[key] = input.checked;
      this.changed();
    });
  }

  /** Reflects a setting changed elsewhere (e.g. the G key). */
  syncCheckbox(key: BoolKey): void {
    el<HTMLInputElement>(`set-${key === 'invertY' ? 'invert' : key}`).checked = this.settings[key];
  }

  /**
   * The gadget order: click a gadget to put it in the next free slot; click it again (or click
   * its slot) to take it out, and the slots after it move up.
   */
  private buildLoadoutPicker(): void {
    const palette = el('menu-palette');
    for (const g of GADGETS) {
      // A tile: the gadget button (adds or removes it) and a small "i" that opens its info.
      const tile = document.createElement('div');
      tile.className = 'gadget-tile';
      const pick = document.createElement('button');
      pick.className = 'pick';
      pick.innerHTML = `<span class="icon-square">${GADGET_ICONS[g.id]}<span class="budget"></span></span><span class="name"></span>`;
      pick.querySelector('.name')!.textContent = g.displayName;
      pick.querySelector('.budget')!.textContent = g.budgetLabel;
      pick.addEventListener('click', () => this.handlers.toggleGadget(g.id));
      const info = document.createElement('button');
      info.className = 'info-button';
      info.textContent = 'i';
      info.title = `About the ${g.displayName}`;
      info.setAttribute('aria-label', `About the ${g.displayName}`);
      info.addEventListener('click', () => this.openInfo(g.id));
      tile.append(pick, info);
      this.tileEls.set(g.id, pick);
      palette.append(tile);
    }
    el('info-close').addEventListener('click', () => this.closeInfo());
    // A click on the dimmed backdrop (outside the card) closes it too.
    el('info-modal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) this.closeInfo();
    });

    el('clear-slots').addEventListener('click', () => this.handlers.clearGadgets());

    const row = el('menu-gadgets');
    for (let i = 0; i < MAX_SLOTS; i++) {
      const slot = document.createElement('button');
      slot.className = 'loadout-slot';
      slot.addEventListener('click', () => {
        const id = this.loadout[i];
        if (id) this.handlers.toggleGadget(id);
      });
      this.slotEls.push(slot);
      row.append(slot);
    }
  }

  get infoOpen(): boolean {
    return !el('info-modal').classList.contains('hidden');
  }

  /** The info modal: name, key and budget, a summary, then its stats. */
  openInfo(id: GadgetId): void {
    const g = gadgetDefinition(id);
    const body = el('info-body');
    body.replaceChildren();
    const icon = document.createElement('span');
    icon.className = 'icon-square';
    icon.innerHTML = GADGET_ICONS[id];
    const title = document.createElement('h2');
    title.textContent = g.displayName;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `Key ${g.slot} · ${g.budgetLabel} per run`;
    const summary = document.createElement('p');
    summary.textContent = g.summary;
    const stats = document.createElement('dl');
    for (const [label, value] of g.stats) {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      stats.append(dt, dd);
    }
    body.append(icon, title, meta, summary, stats);
    el('info-modal').classList.remove('hidden');
    el('info-close').focus({ preventScroll: true });
  }

  closeInfo(): void {
    el('info-modal').classList.add('hidden');
  }

  /** Shows the gadget order. Mid-run (`running`), changing it restarts the run. */
  setLoadout(loadout: readonly GadgetId[], running: boolean): void {
    const key = `${loadout.join()}|${running}`;
    if (key === this.loadoutKey) return;
    this.loadoutKey = key;
    this.loadout = [...loadout];
    this.slotEls.forEach((slot, i) => {
      const id = loadout[i];
      slot.classList.toggle('empty', !id);
      if (id) {
        slot.innerHTML =
          `<span class="n">${i + 1}</span><span class="icon-square">${GADGET_ICONS[id]}` +
          `<span class="budget">${gadgetDefinition(id).budgetLabel}</span></span><span class="name"></span>`;
        slot.querySelector('.name')!.textContent = gadgetDefinition(id).displayName;
        slot.title = `Click to take ${gadgetDefinition(id).displayName} out`;
      } else {
        slot.innerHTML = `<span class="n">${i + 1}</span><span class="icon-square empty"></span><span class="name">Empty</span>`;
        slot.title = 'Click a gadget above to fill this slot';
      }
    });
    for (const [id, tile] of this.tileEls) {
      const at = loadout.indexOf(id);
      tile.classList.toggle('chosen', at >= 0);
      tile.title = at >= 0 ? `In slot ${at + 1} · click to take it out` : 'Click to add to the next free slot';
    }
    el<HTMLButtonElement>('clear-slots').disabled = loadout.length === 0;
    el('menu-gadgets-hint').textContent = running
      ? 'Changing gadgets restarts the run'
      : 'Click gadgets to fill the slots · F or scroll switches between them in the run';
  }

  setBest(seconds: number | null): void {
    el('pbs').textContent = seconds === null ? 'No personal best yet' : `Personal best ${formatTime(seconds)}`;
  }

  get settingsOpen(): boolean {
    return el('card').classList.contains('settings-open');
  }

  /** Switches the panel between the main menu and the settings view. */
  showSettings(open: boolean, focus = true): void {
    el('card').classList.toggle('settings-open', open);
    el('settings').classList.toggle('hidden', !open);
    el('card').scrollTop = 0;
    if (focus) (open ? el('close-settings') : el('open-settings')).focus({ preventScroll: true });
  }

  /** `started` switches the button between "Play" and "Resume". */
  show(started: boolean, note = ''): void {
    this.overlay.classList.remove('hidden');
    this.playButton.textContent = started ? 'Resume' : 'Play';
    el('restart').classList.toggle('hidden', !started);
    this.note.textContent = note;
  }

  hide(): void {
    this.showSettings(false, false);
    this.closeInfo();
    // Don't leave a menu button focused, or Space during play would press it.
    (document.activeElement as HTMLElement | null)?.blur();
    this.overlay.classList.add('hidden');
  }
}
