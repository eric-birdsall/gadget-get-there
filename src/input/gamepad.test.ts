import { describe, expect, it } from 'vitest';
import { Action } from './actions';
import { PadButton, readPad, stick } from './gamepad';
import { DEFAULT_BINDINGS, device, keyName, useKeysName } from './input';

const pad = (axes: number[], pressed: number[] = [], values: Record<number, number> = {}) => ({
  axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), touched: false, value: values[i] ?? (pressed.includes(i) ? 1 : 0) })),
});

describe('controller', () => {
  it('ignores a resting stick and saturates near the rim', () => {
    expect(stick(0.1, -0.1)).toEqual([0, 0]);
    expect(stick(0, -0.95)[1]).toBe(-1);
    const [, half] = stick(0, 0.55);
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);
  });

  it('left stick moves (up is forward), right stick looks (up looks up), with a softer middle', () => {
    const s = readPad(pad([0.95, -0.95, 0.95, -0.95]));
    expect(s.forward).toBeGreaterThan(0.6);
    expect(s.right).toBeGreaterThan(0.6);
    expect(s.turn).toBeGreaterThan(0);
    expect(s.tilt).toBeGreaterThan(0);
    const small = readPad(pad([0, 0, 0.4, 0]));
    // Squared: a small push turns slower than its travel.
    expect(small.turn).toBeLessThan(stick(0.4, 0)[0]);
  });

  it('triggers count once pulled past a third; buttons as pressed', () => {
    expect(readPad(pad([0, 0, 0, 0], [], { [PadButton.RT]: 0.2 })).down.has(PadButton.RT)).toBe(false);
    expect(readPad(pad([0, 0, 0, 0], [], { [PadButton.RT]: 0.5 })).down.has(PadButton.RT)).toBe(true);
    const s = readPad(pad([0, 0, 0, 0], [PadButton.A, PadButton.Menu]));
    expect([...s.down].sort()).toEqual([PadButton.A, PadButton.Menu]);
  });

  it('labels show controller buttons while the controller is in use, keys otherwise', () => {
    device.current = 'pad';
    expect(useKeysName(DEFAULT_BINDINGS)).toBe('RT / LT / RB');
    expect(keyName(DEFAULT_BINDINGS, Action.Retry)).toBe('View');
    // No controller button for this one: its key shows.
    expect(keyName(DEFAULT_BINDINGS, Action.ToggleGhost)).toBe('G');
    device.current = 'keys';
    expect(useKeysName(DEFAULT_BINDINGS)).toBe('E / Q / F');
  });
});
