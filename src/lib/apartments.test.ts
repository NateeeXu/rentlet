import { describe, expect, it } from 'vitest';
import { APARTMENTS, findApartment, fullAddress, searchApartments, walkEstimate } from './apartments';

describe('apartment directory', () => {
  it('holds the Northwestern buildings from the mini program', () => {
    expect(APARTMENTS).toHaveLength(35);
    expect(APARTMENTS.filter((a) => a.campus === 'evanston')).toHaveLength(26);
    expect(APARTMENTS.filter((a) => a.campus === 'chicago')).toHaveLength(9);
  });
  it('finds buildings by name, alias, prefix and small typos', () => {
    expect(searchApartments('the link', 'nu-evn')[0].name).toBe('The Link Evanston');
    expect(searchApartments('E2', 'nu-evn')[0].name).toBe('E2 Apartments');
    expect(searchApartments('evanston plce', 'nu-evn')[0].name).toBe('Evanston Place Apartments');
    expect(searchApartments('saint grand', 'nu-chi')[0].name).toBe('The Saint Grand');
  });
  it('offers only buildings near the chosen place', () => {
    expect(searchApartments('the link', 'nu-chi').map((a) => a.name)).not.toContain('The Link Evanston');
    expect(searchApartments('aqua', 'chi-dt')[0].name).toBe('Aqua at Lakeshore East');
  });
  it('lists popular buildings first when nothing is typed', () => {
    expect(searchApartments('', 'nu-evn').every((a) => a.popular)).toBe(true);
  });
  it('matches an exact name or alias', () => {
    expect(findApartment('E 2', 'nu-evn')?.name).toBe('E2 Apartments');
    expect(findApartment('nothing like this', 'nu-evn')).toBeNull();
  });
  it('formats the address and estimates a walk', () => {
    const e2 = APARTMENTS.find((a) => a.id === 'nu_e2')!;
    expect(fullAddress(e2)).toBe('1890 Maple Ave, Evanston, IL');
    const w = walkEstimate(e2.lat, e2.lng, 'nu-evn')!;
    expect(w).toBeGreaterThan(5);
    expect(w).toBeLessThan(30);
  });
});
