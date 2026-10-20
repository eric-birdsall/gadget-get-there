import { beforeEach, describe, expect, it } from 'vitest';
import { Action, DEFAULT_BINDINGS } from '../input/input';
import { keyLabel } from '../input/keyNames';
import { bindKey, clearKey, defaultBindings, loadBindings, saveBindings } from './bindings';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
});

describe('key bindings', () => {
  it('replaces a main key and keeps the alternate', () => {
    const b = defaultBindings();
    bindKey(b, Action.Forward, 0, 'KeyI');
    expect(b[Action.Forward]).toEqual(['KeyI', 'ArrowUp']);
  });

  it('takes a key off whatever action had it', () => {
    const b = defaultBindings();
    const taken = bindKey(b, Action.UseSlot1, 0, 'KeyF');
    expect(taken).toEqual([Action.UseSlot3]);
    expect(b[Action.UseSlot1]).toEqual(['KeyF']);
    expect(b[Action.UseSlot3]).toEqual([]);
  });

  it('adds an alternate, and moving a key within an action does not duplicate it', () => {
    const b = defaultBindings();
    bindKey(b, Action.UseSlot1, 1, 'Mouse0');
    expect(b[Action.UseSlot1]).toEqual(['KeyE', 'Mouse0']);
    bindKey(b, Action.UseSlot1, 0, 'Mouse0');
    expect(b[Action.UseSlot1]).toEqual(['Mouse0']);
    clearKey(b, Action.UseSlot1, 0);
    expect(b[Action.UseSlot1]).toEqual([]);
  });

  it('saves and loads, falling back to defaults for bad entries', () => {
    const b = defaultBindings();
    bindKey(b, Action.Jump, 0, 'KeyJ');
    saveBindings(b);
    expect(loadBindings()[Action.Jump]).toEqual(['KeyJ']);
    store.set('gadget-get-there.bindings', JSON.stringify({ version: 1, data: { jump: ['Escape'], retry: [3] } }));
    const loaded = loadBindings();
    expect(loaded[Action.Jump]).toEqual(DEFAULT_BINDINGS[Action.Jump]);
    expect(loaded[Action.Retry]).toEqual(DEFAULT_BINDINGS[Action.Retry]);
  });

  it('moves an old single use key to slot 1, keeping saved keys off the new defaults', () => {
    const old = { ...defaultBindings(), gadget: ['KeyQ'], 'next-gadget': ['KeyF'] } as Record<string, string[]>;
    delete old[Action.UseSlot1];
    delete old[Action.UseSlot2];
    delete old[Action.UseSlot3];
    store.set('gadget-get-there.bindings', JSON.stringify({ version: 1, data: old }));
    const b = loadBindings();
    expect(b[Action.UseSlot1]).toEqual(['KeyQ']);
    // Q was the old use key, so slot 2 loses its default; F is free again for slot 3.
    expect(b[Action.UseSlot2]).toEqual([]);
    expect(b[Action.UseSlot3]).toEqual(['KeyF']);
  });

  it('names keys for the screen', () => {
    expect(['KeyE', 'Digit4', 'Numpad2', 'ShiftLeft', 'Mouse2', 'ArrowUp'].map(keyLabel)).toEqual(['E', '4', 'Num 2', 'L Shift', 'Right click', '↑']);
  });
});
