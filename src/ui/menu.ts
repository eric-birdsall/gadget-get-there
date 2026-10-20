import { GADGETS, cycleGadget, gadgetDefinition } from '../gadgets/registry';
import type { GadgetId } from '../gadgets/types';
import { type Settings, saveSettings } from '../storage/settings';
import { formatTime } from './hud';
import { GADGET_ICONS } from './icons';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface MenuHandlers {
  play: () => void;
  restart: () => void;
  tuning: () => void;
  /** Put gadget `id` in slot `slot` (swapping). Mid-run this restarts the run. */
  placeGadget: (id: GadgetId, slot: number) => void;
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
  private readonly slotEls: HTMLElement[] = [];
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
   * The gadget order: drag a gadget from the palette (or from another slot) onto a numbered
   * slot to put it there; whatever was there swaps places. Clicking a slot cycles it, as a
   * fallback for anyone who'd rather not drag.
   */
  private buildLoadoutPicker(): void {
    const palette = el('menu-palette');
    for (const g of GADGETS) {
      const tile = document.createElement('div');
      tile.className = 'gadget-tile';
      tile.draggable = true;
      tile.dataset.gadget = g.id;
      tile.title = `Drag ${g.displayName} onto a slot`;
      tile.innerHTML = `${GADGET_ICONS[g.id]}<span class="name"></span>`;
      tile.querySelector('.name')!.textContent = g.displayName;
      this.dragSource(tile, () => g.id);
      palette.append(tile);
    }

    const row = el('menu-gadgets');
    for (let i = 0; i < GADGETS.length; i++) {
      const slot = document.createElement('div');
      slot.className = 'loadout-slot';
      slot.draggable = true;
      slot.tabIndex = 0;
      slot.setAttribute('role', 'button');
      this.dragSource(slot, () => this.loadout[i]);
      slot.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        slot.classList.add('drop-target');
      });
      slot.addEventListener('dragleave', () => slot.classList.remove('drop-target'));
      slot.addEventListener('drop', (e) => {
        e.preventDefault();
        slot.classList.remove('drop-target');
        const id = e.dataTransfer?.getData('text/plain');
        if (id && GADGETS.some((g) => g.id === id)) this.handlers.placeGadget(id as GadgetId, i);
      });
      const cycle = () => {
        const id = this.loadout[i];
        if (id) this.handlers.placeGadget(cycleGadget(id, 1), i);
      };
      slot.addEventListener('click', cycle);
      slot.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          cycle();
        }
      });
      this.slotEls.push(slot);
      row.append(slot);
    }
  }

  private dragSource(node: HTMLElement, id: () => GadgetId | undefined): void {
    node.addEventListener('dragstart', (e) => {
      const g = id();
      if (!g || !e.dataTransfer) return;
      e.dataTransfer.setData('text/plain', g);
      e.dataTransfer.effectAllowed = 'move';
      document.body.classList.add('dragging-gadget');
    });
    node.addEventListener('dragend', () => document.body.classList.remove('dragging-gadget'));
  }

  /** Shows the gadget order. Mid-run (`running`), changing it restarts the run. */
  setLoadout(loadout: readonly GadgetId[], running: boolean): void {
    const key = `${loadout.join()}|${running}`;
    if (key === this.loadoutKey) return;
    this.loadoutKey = key;
    this.loadout = [...loadout];
    this.slotEls.forEach((slot, i) => {
      const id = loadout[i];
      slot.dataset.gadget = id;
      slot.innerHTML = `<span class="n">${i + 1}</span>${GADGET_ICONS[id]}<span class="name"></span>`;
      slot.querySelector('.name')!.textContent = gadgetDefinition(id).displayName;
      slot.title = `Slot ${i + 1}: ${gadgetDefinition(id).displayName} · drop a gadget here, or click to cycle`;
    });
    el('menu-gadgets-hint').textContent = running
      ? 'Changing the order restarts the run'
      : 'Drag gadgets into the slots · each is used once, in order';
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
