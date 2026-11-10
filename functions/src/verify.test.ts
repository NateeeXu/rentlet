import { describe, expect, it } from 'vitest';
import { CODE_TTL_MS, MAX_SENDS_PER_DAY, MAX_TO_ONE_ADDRESS_PER_DAY, MAX_TRIES, RESEND_MS, canSend, checkCode, codeDigest, codeEmail, newCode, normalizeEmail, sendsToday } from './verify';

const NOW = 1_800_000_000_000;

describe('normalizeEmail', () => {
  it('accepts .edu addresses, subdomains included, and cleans them up', () => {
    expect(normalizeEmail('  Alex@U.Northwestern.EDU ')).toBe('alex@u.northwestern.edu');
    expect(normalizeEmail('a@cs.stanford.edu')).toBe('a@cs.stanford.edu');
  });
  it('refuses anything else', () => {
    for (const bad of ['a@gmail.com', 'a@edu', 'a@x.edu.cn', 'a b@x.edu', '', null, 7, `${'a'.repeat(260)}@x.edu`]) expect(normalizeEmail(bad)).toBeNull();
  });
});

describe('newCode', () => {
  it('is always six digits', () => {
    for (let i = 0; i < 200; i++) expect(newCode()).toMatch(/^\d{6}$/);
  });
});

describe('canSend', () => {
  it('lets a first send through', () => expect(canSend(undefined, undefined, NOW)).toEqual({ ok: true }));
  it('makes you wait a minute between codes', () => {
    expect(canSend({ sentAt: NOW - 10_000 }, undefined, NOW)).toEqual({ ok: false, reason: 'wait', seconds: 50 });
    expect(canSend({ sentAt: NOW - RESEND_MS }, undefined, NOW)).toEqual({ ok: true });
  });
  it('stops at the daily limit for an account and for an address', () => {
    expect(canSend({ dayStart: NOW - 1000, sends: MAX_SENDS_PER_DAY }, undefined, NOW)).toEqual({ ok: false, reason: 'limit' });
    expect(canSend(undefined, { dayStart: NOW - 1000, sends: MAX_TO_ONE_ADDRESS_PER_DAY }, NOW)).toEqual({ ok: false, reason: 'limit' });
  });
  it('starts counting again after a day', () => {
    expect(sendsToday({ dayStart: NOW - 25 * 3600_000, sends: 9 }, NOW)).toBe(0);
    expect(canSend({ dayStart: NOW - 25 * 3600_000, sends: MAX_SENDS_PER_DAY }, undefined, NOW)).toEqual({ ok: true });
  });
});

describe('checkCode', () => {
  const good = { email: 'a@x.edu', digest: codeDigest('u1', '123456'), expiresAt: NOW + CODE_TTL_MS, tries: 0 };
  it('accepts the right code', () => expect(checkCode(good, 'u1', '123456', NOW)).toBe('ok'));
  it('refuses a wrong code', () => expect(checkCode(good, 'u1', '654321', NOW)).toBe('wrong'));
  it('does not accept another account\'s code', () => expect(checkCode(good, 'u2', '123456', NOW)).toBe('wrong'));
  it('reports no code, an expired one and too many tries', () => {
    expect(checkCode(undefined, 'u1', '123456', NOW)).toBe('none');
    expect(checkCode({ ...good, digest: undefined }, 'u1', '123456', NOW)).toBe('none');
    expect(checkCode({ ...good, expiresAt: NOW - 1 }, 'u1', '123456', NOW)).toBe('expired');
    expect(checkCode({ ...good, tries: MAX_TRIES }, 'u1', '123456', NOW)).toBe('too-many');
  });
});

describe('codeEmail', () => {
  it('carries the code in both versions and says when it expires', () => {
    const m = codeEmail('048213');
    expect(m.text).toContain('048213');
    expect(m.html).toContain('048213');
    expect(m.text).toContain('10 minutes');
    expect(m.subject).not.toContain('048213');
  });
});
