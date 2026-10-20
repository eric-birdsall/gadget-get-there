import { GADGETS, gadgetDefinition } from '../gadgets/registry';
import type { GadgetId } from '../gadgets/types';
import { type Settings, saveSettings } from '../storage/settings';
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
      const tile = document.createElement('button');
      tile.className = 'gadget-tile';
      tile.innerHTML =
        `<span class="icon-square">${GADGET_ICONS[g.id]}<span class="badge"></span>` +
        `<span class="budget"></span></span><span class="name"></span>`;
      tile.querySelector('.name')!.textContent = g.displayName;
      tile.querySelector('.budget')!.textContent = g.budgetLabel;
      tile.addEventListener('click', () => this.handlers.toggleGadget(g.id));
      this.tileEls.set(g.id, tile);
      palette.append(tile);
    }

    el('clear-slots').addEventListener('click', () => this.handlers.clearGadgets());

    const row = el('menu-gadgets');
    for (let i = 0; i < GADGETS.length; i++) {
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
      tile.querySelector('.badge')!.textContent = at >= 0 ? String(at + 1) : '';
      tile.title = at >= 0 ? `In slot ${at + 1} · click to take it out` : 'Click to add to the next free slot';
    }
    el<HTMLButtonElement>('clear-slots').disabled = loadout.length === 0;
    el('menu-gadgets-hint').textContent = running
      ? 'Changing gadgets restarts the run'
      : 'Click gadgets to fill the slots · scroll to switch between them in the run';
  }

  setBest(seconds: number | null): void {
    el('pbs').textContent = seconds === null ? 'No personal best yet' : `Personal best ${formatTime(seconds)}`;
  }

  /** `started` switches the button between "Play" and "Resume". */
  show(started: boolean, note = ''): void {
    this.overlay.classList.remove('hidden');
    this.playButton.textContent = started ? 'Resume' : 'Play';
    el('restart').classList.toggle('hidden', !started);
    this.note.textContent = note;
  }

  hide(): void {
    this.overlay.classList.add('hidden');
  }
}
