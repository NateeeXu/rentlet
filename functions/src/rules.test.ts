import { describe, expect, it } from 'vitest';
import { CAMPUS_POINT, inChicagoArea, InputError, isVerifiedAccount, kmBetween, parseLookup, parseNearby, parseSuggest } from './rules';

describe('who may call', () => {
  it('accepts any Google account with a verified email', () => {
    expect(isVerifiedAccount({ email: 'emily@u.northwestern.edu', email_verified: true })).toBe(true);
    expect(isVerifiedAccount({ email: 'x@gmail.com', email_verified: true })).toBe(true);
    expect(isVerifiedAccount({ email: 'x@gmail.com', email_verified: false })).toBe(false);
    expect(isVerifiedAccount({ email: 'emily@u.northwestern.edu' })).toBe(false);
    expect(isVerifiedAccount({ email: '', email_verified: true })).toBe(false);
    expect(isVerifiedAccount(undefined)).toBe(false);
  });
});

describe('input checks', () => {
  it('reads a suggestion request', () => {
    expect(parseSuggest({ q: '  1890  Maple ', campusId: 'nu-evn' })).toEqual({ q: '1890 Maple', campusId: 'nu-evn' });
  });
  it('refuses bad suggestion requests', () => {
    expect(() => parseSuggest({ q: 'x'.repeat(121), campusId: 'nu-evn' })).toThrow(InputError);
    expect(() => parseSuggest({ q: '   ', campusId: 'nu-evn' })).toThrow(InputError);
    expect(() => parseSuggest({ q: 'Maple', campusId: 'harvard' })).toThrow(InputError);
    expect(() => parseSuggest(null)).toThrow(InputError);
    expect(() => parseSuggest(['q'])).toThrow(InputError);
  });
  it('reads a lookup by id or by address', () => {
    expect(parseLookup({ id: 'here:af:streetsection:abc-_=', campusId: 'chi-dt' })).toEqual({ id: 'here:af:streetsection:abc-_=', campusId: 'chi-dt' });
    expect(parseLookup({ q: '1890 Maple Ave', campusId: 'nu-evn' })).toEqual({ q: '1890 Maple Ave', campusId: 'nu-evn' });
    expect(parseLookup({ lat: 42.0518, lng: -87.6857, campusId: 'nu-evn' })).toEqual({ point: { lat: 42.0518, lng: -87.6857 }, campusId: 'nu-evn' });
    expect(() => parseLookup({ lat: 40.71, lng: -74.0, campusId: 'nu-evn' })).toThrow(InputError);
    expect(() => parseLookup({ lat: 42.05, campusId: 'nu-evn' })).toThrow(InputError);
    expect(() => parseLookup({ campusId: 'nu-evn' })).toThrow(InputError);
    expect(() => parseLookup({ id: 'https://evil.test', campusId: 'nu-evn' })).toThrow(InputError);
    expect(() => parseLookup({ id: 'here:a b', campusId: 'nu-evn' })).toThrow(InputError);
  });
  it('only looks around points near a campus', () => {
    expect(parseNearby({ lat: 42.05, lng: -87.68, campusId: 'nu-evn' })).toEqual({ lat: 42.05, lng: -87.68, campusId: 'nu-evn' });
    expect(() => parseNearby({ lat: 40.71, lng: -74.0, campusId: 'nu-evn' })).toThrow(InputError);
    expect(() => parseNearby({ lat: '42', lng: -87.68, campusId: 'nu-evn' })).toThrow(InputError);
    expect(() => parseNearby({ lat: Number.NaN, lng: -87.68, campusId: 'nu-evn' })).toThrow(InputError);
  });
  it('measures straight-line distance', () => {
    const km = kmBetween(CAMPUS_POINT['nu-evn'], CAMPUS_POINT['nu-chi']);
    expect(km).toBeGreaterThan(17);
    expect(km).toBeLessThan(19);
  });
  it('knows the Chicago area', () => {
    for (const p of Object.values(CAMPUS_POINT)) expect(inChicagoArea(p)).toBe(true);
    expect(inChicagoArea({ lat: 42.3695, lng: -87.9229 })).toBe(true); // Gurnee
    expect(inChicagoArea({ lat: 42.5847, lng: -87.8212 })).toBe(false); // Kenosha, WI
    expect(inChicagoArea({ lat: 40.7921, lng: -73.9694 })).toBe(false);
  });
});
