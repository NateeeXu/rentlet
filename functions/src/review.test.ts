import { describe, expect, it } from 'vitest';
import { LEASE_REASONS, LISTING_REASONS, adminList, isOnTeam, reasonOf } from './review';

describe('the team list', () => {
  const list = adminList(' A@u.northwestern.edu, b@gmail.com;c@x.edu\nnot-an-email ');
  it('reads emails separated by commas, semicolons or lines, lower case', () => expect(list).toEqual(['a@u.northwestern.edu', 'b@gmail.com', 'c@x.edu']));
  it('lets in only a verified email on the list', () => {
    expect(isOnTeam({ email: 'B@gmail.com', email_verified: true }, list)).toBe(true);
    expect(isOnTeam({ email: 'b@gmail.com', email_verified: false }, list)).toBe(false);
    expect(isOnTeam({ email: 'd@gmail.com', email_verified: true }, list)).toBe(false);
    expect(isOnTeam(undefined, list)).toBe(false);
  });
});

describe('reasons', () => {
  it('needs a known category and a sentence', () => {
    expect(reasonOf({ reason: LISTING_REASONS[0], note: 'Every photo is of the lobby.' }, LISTING_REASONS)).toBe('Photos don’t show the place: Every photo is of the lobby.');
    expect(reasonOf({ reason: LISTING_REASONS[0], note: 'short' }, LISTING_REASONS)).toBeNull();
    expect(reasonOf({ reason: 'Made up', note: 'A long enough sentence.' }, LISTING_REASONS)).toBeNull();
    expect(reasonOf({ reason: LEASE_REASONS[0], note: '  The   name is cut off at the top.  ' }, LEASE_REASONS)).toBe('Name not visible: The name is cut off at the top.');
  });
});
