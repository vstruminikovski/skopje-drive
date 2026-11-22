import { describe, expect, it } from 'vitest';
import { normalizeUser, validateAuth } from '../src/shared/auth-rules';

describe('username', () => {
  it('is trimmed and lower-cased like the server stores it', () => {
    expect(normalizeUser('  Viktor ')).toBe('viktor');
  });
  it('accepts 3 to 20 latin letters, digits and _', () => {
    expect(validateAuth('login', 'Viktor_99', 'x')).toBeNull();
    expect(validateAuth('login', 'ab', 'x')).toMatch(/3–20/);
    expect(validateAuth('login', 'a'.repeat(21), 'x')).toMatch(/3–20/);
  });
  it('explains spaces and cyrillic instead of a generic error', () => {
    expect(validateAuth('login', 'viktor s', 'x')).toMatch(/празни места/);
    expect(validateAuth('login', 'Виктор', 'x')).toMatch(/латинични/);
  });
});

describe('password', () => {
  it('needs 8 characters only when creating a profile (old passwords still sign in)', () => {
    expect(validateAuth('register', 'viktor', 'short', 'short')).toMatch(/8/);
    expect(validateAuth('login', 'viktor', 'short')).toBeNull();
  });
  it('must be typed the same twice when creating a profile', () => {
    expect(validateAuth('register', 'viktor', 'long-enough-1', 'long-enough-2')).toMatch(/исти/);
    expect(validateAuth('register', 'viktor', 'long-enough-1', 'long-enough-1')).toBeNull();
  });
  it('is required', () => {
    expect(validateAuth('login', 'viktor', '')).toMatch(/лозинка/);
  });
});
