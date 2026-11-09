import { describe, expect, it } from 'vitest';
import { canEmailAgain, composeEmail, processMessage, type Claim, type Conversation, type Deps, type Mail, type Message, type Outcome } from './notify';

const at = (n: number) => ({ toMillis: () => n });
const PHOTO = 'https://firebasestorage.googleapis.com/v0/b/x/o/a.jpg?alt=media&token=1';

function world() {
  const w = {
    conv: {
      participants: ['ann', 'bo'],
      read: { ann: at(1000) },
      muted: {},
      blocked: {},
      names: { ann: 'Jordan', bo: 'Sam' },
      listingId: '12345678',
      listing: { title: 'Private room', photo: PHOTO, area: 'Downtown Evanston' },
    } as Conversation,
    msgs: new Map<string, Message>([['m1', { senderId: 'ann', kind: 'text', text: 'Hi there', createdAt: at(1000) }]]),
    listing: { building: 'E2 Apartments', title: 'Private room in a 2-bed', area: 'Downtown Evanston', photos: [PHOTO] } as Record<string, unknown> | null,
    pref: null as { emailMessages?: unknown } | null,
    email: 'sam@u.northwestern.edu' as string | null,
    now: 2000,
    emailedAt: null as number | null,
    sent: [] as Mail[],
    waited: [] as number[],
    failSend: false,
    onWait: null as null | (() => void),
  };
  const deps: Deps = {
    wait: async (ms) => {
      w.waited.push(ms);
      w.onWait?.();
    },
    readConversation: async () => w.conv,
    readMessage: async (_c, mid) => w.msgs.get(mid) ?? null,
    readListing: async () => w.listing,
    readPreference: async () => w.pref,
    recipientEmail: async () => w.email,
    claim: async (_c, _u, readMs): Promise<Claim | null> => {
      if (!canEmailAgain(w.emailedAt, readMs)) return null;
      const previous = w.emailedAt;
      w.emailedAt = w.now;
      return { previous };
    },
    release: async (_c, _u, claim) => {
      w.emailedAt = claim.previous as number | null;
    },
    send: async (mail) => {
      if (w.failSend) throw new Error('smtp');
      w.sent.push(mail);
    },
  };
  return { w, deps, run: (mid = 'm1') => processMessage('12345678_ann', mid, deps) };
}

describe('processMessage', () => {
  it('waits 30 seconds, then emails the other person once', async () => {
    const { w, run } = world();
    await expect(run()).resolves.toBe('sent');
    expect(w.waited).toEqual([30_000]);
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0].to).toBe('sam@u.northwestern.edu');
  });

  const skips: [string, (w: ReturnType<typeof world>['w']) => void, Outcome][] = [
    ['the conversation is gone', (w) => void (w.conv = null as unknown as Conversation), 'gone'],
    ['the message is gone', (w) => w.msgs.clear(), 'gone'],
    ['the sender is not in the conversation', (w) => void (w.conv.participants = ['x', 'y']), 'no-recipient'],
    ['the message was recalled', (w) => w.msgs.set('m1', { senderId: 'ann', kind: 'recalled', text: '', createdAt: at(1000) }), 'recalled'],
    ['the recipient read it at that moment', (w) => void (w.conv.read = { bo: at(1000) }), 'read'],
    ['the recipient read it afterwards', (w) => void (w.conv.read = { bo: at(1500) }), 'read'],
    ['the recipient blocked the sender', (w) => void (w.conv.blocked = { bo: true }), 'blocked'],
    ['the sender blocked the recipient', (w) => void (w.conv.blocked = { ann: true }), 'blocked'],
    ['the recipient muted the chat', (w) => void (w.conv.muted = { bo: true }), 'muted'],
    ['the recipient turned emails off', (w) => void (w.pref = { emailMessages: false }), 'preference-off'],
    ['the recipient has no verified email', (w) => void (w.email = null), 'no-email'],
  ];
  it.each(skips)('sends nothing when %s', async (_name, set, outcome) => {
    const { w, run } = world();
    set(w);
    await expect(run()).resolves.toBe(outcome);
    expect(w.sent).toHaveLength(0);
    expect(w.emailedAt).toBeNull();
  });

  it('emails when the preference is missing or on', async () => {
    for (const pref of [null, {}, { emailMessages: true }]) {
      const { w, run } = world();
      w.pref = pref;
      await expect(run()).resolves.toBe('sent');
    }
  });

  it('never emails someone with the chat open: they mark it read during the wait', async () => {
    const { w, run } = world();
    w.onWait = () => void (w.conv.read = { bo: at(1001) });
    await expect(run()).resolves.toBe('read');
    expect(w.sent).toHaveLength(0);
  });

  it('message, message, open, message gives two emails', async () => {
    const { w, run } = world();
    w.msgs.set('m2', { senderId: 'ann', kind: 'text', text: 'Second', createdAt: at(1100) });
    w.msgs.set('m3', { senderId: 'ann', kind: 'text', text: 'Third', createdAt: at(4000) });
    await expect(run('m1')).resolves.toBe('sent');
    await expect(run('m2')).resolves.toBe('already-emailed');
    w.conv.read = { bo: at(3000) };
    w.now = 5000;
    await expect(run('m3')).resolves.toBe('sent');
    expect(w.sent).toHaveLength(2);
    expect(w.sent[1].html).toContain('Third');
  });

  it('puts the claim back when the send fails, so a later message can try', async () => {
    const { w, run } = world();
    w.failSend = true;
    await expect(run()).resolves.toBe('send-failed');
    expect(w.emailedAt).toBeNull();
    w.failSend = false;
    await expect(run()).resolves.toBe('sent');
  });

  it('restores an earlier claim rather than clearing it', async () => {
    const { w, run } = world();
    w.emailedAt = 500;
    w.conv.read = { bo: at(600) };
    w.failSend = true;
    await expect(run()).resolves.toBe('send-failed');
    expect(w.emailedAt).toBe(500);
  });

  it('uses the conversation copy when the listing is gone', async () => {
    const { w, run } = world();
    w.listing = null;
    await run();
    expect(w.sent[0].subject).toBe('Jordan messaged you about Private room');
  });
});

describe('composeEmail', () => {
  const base = { cid: 'a_b', to: 'x@u.edu', senderId: 's', listing: null };
  const conv = (o: Partial<Conversation> = {}): Conversation => ({ names: { s: 'Jordan' }, listing: { title: 'Room', area: 'Evanston', photo: PHOTO }, ...o });
  const text = (t: string): Message => ({ kind: 'text', text: t });

  it('names the building, then the title and area', () => {
    const m = composeEmail({ ...base, conv: conv(), listing: { building: 'E2 Apartments', title: 'Private room', area: 'Downtown', photos: [PHOTO] }, message: text('Hi') });
    expect(m.subject).toBe('Jordan messaged you about E2 Apartments');
    expect(m.html).toContain('Jordan sent you a message');
    expect(m.html).toContain('Private room · Downtown');
    expect(m.text).toContain('Open the chat: https://rentlet-nu.web.app/messages?c=a_b');
  });

  it('links the chat, the profile setting and the fine print', () => {
    const m = composeEmail({ ...base, cid: 'a b/c', conv: conv(), message: text('Hi') });
    expect(m.html).toContain('messages?c=a%20b%2Fc');
    expect(m.html).toContain('https://rentlet-nu.web.app/profile#notify');
    expect(m.html).toContain('You get one email per chat until you open it.');
  });

  it('escapes every value from people', () => {
    const m = composeEmail({
      ...base,
      conv: conv({ names: { s: '<b>J</b>' }, listing: { title: '<img src=x onerror=1>', area: '"A"&' } }),
      message: text('<script>alert(1)</script>'),
    });
    expect(m.html).not.toContain('<script>');
    expect(m.html).not.toContain('<b>J</b>');
    expect(m.html).not.toContain('<img src=x');
    expect(m.html).toContain('&lt;script&gt;');
    expect(m.html).toContain('&quot;A&quot;&amp;');
  });

  it('shows the first 140 characters on one line', () => {
    const m = composeEmail({ ...base, conv: conv(), message: text('a\nb ' + 'x'.repeat(300)) });
    const quote = /<div style="margin:0 0 20px[^>]*>([^<]*)<\/div>/.exec(m.html)![1];
    expect(Array.from(quote.replace('…', '')).length).toBeLessThanOrEqual(139);
    expect(quote.startsWith('a b x')).toBe(true);
    expect(quote.endsWith('…')).toBe(true);
    expect(composeEmail({ ...base, conv: conv(), message: text('short') }).text).toContain('short');
  });

  it('describes photos and shared listings', () => {
    expect(composeEmail({ ...base, conv: conv(), message: { kind: 'image', text: '' } }).html).toContain('Sent a photo');
    expect(composeEmail({ ...base, conv: conv(), message: { kind: 'listing', text: '' } }).html).toContain('Shared a listing');
  });

  it('keeps the subject on one line', () => {
    const m = composeEmail({ ...base, conv: conv({ names: { s: 'Jo\r\nBcc: x@y.z' }, listing: { title: 'Room\r\nX-Evil: 1' } }), message: text('Hi') });
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.subject).toBe('Jo Bcc: x@y.z messaged you about Room X-Evil: 1');
  });

  it('falls back to Someone for a missing name', () => {
    const m = composeEmail({ ...base, conv: conv({ names: {} }), message: text('Hi') });
    expect(m.subject).toBe('Someone messaged you about Room');
    expect(m.html).toContain('Someone sent you a message');
  });

  it('shows a thumbnail only for a photo in Firebase Storage', () => {
    const photo = (p: string) => composeEmail({ ...base, conv: conv({ listing: { title: 'Room', photo: p } }), message: text('Hi') }).html;
    expect(photo(PHOTO)).toContain('width="64"');
    expect(photo('')).not.toContain('width="64"');
    expect(photo('http://firebasestorage.googleapis.com/a.jpg')).not.toContain('width="64"');
    expect(photo('https://tracker.example/p.gif')).not.toContain('tracker.example');
  });

  it('never carries an email address from the sender and has no reply-to', () => {
    const m = composeEmail({ ...base, conv: conv(), message: text('Hi') });
    expect(Object.keys(m).sort()).toEqual(['html', 'subject', 'text', 'to']);
  });
});
