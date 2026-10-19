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
  /** Put gadget `id` in slot `slot` (swapping). */
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
  private readonly slotButtons: HTMLButtonElement[] = [];
  private loadout: GadgetId[] = [];
  private loadoutKey = '';

  constructor(
    private readonly settings: Settings,
    private readonly handlers: MenuHandlers,
  ) {
    this.playButton.addEventListener('click', handlers.play);
    el('restart').addEventListener('click', handlers.restart);
    el('tuning').addEventListener('click', handlers.tuning);

    // One button per slot; clicking swaps the next gadget into it.
    const row = el('menu-gadgets');
    for (let i = 0; i < GADGETS.length; i++) {
      const b = document.createElement('button');
      b.className = 'slot-button';
      b.addEventListener('click', () => {
        const id = this.loadout[i];
        if (id) handlers.placeGadget(cycleGadget(id, 1), i);
      });
      this.slotButtons.push(b);
      row.append(b);
    }

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

  /** Shows the gadget order; `locked` mid-run, when it can't change. */
  setLoadout(loadout: readonly GadgetId[], locked: boolean): void {
    const key = `${loadout.join()}|${locked}`;
    if (key === this.loadoutKey) return;
    this.loadoutKey = key;
    this.loadout = [...loadout];
    this.slotButtons.forEach((b, i) => {
      const id = loadout[i];
      b.innerHTML = `<span class="n">${i + 1}</span>${GADGET_ICONS[id]}<span>${gadgetDefinition(id).displayName}</span>`;
      b.disabled = locked;
      b.title = locked ? 'The order is set for this run · Restart to change it' : 'Click to swap in another gadget';
    });
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
