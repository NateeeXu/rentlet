import { describe, expect, it } from 'vitest';
import {
  cleanText,
  conversationId,
  convFromData,
  counts,
  dayLabel,
  isUnread,
  lastLine,
  needsReveal,
  listingSnapshot,
  newConversation,
  parseConversationId,
  replyTime,
  rolesFor,
  settleView,
  shareView,
  threadView,
  timeline,
  unlockIndex,
  whenLabel,
  type Msg,
} from './chatModel';
import type { ListingDoc } from './listingView';

const HOST = 'hostUid123';
const GUEST = 'guestUid456';
const now = new Date(2026, 10, 4, 15, 0); // Wed Nov 4 2026, 3 PM local
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
const msg = (id: string, by: string, t: number, text = 'hi'): Msg => ({ id, senderId: by, text, kind: 'text', atMs: t });

const listing = {
  ownerId: HOST,
  ownerName: 'Maya',
  ownerPhoto: '',
  status: 'active',
  code: '12345678',
  campus: 'evanston',
  campusId: 'nu-evn',
  kind: 'sublet',
  title: 'Private room in a 3-bed',
  area: 'Evanston',
  price: 1390,
  start: '2027-01-02',
  end: '2027-04-30',
  photos: ['https://example.test/a.jpg'],
  captions: ['Bedroom'],
  video: null,
  walk: null,
  form: {
    subletType: 'sublet',
    transferChannel: 'official',
    dep: 'amount',
    refund: true,
    furn: 'full',
    terms: null,
    multi: { fees: ['Wi-Fi', 'Heat'], amen: [], habits: [], items: ['Bed frame', 'Mattress', 'Desk', 'Chair', 'Lamp'] },
    f: { dep: '500', extra: '40' },
  },
} as unknown as ListingDoc;

describe('ids and roles', () => {
  it('builds and parses the conversation id', () => {
    const id = conversationId('12345678', GUEST);
    expect(id).toBe('12345678_guestUid456');
    expect(parseConversationId(id)).toEqual({ listingId: '12345678', guestId: GUEST });
    expect(parseConversationId('nope')).toBeNull();
    expect(parseConversationId('02345678_guestUid456')).toBeNull();
  });

  it('works out host and guest', () => {
    expect(rolesFor(HOST, GUEST, null)).toEqual({ hostId: HOST, guestId: GUEST });
    expect(rolesFor(HOST, GUEST, 'someoneElse')).toEqual({ hostId: HOST, guestId: GUEST });
    expect(rolesFor(HOST, HOST, GUEST)).toEqual({ hostId: HOST, guestId: GUEST });
    expect(rolesFor(HOST, HOST, null)).toEqual({ error: 'who' });
    expect(rolesFor(HOST, HOST, HOST)).toEqual({ error: 'own' });
  });
});

describe('new conversations', () => {
  it('keeps what the checklist needs from the listing', () => {
    const s = listingSnapshot(listing);
    expect(s).toMatchObject({
      title: 'Private room in a 3-bed',
      photo: 'https://example.test/a.jpg',
      price: 1390,
      deposit: 500,
      refund: true,
      incl: 'Wi-Fi + Heat',
      extra: 'About $40 / mo',
      keep: false,
      channel: 'official',
    });
    expect(s.stays).toHaveLength(5);
  });

  it('matches what the create rule checks', () => {
    const c = newConversation({ listing, hostId: HOST, guestId: GUEST, names: {}, photos: {} });
    expect(conversationId(c.listingId, c.guestId)).toBe('12345678_guestUid456');
    expect(c.participants).toHaveLength(2);
    expect(c.participants).toEqual(expect.arrayContaining([HOST, GUEST]));
    expect(c.hostId).not.toBe(c.guestId);
  });

  it('cleans message text to the rule limits', () => {
    expect(cleanText('  hello  \n\n')).toBe('  hello');
    expect(cleanText('x'.repeat(2500))).toHaveLength(2000);
  });
});

describe('reading a conversation', () => {
  it('drops malformed notes and shares', () => {
    const c = convFromData('12345678_guestUid456', {
      listingId: '12345678',
      hostId: HOST,
      guestId: GUEST,
      participants: [GUEST, HOST],
      notes: { dates: { s: 'done', by: HOST, v: 'Jan 2 – Apr 30, 2027' }, money: { s: 'bogus', by: HOST }, extra: { s: 'done', by: HOST } },
      share: { [HOST]: { kind: 'instagram', val: 'maya.nu', at: 5 }, [GUEST]: { kind: 'fax', val: '1' }, other: { kind: 'email' } },
      updatedAt: { toMillis: () => 42 },
      blocked: { [GUEST]: true, [HOST]: false },
    });
    expect(Object.keys(c.notes)).toEqual(['dates']);
    expect(Object.keys(c.share)).toEqual([HOST, 'other']);
    expect(c.share.other.val).toBe('');
    expect(c.updatedAtMs).toBe(42);
    expect(c.blocked).toEqual({ [GUEST]: true });
    expect(c.listing.title).toBe('Listing');
  });

  it('marks unread only for the other side’s newer messages', () => {
    const base = { lastSender: HOST, updatedAtMs: 100, read: {} as Record<string, number> };
    expect(isUnread(base, GUEST)).toBe(true);
    expect(isUnread(base, HOST)).toBe(false);
    expect(isUnread({ ...base, read: { [GUEST]: 100 } }, GUEST)).toBe(false);
    expect(isUnread({ ...base, read: { [GUEST]: 99 } }, GUEST)).toBe(true);
    expect(isUnread({ lastSender: '', updatedAtMs: 1, read: {} }, GUEST)).toBe(false);
  });

  it('writes the last line from my side', () => {
    expect(lastLine({ lastMessage: 'Hi!\nStill free?', lastSender: GUEST }, GUEST)).toBe('You: Hi! Still free?');
    expect(lastLine({ lastMessage: 'Yes', lastSender: HOST }, GUEST)).toBe('Yes');
    expect(lastLine({ lastMessage: '', lastSender: '' }, GUEST)).toBe('New conversation');
  });
});

describe('contact unlock and swap', () => {
  const thread = [
    msg('1', GUEST, at(3, 9)),
    msg('2', HOST, at(3, 10)),
    msg('3', GUEST, at(3, 11)),
    msg('4', GUEST, at(3, 12)),
    msg('5', HOST, at(4, 9)),
    msg('6', HOST, at(4, 10)),
    msg('7', GUEST, at(4, 11)),
  ];

  it('unlocks after three replies each', () => {
    expect(counts(thread, GUEST)).toEqual({ me: 4, them: 3 });
    expect(unlockIndex(thread, GUEST)).toBe(5);
    expect(unlockIndex(thread.slice(0, 5), GUEST)).toBe(-1);
  });

  it('stores no value until both shared, then shows theirs once written', () => {
    const first = { [HOST]: { kind: 'instagram' as const, val: '', atMs: 1 } };
    expect(shareView(first, GUEST, HOST)).toEqual({ mine: null, theirsShared: true, theirs: null });
    expect(needsReveal(first, HOST, GUEST)).toBeNull(); // the host waits for the guest
    const both = { ...first, [GUEST]: { kind: 'email' as const, val: '', atMs: 2 } };
    expect(needsReveal(both, GUEST, HOST)).toBe('email');
    expect(needsReveal(both, HOST, GUEST)).toBe('instagram');
    expect(shareView(both, GUEST, HOST).theirs).toBeNull();
    const revealed = { ...both, [HOST]: { kind: 'instagram' as const, val: 'maya.nu', atMs: 1 } };
    expect(shareView(revealed, GUEST, HOST).theirs).toEqual({ kind: 'instagram', val: 'maya.nu' });
    expect(needsReveal(revealed, HOST, GUEST)).toBeNull();
  });

  it('lays out days, the unlock note and the swap note in time order', () => {
    const items = timeline(thread, { safetyMs: at(3, 11, 30), share: {
      [HOST]: { kind: 'instagram', val: 'x', atMs: at(4, 12) },
      [GUEST]: { kind: 'email', val: 'y', atMs: at(4, 13) },
    } }, GUEST, HOST, 'Maya', 'looking', now);
    expect(items.map((i) => i.f)).toEqual(['day', 'me', 'them', 'me', 'sys', 'me', 'day', 'them', 'them', 'unlock', 'me', 'sys']);
    expect(items[0]).toEqual({ f: 'day', x: 'Yesterday' });
    expect(items[6]).toEqual({ f: 'day', x: 'Today' });
    expect(items[4]).toEqual({ f: 'sys', x: 'You pay the host directly. Rentlet never holds money.' });
    expect(items[11]).toEqual({ f: 'sys', x: 'You and Maya swapped contact details' });
  });
});

describe('labels', () => {
  it('words list times and day stamps', () => {
    expect(whenLabel(at(4, 9, 41), now)).toBe('9:41 AM');
    expect(whenLabel(at(3, 9), now)).toBe('Yesterday');
    expect(whenLabel(at(2, 9), now)).toBe('Mon');
    expect(whenLabel(new Date(2026, 9, 25, 9).getTime(), now)).toBe('Oct 25');
    expect(whenLabel(new Date(2025, 9, 28).getTime(), now)).toBe('Oct 28, 2025');
    expect(dayLabel(at(4, 1), now)).toBe('Today');
    expect(whenLabel(0, now)).toBe('');
  });

  it('words the checklist for the person looking at it', () => {
    const L = listingSnapshot(listing);
    const notes = {
      dates: { s: 'done' as const, by: HOST, v: 'Jan 2 – Apr 30, 2027' },
      tour: { s: 'wait' as const, by: GUEST },
      landlord: { s: 'done' as const, by: HOST },
      money: { s: 'done' as const, by: GUEST },
    };
    const g = settleView(notes, { me: GUEST, otherName: 'Maya', host: false, listing: L });
    expect(g.dates).toEqual(['done', 'Jan 2 – Apr 30, 2027']);
    expect(g.tour).toEqual(['wait', 'Waiting on Maya']);
    expect(g.landlord).toEqual(['done', 'Confirmed by Maya']);
    expect(g.money).toEqual(['done', '$1,390 / mo · $500 deposit']);
    expect(g.stays).toEqual(['open', '']);
    const h = settleView(notes, { me: HOST, otherName: 'Sam', host: true, listing: L });
    expect(h.tour).toEqual(['wait', 'Sam asked']);
    expect(h.landlord).toEqual(['done', 'You confirmed']);
  });

  it('says how fast someone replies only with enough to go on', () => {
    const quick = [msg('1', GUEST, at(4, 9)), msg('2', HOST, at(4, 9, 20)), msg('3', GUEST, at(4, 10)), msg('4', HOST, at(4, 10, 30))];
    expect(replyTime(quick, GUEST)).toBe('Usually replies within an hour');
    expect(replyTime(quick.slice(0, 2), GUEST)).toBe('');
    const slow = [msg('1', GUEST, at(3, 9)), msg('2', HOST, at(3, 15)), msg('3', GUEST, at(3, 16)), msg('4', HOST, at(4, 9))];
    expect(replyTime(slow, GUEST)).toBe('Usually replies within a day');
  });
});

describe('thread view', () => {
  const conv = convFromData('12345678_guestUid456', {
    ...newConversation({ listing, hostId: HOST, guestId: GUEST, names: { [HOST]: 'Maya', [GUEST]: 'Sam' }, photos: {} }),
    lastMessage: 'Yes, it is free',
    lastSender: HOST,
    updatedAt: at(4, 9, 41),
  });

  it('is the guest’s Looking thread and the host’s Subletting thread', () => {
    const g = threadView(conv, { me: GUEST, msgs: null, profile: null, activeCodes: new Set(['12345678']), now });
    expect(g).toMatchObject({ tab: 'looking', other: HOST, unread: true, taken: false, when: '9:41 AM', loaded: false });
    expect(g.p.name).toBe('Maya');
    const h = threadView(conv, { me: HOST, msgs: [], profile: null, activeCodes: new Set(), now });
    expect(h).toMatchObject({ tab: 'subletting', other: GUEST, unread: false, taken: true, loaded: true });
    expect(h.p.name).toBe('Sam');
  });

  it('prefers the live public profile', () => {
    const v = threadView(conv, {
      me: GUEST,
      msgs: [],
      profile: { name: 'Maya', photoURL: 'https://p.test/m.jpg', nu: true, joinedAtMs: new Date(2026, 9, 2).getTime(), bio: 'Tidy', year: 'Junior' },
      activeCodes: null,
      now,
    });
    expect(v.p).toMatchObject({ photo: 'https://p.test/m.jpg', role: 'Junior · Northwestern', since: 'Member since Oct 2026', bio: 'Tidy' });
    expect(v.taken).toBe(false);
  });
});
