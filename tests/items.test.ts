import { describe, expect, it } from 'vitest';
import { isItemsFile } from '../src/game/items';
import { isSession } from '../src/builder/store';

describe('items file', () => {
  it('accepts the builder format (version 2)', () => {
    expect(isItemsFile({ format: 'mapng-mod', version: 2, savedAt: 'x', surveyor: '', items: [] })).toBe(true);
  });
  it('rejects other formats and versions', () => {
    expect(isItemsFile({ format: 'mapng-mod', version: 1, items: [] })).toBe(false);
    expect(isItemsFile({ format: 'other', version: 2, items: [] })).toBe(false);
    expect(isItemsFile(null)).toBe(false);
  });
});

describe('builder session', () => {
  it('needs the session format and a list of items', () => {
    expect(isSession({ format: 'krug-builder-session', version: 1, recs: [] })).toBe(true);
    expect(isSession({ format: 'krug-builder-session', version: 1, recs: 'no' })).toBe(false);
  });
});
