import { Action, type Bindings, DEFAULT_BINDINGS, MAX_KEYS_PER_ACTION } from '../input/input';
import { readJson, writeJson } from './settings';

// Custom key bindings, saved apart from the other settings so a bad save can't reset those.

const BINDINGS_KEY = 'gadget-get-there.bindings';
const BINDINGS_VERSION = 1;

export function defaultBindings(): Bindings {
  const out = {} as Bindings;
  for (const a of Object.values(Action)) out[a] = [...DEFAULT_BINDINGS[a]];
  return out;
}

/** Saved bindings over the defaults; any action saved wrongly keeps its default keys. */
export function loadBindings(): Bindings {
  const out = defaultBindings();
  const saved = readJson(BINDINGS_KEY) as { version?: number; data?: unknown } | null;
  if (!saved || saved.version !== BINDINGS_VERSION || !saved.data || typeof saved.data !== 'object') return out;
  const data = { ...(saved.data as Record<string, unknown>) };
  // Before per-slot use keys there was one "use gadget" key: it becomes slot 1's.
  if (!(Action.UseSlot1 in data) && 'gadget' in data) data[Action.UseSlot1] = data.gadget;
  const fromSave = new Set<Action>();
  for (const a of Object.values(Action)) {
    const keys = data[a];
    if (Array.isArray(keys) && keys.length <= MAX_KEYS_PER_ACTION && keys.every((k) => typeof k === 'string' && k !== '' && k !== 'Escape')) {
      out[a] = [...new Set(keys as string[])];
      fromSave.add(a);
    }
  }
  // A default key the player has put on something else stays there.
  const taken = new Set([...fromSave].flatMap((a) => out[a]));
  for (const a of Object.values(Action)) if (!fromSave.has(a)) out[a] = out[a].filter((k) => !taken.has(k));
  return out;
}

export function saveBindings(bindings: Bindings): void {
  writeJson(BINDINGS_KEY, { version: BINDINGS_VERSION, data: bindings });
}

/**
 * Puts `code` on `action` in position `index` (0 main, 1 alternate). The key leaves any other
 * action it was on, so one key never does two things. Returns the actions it was taken from.
 */
export function bindKey(bindings: Bindings, action: Action, index: number, code: string): Action[] {
  const taken: Action[] = [];
  for (const a of Object.values(Action)) {
    if (a === action) continue;
    const at = bindings[a].indexOf(code);
    if (at >= 0) {
      bindings[a].splice(at, 1);
      taken.push(a);
    }
  }
  const keys = [...bindings[action]];
  const at = Math.min(index, keys.length);
  keys[at] = code;
  // If it was already this action's other key, it just moves here.
  bindings[action] = keys.filter((k, i) => k !== code || i === at).slice(0, MAX_KEYS_PER_ACTION);
  return taken;
}

/** Empties position `index` of `action`. */
export function clearKey(bindings: Bindings, action: Action, index: number): void {
  bindings[action] = bindings[action].filter((_, i) => i !== index);
}
