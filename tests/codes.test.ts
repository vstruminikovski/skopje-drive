import { describe, expect, it } from 'vitest';
// The join-code alphabet must have exactly 32 distinct letters, so that every 5 random bits pick one of them evenly.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
describe('join code alphabet', () => {
  it('has 32 distinct characters and no look-alikes', () => {
    expect(CODE_ALPHABET.length).toBe(32);
    expect(new Set(CODE_ALPHABET).size).toBe(32);
    for (const c of '01IO') expect(CODE_ALPHABET).not.toContain(c);
  });
});
