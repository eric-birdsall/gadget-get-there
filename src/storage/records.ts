import { type GhostData, isValidGhost } from '../game/ghost';
import { isGadgetId } from '../gadgets/registry';
import type { GadgetId } from '../gadgets/types';
import { readJson, writeJson } from './settings';

// Personal bests: one per level, with the gadget order used and the ghost.

const RECORDS_KEY = 'gadget-get-there.records';
/** v1 kept one-gadget bests per checkpoint mode; those runs aren't comparable, so they're dropped. */
const RECORDS_VERSION = 2;

export interface PersonalBest {
  seconds: number;
  /** Gadget order used. */
  loadout: GadgetId[];
  checkpoints: boolean;
  /** Epoch ms. */
  date: number;
  ghost: GhostData | null;
}

type RecordTable = Record<string, PersonalBest>;

function isValidBest(v: unknown): v is PersonalBest {
  if (!v || typeof v !== 'object') return false;
  const b = v as PersonalBest;
  return (
    typeof b.seconds === 'number' &&
    Number.isFinite(b.seconds) &&
    b.seconds > 0 &&
    Array.isArray(b.loadout)
  );
}

/** Loads and validates every record; anything corrupt is dropped, not fatal. */
function load(): RecordTable {
  const saved = readJson(RECORDS_KEY) as { version?: number; levels?: unknown } | null;
  if (!saved || saved.version !== RECORDS_VERSION || !saved.levels || typeof saved.levels !== 'object') return {};
  const out: RecordTable = {};
  for (const [level, best] of Object.entries(saved.levels as Record<string, unknown>)) {
    if (!isValidBest(best)) continue;
    out[level] = {
      seconds: best.seconds,
      // Gadgets that no longer exist (rollerblades) drop out; the time stays.
      loadout: best.loadout.filter(isGadgetId),
      checkpoints: best.checkpoints === true,
      date: typeof best.date === 'number' ? best.date : 0,
      ghost: isValidGhost(best.ghost) ? best.ghost : null,
    };
  }
  return out;
}

export class RecordStore {
  private table: RecordTable = load();

  best(levelId: string): PersonalBest | null {
    return this.table[levelId] ?? null;
  }

  /**
   * Saves `run` if it beats the stored best (or there is none). Slower runs change nothing,
   * ghost included. Returns whether it was a new best.
   */
  submit(levelId: string, run: PersonalBest): boolean {
    const prev = this.best(levelId);
    if (prev && run.seconds >= prev.seconds) return false;
    // Write the whole table at once so the time and its ghost always match.
    this.table = { ...this.table, [levelId]: run };
    writeJson(RECORDS_KEY, { version: RECORDS_VERSION, levels: this.table });
    return true;
  }
}
