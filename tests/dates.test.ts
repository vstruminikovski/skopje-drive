import { describe, expect, it } from 'vitest';
import { shortDate } from '../src/shared/dates';

describe('shortDate', () => {
  const now = new Date(2026, 10, 23, 20, 0);
  it('says today and yesterday', () => {
    expect(shortDate(new Date(2026, 10, 23, 18, 5).toISOString(), now)).toBe('денес 18:05');
    expect(shortDate(new Date(2026, 10, 22, 9, 0).toISOString(), now)).toBe('вчера 09:00');
  });
  it('gives day and month this year, the year otherwise', () => {
    expect(shortDate(new Date(2026, 2, 4, 7, 30).toISOString(), now)).toBe('4 мар 07:30');
    expect(shortDate(new Date(2025, 11, 31, 7, 30).toISOString(), now)).toBe('31 дек 2025');
  });
  it('is empty for a broken date', () => expect(shortDate('x', now)).toBe(''));
});
