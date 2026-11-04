import { describe, expect, it } from 'vitest';
import {
  badgeUnread,
  chatPhotoPath,
  cleanText,
  conversationId,
  convFromData,
  counts,
  dayLabel,
  fitWithin,
  imageBody,
  isHiddenFor,
  isUnread,
  lastFor,
  lastLine,
  listingBody,
  listingCard,
  msgFromData,
  msgSnippet,
  recallLeft,
  replyTo,
  snippet,
  textBody,
  underLimit,
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

describe('replies, recalls, photos and listing cards', () => {
  const CID = '12345678_guestUid456';
  const URL = `https://firebasestorage.googleapis.com/v0/b/rentlet-nu.firebasestorage.app/o/chats%2F${CID}%2F${GUEST}%2F1762268400000.jpg?alt=media&token=t`;

  it('reads each kind of message and ignores what does not fit', () => {
    expect(msgFromData('a', { senderId: GUEST, kind: 'image', imageUrl: URL, width: 1200.4, height: 900, createdAt: 5 })).toMatchObject({
      kind: 'image',
      text: '',
      image: { url: URL, w: 1200, h: 900 },
    });
    // a photo from anywhere else is not shown as a photo
    expect(msgFromData('b', { senderId: GUEST, kind: 'image', imageUrl: 'https://evil.test/x.jpg', text: '' })).toMatchObject({ kind: 'text', text: '' });
    expect(msgFromData('c', { senderId: HOST, kind: 'listing', listing: { code: '12345678', title: 'Room', price: 1390, photo: 'javascript:x' } })).toMatchObject({
      kind: 'listing',
      listing: { code: '12345678', title: 'Room', price: 1390, photo: '' },
    });
    expect(msgFromData('d', { senderId: HOST, kind: 'listing', listing: { code: 'nope' }, text: 'hi' }).kind).toBe('text');
    expect(msgFromData('e', { senderId: HOST, kind: 'recalled', text: 'secret' })).toMatchObject({ kind: 'recalled', text: '' });
    expect(msgFromData('f', { senderId: HOST, text: 'ok', replyTo: { id: 'a', senderId: GUEST, text: 'x'.repeat(200) }, hiddenFor: { [GUEST]: true, [HOST]: 'yes' } })).toMatchObject({
      kind: 'text',
      replyTo: { id: 'a', senderId: GUEST },
      hiddenFor: { [GUEST]: true },
    });
    expect(msgFromData('g', { senderId: HOST, text: 'ok', kind: 'system' }).kind).toBe('text');
  });

  it('leaves out what I deleted and what came before Delete conversation', () => {
    const list: Msg[] = [
      msg('1', GUEST, at(3, 9), 'old'),
      { ...msg('2', HOST, at(4, 9), 'hidden for me'), hiddenFor: { [GUEST]: true } },
      msg('3', HOST, at(4, 10), 'kept'),
    ];
    const items = timeline(list, { safetyMs: at(3, 10), share: {}, clearedAt: { [GUEST]: at(3, 12) } }, GUEST, HOST, 'Maya', 'looking', now);
    expect(items.filter((i) => i.f === 'me' || i.f === 'them').map((i) => ('x' in i ? i.x : ''))).toEqual(['kept']);
    expect(items.some((i) => i.f === 'sys')).toBe(false); // the money note was before the clear
    // the host still sees everything
    expect(timeline(list, { safetyMs: 0, share: {}, clearedAt: { [GUEST]: at(3, 12) } }, HOST, GUEST, 'Sam', 'subletting', now).filter((i) => i.f === 'me' || i.f === 'them')).toHaveLength(3);
    // deleted-for-me messages still count toward the contact unlock
    expect(counts(list, GUEST)).toEqual({ me: 1, them: 2 });
  });

  it('shows recalls to both sides and quotes that are gone as not available', () => {
    const list: Msg[] = [
      { ...msg('1', GUEST, at(4, 9), ''), kind: 'recalled' },
      msg('2', GUEST, at(4, 9, 1), 'Still free?'),
      { ...msg('3', HOST, at(4, 9, 2), 'Yes'), replyTo: { id: '2', senderId: GUEST, text: 'Still free?' } },
      { ...msg('4', HOST, at(4, 9, 3), 'About that'), replyTo: { id: '1', senderId: GUEST, text: 'was here' } },
      { ...msg('5', GUEST, at(4, 9, 4), 'photo'), kind: 'image', text: '', image: { url: URL, w: 4, h: 3 } },
    ];
    const g = timeline(list, null, GUEST, HOST, 'Maya', 'looking', now);
    expect(g[1]).toEqual({ f: 'recalled', x: 'You recalled a message', id: '1', mine: true });
    expect(g[2]).toMatchObject({ f: 'me', x: 'Still free?', rcl: at(4, 9, 1) + 120_000 });
    expect(g[3]).toMatchObject({ f: 'them', re: { id: '2', who: 'You', x: 'Still free?', gone: false } });
    expect(g[3]).not.toHaveProperty('rcl'); // only my own messages can be recalled
    expect(g[4]).toMatchObject({ re: { who: 'You', x: '', gone: true } });
    expect(g[5]).toMatchObject({ f: 'me', k: 'image', x: '', img: { url: URL, w: 4, h: 3 } });
    expect(g[5]).not.toHaveProperty('rcl');
    expect(timeline(list, null, HOST, GUEST, 'Sam', 'subletting', now)[1]).toEqual({ f: 'recalled', x: 'Sam recalled a message', id: '1', mine: false });
    // a recalled message is no longer a reply
    expect(counts(list, GUEST)).toEqual({ me: 1, them: 2 });
  });

  it('words the last line for each kind', () => {
    const c = { lastMessage: 'Photo', lastSender: GUEST, lastKind: 'image' as const, updatedAtMs: 10, lastHidden: {} as Record<string, number> };
    expect(lastLine(c, GUEST, 'Maya')).toBe('You: Photo');
    expect(lastLine({ ...c, lastKind: 'recalled', lastMessage: 'Message recalled' }, GUEST, 'Maya')).toBe('You recalled a message');
    expect(lastLine({ ...c, lastKind: 'recalled', lastMessage: 'Message recalled' }, HOST, 'Sam')).toBe('Sam recalled a message');
    expect(lastLine({ ...c, lastHidden: { [GUEST]: 11 } }, GUEST, 'Maya')).toBe('Message deleted');
    expect(lastLine({ ...c, lastHidden: { [GUEST]: 9 } }, GUEST, 'Maya')).toBe('You: Photo'); // a newer message came in
  });

  it('builds message documents the proposed rules accept', () => {
    expect(Object.keys(textBody('hi'))).toEqual(['kind', 'text']);
    const quoted = replyTo({ id: 'm1', senderId: HOST, text: 'a\n'.repeat(100), kind: 'text', atMs: 1 });
    expect(quoted.text.length).toBeLessThanOrEqual(80);
    expect(textBody('hi', quoted)).toEqual({ kind: 'text', text: 'hi', replyTo: quoted });
    expect(Object.keys(quoted).sort()).toEqual(['id', 'senderId', 'text']);
    expect(imageBody(URL, 1599.6, 1200.2)).toEqual({ kind: 'image', text: '', imageUrl: URL, width: 1600, height: 1200 });
    const card = listingCard(listing);
    expect(Object.keys(card).sort()).toEqual(['area', 'code', 'end', 'photo', 'price', 'start', 'title']);
    expect(card).toMatchObject({ code: '12345678', price: 1390, photo: 'https://example.test/a.jpg' });
    expect(Number.isInteger(card.price)).toBe(true);
    expect(listingBody(card)).toEqual({ kind: 'listing', text: '', listing: card });
    expect(lastFor(listingBody(card))).toEqual({ lastMessage: 'Listing: Private room in a 3-bed', lastKind: 'listing' });
    expect(lastFor(imageBody(URL, 1, 1))).toEqual({ lastMessage: 'Photo', lastKind: 'image' });
    expect(lastFor({ kind: 'recalled' })).toEqual({ lastMessage: 'Message recalled', lastKind: 'recalled' });
    expect(chatPhotoPath(CID, GUEST, 1762268400000)).toBe(`chats/${CID}/${GUEST}/1762268400000.jpg`);
    // the image URL check the rules make
    const rule = new RegExp(`^https://firebasestorage[.]googleapis[.]com/v0/b/rentlet-nu[.]firebasestorage[.]app/o/chats%2F${CID}%2F${GUEST}%2F[^/?#]+[?].*$`);
    expect(rule.test(URL)).toBe(true);
    expect(rule.test(URL.replace(`%2F${GUEST}%2F`, `%2F${HOST}%2F`))).toBe(false);
  });

  it('quotes in one short line', () => {
    expect(snippet('  Hi\n\nthere  ')).toBe('Hi there');
    expect(snippet('x'.repeat(100))).toHaveLength(80);
    expect(msgSnippet({ kind: 'image', text: '' })).toBe('Photo');
    expect(msgSnippet({ kind: 'listing', text: '', listing: listingCard(listing) })).toBe('Listing: Private room in a 3-bed');
  });

  it('limits sending and recalling like the mini program', () => {
    const t0 = 1_000_000;
    const eleven = Array.from({ length: 11 }, (_, i) => t0 + i * 100);
    expect(underLimit(eleven, t0 + 2000, { n: 12, ms: 10_000 })).toBe(true);
    expect(underLimit([...eleven, t0 + 1200], t0 + 2000, { n: 12, ms: 10_000 })).toBe(false);
    expect(underLimit([...eleven, t0 + 1200], t0 + 11_200, { n: 12, ms: 10_000 })).toBe(true);
    const mine = { kind: 'text' as const, senderId: GUEST, atMs: t0 };
    expect(recallLeft(mine, GUEST, t0 + 1000)).toBe(119);
    expect(recallLeft(mine, GUEST, t0 + 120_000)).toBe(0);
    expect(recallLeft(mine, HOST, t0)).toBe(0);
    expect(recallLeft({ ...mine, kind: 'image' }, GUEST, t0)).toBe(0);
  });

  it('scales photos to at most 1600 px on the long side', () => {
    expect(fitWithin(4032, 3024)).toEqual({ w: 1600, h: 1200 });
    expect(fitWithin(1080, 1920)).toEqual({ w: 900, h: 1600 });
    expect(fitWithin(800, 600)).toEqual({ w: 800, h: 600 });
    expect(fitWithin(0, 600)).toEqual({ w: 0, h: 0 });
  });
});

describe('conversation settings', () => {
  const data = {
    ...newConversation({ listing, hostId: HOST, guestId: GUEST, names: { [HOST]: 'Maya', [GUEST]: 'Sam' }, photos: {} }),
    lastMessage: 'Hi',
    lastSender: HOST,
    updatedAt: 100,
    pinned: { [GUEST]: true, [HOST]: 1 },
    muted: { [GUEST]: true },
    hidden: { [HOST]: 150 },
    clearedAt: { [HOST]: 150 },
    lastKind: 'bogus',
  };

  it('reads mine and keeps them per person', () => {
    const c = convFromData('12345678_guestUid456', data);
    expect(c.pinned).toEqual({ [GUEST]: true });
    expect(c.muted).toEqual({ [GUEST]: true });
    expect(c.hidden).toEqual({ [HOST]: 150 });
    expect(c.clearedAt).toEqual({ [HOST]: 150 });
    expect(c.lastKind).toBe('text');
    expect(isHiddenFor(c, HOST)).toBe(true);
    expect(isHiddenFor(c, GUEST)).toBe(false);
    expect(isHiddenFor({ ...c, updatedAtMs: 151 }, HOST)).toBe(false); // a newer message brings it back
    const g = threadView(c, { me: GUEST, msgs: [], profile: null, activeCodes: null, now });
    expect(g).toMatchObject({ pinned: true, muted: true, hidden: false, unread: true, n: { me: 0, them: 0 } });
    expect(threadView(c, { me: HOST, msgs: [], profile: null, activeCodes: null, now })).toMatchObject({ pinned: false, muted: false, hidden: true });
  });

  it('counts toward the header badge only when unread, unmuted, shown and not blocked', () => {
    expect(badgeUnread(data, GUEST)).toBe(false); // muted
    expect(badgeUnread({ ...data, muted: {} }, GUEST)).toBe(true);
    expect(badgeUnread({ ...data, muted: {}, blocked: { [GUEST]: true } }, GUEST)).toBe(false);
    expect(badgeUnread({ ...data, muted: {}, hidden: { [GUEST]: 100 } }, GUEST)).toBe(false);
    expect(badgeUnread({ ...data, muted: {}, read: { [GUEST]: 100 } }, GUEST)).toBe(false);
    expect(badgeUnread({ ...data, lastSender: GUEST }, HOST)).toBe(false); // hidden by the host
  });
});
