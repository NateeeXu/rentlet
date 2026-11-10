import { describe, expect, it } from 'vitest';
import { firstName, isSchoolEmail } from './nu';

describe('isSchoolEmail', () => {
  it('accepts student and staff addresses', () => {
    expect(isSchoolEmail('emily2027@u.northwestern.edu')).toBe(true);
    expect(isSchoolEmail('Prof.Smith@Northwestern.edu')).toBe(true);
  });
  it('rejects other domains and lookalikes', () => {
    expect(isSchoolEmail('emily@gmail.com')).toBe(false);
    expect(isSchoolEmail('emily@u.northwestern.edu.evil.com')).toBe(false);
    expect(isSchoolEmail('emily@notnorthwestern.edu')).toBe(true); // any .edu since Nov 4
    expect(isSchoolEmail('sam@uchicago.edu')).toBe(true);
    expect(isSchoolEmail('sam@cs.stanford.edu')).toBe(true);
    expect(isSchoolEmail('sam@gmail.com')).toBe(false);
    expect(isSchoolEmail('sam@edu.example.com')).toBe(false);
    expect(isSchoolEmail(null)).toBe(false);
  });
});

describe('firstName', () => {
  it('keeps only the first name', () => {
    expect(firstName('Emily Chen')).toBe('Emily');
    expect(firstName('  ')).toBe('Member');
  });
});
