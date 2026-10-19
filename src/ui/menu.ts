import { GADGETS } from '../gadgets/registry';
import type { GadgetId } from '../gadgets/types';
import { type Settings, saveSettings } from '../storage/settings';
import { formatTime } from './hud';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface MenuHandlers {
  play: () => void;
  restart: () => void;
  tuning: () => void;
  selectGadget: (id: GadgetId) => void;
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
  private readonly gadgetButtons = new Map<GadgetId, HTMLButtonElement>();

  constructor(
    private readonly settings: Settings,
    private readonly handlers: MenuHandlers,
  ) {
    this.playButton.addEventListener('click', handlers.play);
    el('restart').addEventListener('click', handlers.restart);
    el('tuning').addEventListener('click', handlers.tuning);

    const row = el('menu-gadgets');
    for (const g of GADGETS) {
      const b = document.createElement('button');
      b.textContent = `${g.slot} · ${g.displayName}`;
      b.addEventListener('click', () => handlers.selectGadget(g.id));
      this.gadgetButtons.set(g.id, b);
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

  setGadget(active: GadgetId, next: GadgetId): void {
    for (const [id, b] of this.gadgetButtons) {
      b.classList.toggle('selected', id === next);
      b.title = id === next && next !== active ? 'Used from your next run' : '';
    }
  }

  setBests(on: number | null, off: number | null): void {
    const t = (v: number | null) => (v === null ? '—' : formatTime(v));
    el('pbs').textContent = `Best · checkpoints on ${t(on)} · checkpoints off ${t(off)}`;
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
