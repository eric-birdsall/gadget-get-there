import { type GhostData, isValidGhost } from '../game/ghost';
import { type GadgetId } from '../gadgets/types';
import { isGadgetId } from '../gadgets/registry';
import { readJson, writeJson } from './settings';

// Personal bests: one per course and checkpoint mode, with the gadget used and the ghost.

const RECORDS_KEY = 'gadget-get-there.records';
const RECORDS_VERSION = 1;

export enum CheckpointMode {
  On = 'checkpoints-on',
  Off = 'checkpoints-off',
}

export function checkpointMode(enabled: boolean): CheckpointMode {
  return enabled ? CheckpointMode.On : CheckpointMode.Off;
}

export interface PersonalBest {
  seconds: number;
  gadget: GadgetId;
  /** Epoch ms. */
  date: number;
  ghost: GhostData | null;
}

type RecordTable = Record<string, Partial<Record<CheckpointMode, PersonalBest>>>;

function isValidBest(v: unknown): v is PersonalBest {
  if (!v || typeof v !== 'object') return false;
  const b = v as PersonalBest;
  return typeof b.seconds === 'number' && Number.isFinite(b.seconds) && b.seconds > 0 && isGadgetId(b.gadget);
}

/** Loads and validates every record; anything corrupt is dropped, not fatal. */
function load(): RecordTable {
  const saved = readJson(RECORDS_KEY) as { version?: number; courses?: unknown } | null;
  if (!saved || saved.version !== RECORDS_VERSION || !saved.courses || typeof saved.courses !== 'object') return {};
  const out: RecordTable = {};
  for (const [course, modes] of Object.entries(saved.courses as Record<string, unknown>)) {
    if (!modes || typeof modes !== 'object') continue;
    for (const mode of Object.values(CheckpointMode)) {
      const best = (modes as Record<string, unknown>)[mode];
      if (!isValidBest(best)) continue;
      (out[course] ??= {})[mode] = {
        seconds: best.seconds,
        gadget: best.gadget,
        date: typeof best.date === 'number' ? best.date : 0,
        ghost: isValidGhost(best.ghost) ? best.ghost : null,
      };
    }
  }
  return out;
}

export class RecordStore {
  private table: RecordTable = load();

  best(courseId: string, mode: CheckpointMode): PersonalBest | null {
    return this.table[courseId]?.[mode] ?? null;
  }

  /**
   * Saves `run` if it beats the stored best in its category (or there is none). Slower runs
   * change nothing, ghost included. Returns whether it was a new best.
   */
  submit(courseId: string, mode: CheckpointMode, run: PersonalBest): boolean {
    const prev = this.best(courseId, mode);
    if (prev && run.seconds >= prev.seconds) return false;
    // Write the whole table at once so the time and its ghost always match.
    const next: RecordTable = { ...this.table, [courseId]: { ...this.table[courseId], [mode]: run } };
    this.table = next;
    writeJson(RECORDS_KEY, { version: RECORDS_VERSION, courses: next });
    return true;
  }
}
