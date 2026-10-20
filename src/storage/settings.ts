// Versioned local saves. Anything missing, corrupt or from another version falls back to
// defaults: the game must always be playable without storage.

const SETTINGS_KEY = 'gadget-get-there.settings';
const SETTINGS_VERSION = 1;

export interface Settings {
  sensitivity: number;
  invertY: boolean;
  /** Keyboard look turn speed, ×. */
  keyLookSpeed: number;
  /** After looking up/down with keys, ease back to level. */
  autoLevel: boolean;
  /** Base field of view, degrees; it still widens with speed. */
  fov: number;
  musicVolume: number;
  sfxVolume: number;
  showDebug: boolean;
  checkpoints: boolean;
  ghost: boolean;
  shadows: boolean;
  /** Last gadget order, comma-separated, restored next visit. */
  loadout: string;
  /** Last level played, by id. */
  level: string;
  /** What to play with: 'keys' (mouse and keyboard) or 'pad' (controller). The other is ignored. */
  inputMode: string;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  invertY: false,
  keyLookSpeed: 1,
  autoLevel: true,
  fov: 75,
  musicVolume: 0.5,
  sfxVolume: 0.8,
  showDebug: false,
  checkpoints: true,
  ghost: true,
  shadows: true,
  loadout: 'grapple,jetpack,dash',
  level: 'the-crossing',
  inputMode: 'keys',
};

export function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows and full storage: keep playing without saving.
  }
}

/** Copies fields of the right type from `saved` over `defaults`. */
export function mergeKnown<T extends object>(defaults: T, saved: unknown): T {
  const out = { ...defaults };
  if (!saved || typeof saved !== 'object') return out;
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const v = (saved as Record<string, unknown>)[key as string];
    if (typeof v === typeof defaults[key] && (typeof v !== 'number' || Number.isFinite(v))) out[key] = v as T[keyof T];
  }
  return out;
}

export function loadSettings(): Settings {
  const saved = readJson(SETTINGS_KEY) as { version?: number; data?: unknown } | null;
  if (!saved || saved.version !== SETTINGS_VERSION) return { ...DEFAULT_SETTINGS };
  return mergeKnown(DEFAULT_SETTINGS, saved.data);
}

export function saveSettings(settings: Settings): void {
  writeJson(SETTINGS_KEY, { version: SETTINGS_VERSION, data: settings });
}
