import { describe, expect, it } from 'vitest';
import { firstName, isNorthwesternEmail } from './nu';

describe('isNorthwesternEmail', () => {
  it('accepts student and staff addresses', () => {
    expect(isNorthwesternEmail('emily2027@u.northwestern.edu')).toBe(true);
    expect(isNorthwesternEmail('Prof.Smith@Northwestern.edu')).toBe(true);
  });
  it('rejects other domains and lookalikes', () => {
    expect(isNorthwesternEmail('emily@gmail.com')).toBe(false);
    expect(isNorthwesternEmail('emily@u.northwestern.edu.evil.com')).toBe(false);
    expect(isNorthwesternEmail('emily@notnorthwestern.edu')).toBe(false);
    expect(isNorthwesternEmail(null)).toBe(false);
  });
});

describe('firstName', () => {
  it('keeps only the first name', () => {
    expect(firstName('Emily Chen')).toBe('Emily');
    expect(firstName('  ')).toBe('Northwestern student');
  });
});
