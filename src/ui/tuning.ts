import GUI from 'lil-gui';
import { CAMERA_CONFIG, GRAPPLE_CONFIG, LAUNCH_PAD_CONFIG, MOVEMENT_CONFIG, ROLLERBLADE_CONFIG } from '../config';
import { mergeKnown, readJson, writeJson } from '../storage/settings';

// Live editing of the config objects for feel reviews. Edits persist locally, and
// "Copy changed values" puts the changed numbers on the clipboard to paste back into config.ts.

const TUNING_KEY = 'gadget-get-there.tuning';
const TUNING_VERSION = 2;

type Range = [number, number, number];
type NumberRecord = Record<string, unknown>;

interface Tunable {
  /** Name in config.ts and the save. */
  name: string;
  label: string;
  obj: NumberRecord;
  defaults: NumberRecord;
  /** Slider ranges; numbers without one get a range around their default. */
  ranges?: Record<string, Range>;
  open?: boolean;
}

const tunable = (name: string, label: string, obj: object, ranges?: Record<string, Range>, open = false): Tunable => ({
  name,
  label,
  obj: obj as NumberRecord,
  defaults: structuredClone(obj) as NumberRecord,
  ranges,
  open,
});

const TUNABLES: Tunable[] = [
  tunable(
    'MOVEMENT_CONFIG',
    'Movement',
    MOVEMENT_CONFIG,
    {
      groundSpeed: [4, 25, 0.5],
      groundAcceleration: [10, 200, 1],
      groundDeceleration: [5, 200, 1],
      airAcceleration: [0, 80, 1],
      airControlFactor: [0, 3, 0.05],
      jumpImpulse: [3, 20, 0.1],
      gravity: [5, 60, 0.5],
      maximumFallSpeed: [10, 100, 1],
      groundedFriction: [0, 40, 0.5],
      slopeInfluence: [0, 1, 0.01],
      momentumRetentionFactor: [0, 1, 0.01],
      collisionSlideFactor: [0, 1, 0.01],
      maxGroundAngle: [20, 70, 1],
      coyoteTime: [0, 0.3, 0.01],
      jumpBuffer: [0, 0.3, 0.01],
      stepHeight: [0, 0.8, 0.01],
    },
    true,
  ),
  tunable('GRAPPLE_CONFIG', 'Grappling hook', GRAPPLE_CONFIG),
  tunable('ROLLERBLADE_CONFIG', 'Rollerblades', ROLLERBLADE_CONFIG),
  tunable('LAUNCH_PAD_CONFIG', 'Launch pad', LAUNCH_PAD_CONFIG),
  tunable('CAMERA_CONFIG', 'Camera', CAMERA_CONFIG, {
    distance: [2, 14, 0.1],
    highSpeedExtraDistance: [0, 6, 0.1],
    height: [0.5, 4, 0.05],
    highSpeedFieldOfView: [60, 120, 1],
    smoothing: [1, 40, 0.5],
    verticalSmoothing: [1, 40, 0.5],
    defaultPitch: [-0.5, 1, 0.01],
  }),
];

/** Number fields only: arrays and the like stay as shipped. */
function numbersOf(obj: NumberRecord): NumberRecord {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => typeof v === 'number'));
}

/** Applies any saved tuning on top of the defaults. Call once at startup. */
export function loadTuning(): void {
  const saved = readJson(TUNING_KEY) as { version?: number; values?: Record<string, unknown> } | null;
  if (!saved || saved.version !== TUNING_VERSION || !saved.values) return;
  for (const t of TUNABLES) Object.assign(t.obj, mergeKnown(numbersOf(t.defaults), saved.values[t.name]));
}

function save(): void {
  writeJson(TUNING_KEY, { version: TUNING_VERSION, values: Object.fromEntries(TUNABLES.map((t) => [t.name, numbersOf(t.obj)])) });
}

/** Lines of `key: value` that differ from the shipped defaults, ready to paste into config.ts. */
function changedValues(): string {
  const lines: string[] = [];
  for (const t of TUNABLES) {
    for (const [k, v] of Object.entries(numbersOf(t.obj))) if (t.defaults[k] !== v) lines.push(`${t.name}.${k}: ${v},`);
  }
  return lines.length ? lines.join('\n') : '(all defaults)';
}

function autoRange(v: number): Range {
  const max = v === 0 ? 1 : Math.abs(v) * 3;
  return [Math.min(0, v * 3), max, Math.max(0.001, Number((max / 200).toPrecision(1)))];
}

export class TuningPanel {
  private gui: GUI | null = null;

  toggle(): void {
    if (this.gui) {
      this.gui.destroy();
      this.gui = null;
      return;
    }
    const gui = new GUI({ title: 'Tuning (live)' });
    gui.domElement.style.zIndex = '20';
    for (const t of TUNABLES) {
      const folder = gui.addFolder(t.label);
      for (const key of Object.keys(numbersOf(t.obj))) {
        if (t.ranges && !t.ranges[key]) continue;
        const [min, max, step] = t.ranges?.[key] ?? autoRange(t.defaults[key] as number);
        folder.add(t.obj, key, min, max, step).onChange(save);
      }
      if (!t.open) folder.close();
    }
    const actions = {
      copy: () => {
        const text = changedValues();
        navigator.clipboard?.writeText(text).catch(() => {});
        console.info(text);
      },
      reset: () => {
        for (const t of TUNABLES) Object.assign(t.obj, structuredClone(t.defaults));
        save();
        gui.controllersRecursive().forEach((c) => c.updateDisplay());
      },
    };
    gui.add(actions, 'copy').name('Copy changed values');
    gui.add(actions, 'reset').name('Reset to defaults');
    this.gui = gui;
  }
}
