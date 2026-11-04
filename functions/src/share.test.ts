import { describe, expect, it } from 'vitest';
import { codeFromPath, dateRange, previewHtml, toPreview } from './share';

describe('codeFromPath', () => {
  it('reads an 8-digit listing code from /r/{code}', () => {
    expect(codeFromPath('/r/52775382')).toBe('52775382');
    expect(codeFromPath('/r/52775382/')).toBe('52775382');
    expect(codeFromPath('/r/02775382')).toBe('');
    expect(codeFromPath('/r/abc')).toBe('');
    expect(codeFromPath('/x/52775382')).toBe('');
  });
});

describe('dateRange', () => {
  it('uses the site format', () => {
    expect(dateRange('2027-01-03', '2027-06-12')).toBe('Jan 3 – Jun 12, 2027');
    expect(dateRange('2026-12-01', '2027-01-31')).toBe('Dec 1, 2026 – Jan 31, 2027');
    expect(dateRange('soon', '2027-01-31')).toBe('');
  });
});

describe('toPreview', () => {
  it('describes active listings only', () => {
    expect(toPreview(undefined)).toBeNull();
    expect(toPreview({ status: 'taken', title: 'x' })).toBeNull();
    const r = toPreview({ status: 'active', title: 'Room', price: 1750, start: '2027-01-03', end: '2027-06-12', area: 'Evanston', photos: ['https://img/x.jpg'] });
    expect(r).toEqual({ title: 'Room', price: 1750, start: '2027-01-03', end: '2027-06-12', area: 'Evanston', photo: 'https://img/x.jpg' });
  });
  it('drops photo links that are not https', () => {
    expect(toPreview({ status: 'active', photos: ['javascript:alert(1)'] })?.photo).toBe('');
  });
});

describe('previewHtml', () => {
  it('carries the room in Open Graph tags and sends people on to the room page', () => {
    const h = previewHtml({ title: 'Private room', price: 1750, start: '2027-01-03', end: '2027-06-12', area: 'Downtown Evanston', photo: 'https://img/x.jpg' }, '52775382');
    expect(h).toContain('<meta property="og:title" content="Private room · $1,750 / mo">');
    expect(h).toContain('<meta property="og:description" content="Jan 3 – Jun 12, 2027 · Downtown Evanston">');
    expect(h).toContain('<meta property="og:image" content="https://img/x.jpg">');
    expect(h).toContain('location.replace("https://rentlet-nu.web.app/room?room=52775382")');
  });
  it('escapes host text', () => {
    const h = previewHtml({ title: '"><script>x</script>', price: 1, start: '', end: '', area: '<b>', photo: '' }, '52775382');
    expect(h).not.toContain('<script>x');
    expect(h).toContain('&quot;&gt;&lt;script&gt;');
  });
  it('falls back to the site preview', () => {
    const h = previewHtml(null, '');
    expect(h).toContain('Rentlet · Sublets near Northwestern');
    expect(h).toContain('location.replace("https://rentlet-nu.web.app/")');
  });
});
