// An email when someone messages you and you haven't opened the chat: one per chat until it is opened.
// The send waits 30 seconds first. Someone with the chat open marks it read within a second or two, so a live
// conversation never emails anyone. Logs carry the outcome only, never a message, a name or an address.
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/firestore';
import * as logger from 'firebase-functions/logger';
import { defineSecret } from 'firebase-functions/params';
import nodemailer, { type Transporter } from 'nodemailer';

export const WAIT_MS = 30_000;
export const PREVIEW_MAX = 140;
const SITE = 'https://rentlet-nu.web.app';
// Listing photos live in Firebase Storage. Anything else in a conversation's copy of the listing is left out,
// so an email can't be made to load an image from somewhere else.
const STORAGE_PHOTO = /^https:\/\/firebasestorage\.googleapis\.com\//;

export interface Conversation {
  participants?: unknown;
  read?: Record<string, unknown>;
  muted?: Record<string, unknown>;
  blocked?: Record<string, unknown>;
  names?: Record<string, unknown>;
  listingId?: unknown;
  listing?: { building?: unknown; title?: unknown; photo?: unknown; area?: unknown };
}

export interface Message {
  senderId?: unknown;
  kind?: unknown;
  text?: unknown;
  createdAt?: unknown;
}

// The public listing, when it still exists: the current building name and photo.
export interface ListingFacts {
  building?: unknown;
  title?: unknown;
  area?: unknown;
  photos?: unknown;
}

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Claim {
  previous: unknown; // what notifyState held before this claim, to put back if the send fails
}

export type Outcome =
  | 'sent'
  | 'gone'
  | 'no-recipient'
  | 'recalled'
  | 'read'
  | 'blocked'
  | 'muted'
  | 'preference-off'
  | 'no-email'
  | 'already-emailed'
  | 'send-failed';

export interface Deps {
  wait(ms: number): Promise<void>;
  readConversation(cid: string): Promise<Conversation | null>;
  readMessage(cid: string, mid: string): Promise<Message | null>;
  readListing(code: string): Promise<ListingFacts | null>;
  readPreference(uid: string): Promise<{ emailMessages?: unknown } | null>;
  recipientEmail(uid: string): Promise<string | null>;
  claim(cid: string, uid: string, readMs: number): Promise<Claim | null>;
  release(cid: string, uid: string, claim: Claim): Promise<void>;
  send(mail: Mail): Promise<void>;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const millis = (t: unknown): number =>
  t && typeof (t as { toMillis?: unknown }).toMillis === 'function' ? (t as { toMillis(): number }).toMillis() : 0;
// One line: control characters (CR and LF among them) and runs of space become a single space.
const oneLine = (s: string): string => s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
export const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function recipientOf(conv: Conversation, senderId: string): string {
  const people = Array.isArray(conv.participants) ? conv.participants.filter((p): p is string => typeof p === 'string') : [];
  if (people.length !== 2 || !people.includes(senderId)) return '';
  return people.find((p) => p !== senderId) ?? '';
}

// Why this message gets no email, going by the conversation and the message alone (null: nothing against it).
export function skipReason(conv: Conversation, msg: Message, senderId: string, recipient: string): Outcome | null {
  if (msg.kind === 'recalled') return 'recalled';
  const seen = millis(conv.read?.[recipient]);
  if (seen && seen >= millis(msg.createdAt)) return 'read';
  if (conv.blocked?.[recipient] || conv.blocked?.[senderId]) return 'blocked';
  if (conv.muted?.[recipient]) return 'muted';
  return null;
}

// One email until the chat is opened: another is due only once the recipient has read it since the last one.
export const canEmailAgain = (emailedMs: number | null, readMs: number): boolean => emailedMs === null || readMs >= emailedMs;

export function roomOf(conv: Conversation, listing: ListingFacts | null): { name: string; line: string; photo: string } {
  const snap = conv.listing ?? {};
  const building = oneLine(str(listing?.building) || str(snap.building)).slice(0, 80);
  const title = oneLine(str(listing?.title) || str(snap.title)).slice(0, 120);
  const area = oneLine(str(listing?.area) || str(snap.area)).slice(0, 80);
  const first = Array.isArray(listing?.photos) ? str(listing.photos[0]) : '';
  const photo = first || str(snap.photo);
  return {
    name: building || title,
    line: [building ? title : '', area].filter(Boolean).join(' · '),
    photo: STORAGE_PHOTO.test(photo) ? photo : '',
  };
}

export function previewOf(msg: Message): string {
  if (msg.kind === 'image') return 'Sent a photo';
  if (msg.kind === 'listing') return 'Shared a listing';
  const text = oneLine(str(msg.text));
  if (!text) return 'Sent you a message';
  const chars = Array.from(text); // never cut an emoji in half
  return chars.length > PREVIEW_MAX ? chars.slice(0, PREVIEW_MAX - 1).join('').trimEnd() + '…' : text;
}

export function composeEmail(o: { cid: string; to: string; senderId: string; conv: Conversation; listing: ListingFacts | null; message: Message }): Mail {
  const name = oneLine(str(o.conv.names?.[o.senderId])).slice(0, 40) || 'Someone';
  const room = roomOf(o.conv, o.listing);
  const preview = previewOf(o.message);
  const chat = `${SITE}/messages?c=${encodeURIComponent(o.cid)}`;
  const settings = `${SITE}/profile#notify`;
  const heading = `${name} sent you a message`;
  const subject = oneLine(room.name ? `${name} messaged you about ${room.name}` : heading).slice(0, 180);
  const fine = 'You get one email per chat until you open it. To answer, open the chat: replies to this email don’t reach them.';
  const off = 'Turn this off in Profile.';

  const roomText = `<div style="font-size:15px;font-weight:600;line-height:1.35">${escapeHtml(room.name)}</div>${
    room.line ? `<div style="margin-top:2px;font-size:13px;line-height:1.4;color:#717171">${escapeHtml(room.line)}</div>` : ''
  }`;
  const roomBlock = !room.name
    ? ''
    : room.photo
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px"><tr><td style="padding:0 12px 0 0;vertical-align:middle"><img src="${escapeHtml(room.photo)}" alt="" width="64" height="64" style="display:block;width:64px;height:64px;object-fit:cover;border-radius:12px"></td><td style="vertical-align:middle">${roomText}</td></tr></table>`
      : `<div style="margin:0 0 14px">${roomText}</div>`;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f7f7f7"><div style="box-sizing:border-box;max-width:480px;margin:0 auto;padding:24px;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#222222"><img src="${SITE}/img/rentlet-logo.png" alt="Rentlet" height="26" style="display:block;height:26px;margin:0 0 20px"><h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;font-weight:650">${escapeHtml(heading)}</h1>${roomBlock}<div style="margin:0 0 20px;padding:12px 14px;background:#f5f4f7;border-radius:12px;font-size:15px;line-height:1.45">${escapeHtml(preview)}</div><a href="${escapeHtml(chat)}" style="display:inline-block;padding:12px 24px;border-radius:999px;background:#222222;color:#ffffff;font-size:15px;font-weight:650;text-decoration:none">Open the chat</a><p style="margin:20px 0 0;font-size:12.5px;line-height:1.5;color:#717171">${fine} <a href="${settings}" style="color:#717171">${off}</a></p></div></body></html>`;

  const text = [heading, room.name, room.line, '', preview, '', `Open the chat: ${chat}`, '', `${fine} ${off} ${settings}`]
    .filter((l, i) => l !== '' || i === 3 || i === 5 || i === 7)
    .join('\n');

  return { to: o.to, subject, text, html };
}

export async function processMessage(cid: string, mid: string, d: Deps): Promise<Outcome> {
  await d.wait(WAIT_MS);
  const [conv, message] = await Promise.all([d.readConversation(cid), d.readMessage(cid, mid)]);
  if (!conv || !message) return 'gone';
  const senderId = str(message.senderId);
  const recipient = recipientOf(conv, senderId);
  if (!recipient) return 'no-recipient';
  const skip = skipReason(conv, message, senderId, recipient);
  if (skip) return skip;
  const preference = await d.readPreference(recipient);
  if (preference?.emailMessages === false) return 'preference-off';
  const to = await d.recipientEmail(recipient);
  if (!to) return 'no-email';
  const code = str(conv.listingId);
  const listing = code ? await d.readListing(code).catch(() => null) : null;
  const claim = await d.claim(cid, recipient, millis(conv.read?.[recipient]));
  if (!claim) return 'already-emailed';
  try {
    await d.send(composeEmail({ cid, to, senderId, conv, listing, message }));
    return 'sent';
  } catch {
    await d.release(cid, recipient, claim).catch(() => undefined);
    return 'send-failed';
  }
}

const MAIL_USER = defineSecret('MAIL_USER');
const MAIL_PASSWORD = defineSecret('MAIL_PASSWORD');

if (!getApps().length) initializeApp();

let mailer: Transporter | null = null;
const transport = (): Transporter =>
  (mailer ??= nodemailer.createTransport({
    host: 'smtp.exmail.qq.com', // the sending mailbox is on Tencent Exmail
    port: 465,
    secure: true,
    auth: { user: MAIL_USER.value(), pass: MAIL_PASSWORD.value() },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  }));

const data = async (path: string) => (await getFirestore().doc(path).get()).data() ?? null;

const live: Deps = {
  wait: (ms) => new Promise((done) => setTimeout(done, ms)),
  readConversation: (cid) => data(`conversations/${cid}`),
  readMessage: (cid, mid) => data(`conversations/${cid}/messages/${mid}`),
  readListing: (code) => data(`listings/${code}`),
  readPreference: (uid) => data(`users/${uid}/private/notifications`),
  recipientEmail: async (uid) => {
    try {
      const u = await getAuth().getUser(uid);
      return u.emailVerified && u.email ? u.email : null;
    } catch {
      return null;
    }
  },
  claim: (cid, uid, readMs) => {
    const db = getFirestore();
    const ref = db.doc(`notifyState/${cid}_${uid}`);
    return db.runTransaction(async (tx) => {
      const previous: unknown = (await tx.get(ref)).data()?.emailedAt ?? null;
      if (!canEmailAgain(millis(previous) || null, readMs)) return null;
      tx.set(ref, { emailedAt: Timestamp.now() });
      return { previous };
    });
  },
  release: async (cid, uid, claim) => {
    const ref = getFirestore().doc(`notifyState/${cid}_${uid}`);
    if (claim.previous) await ref.set({ emailedAt: claim.previous });
    else await ref.delete();
  },
  send: async (mail) => {
    await transport().sendMail({ from: { name: 'Rentlet', address: MAIL_USER.value() }, ...mail });
  },
};

// Each run mostly waits, so one instance holds many at once (concurrency above 1 needs a whole CPU).
export const emailOnMessage = onDocumentCreated(
  {
    document: 'conversations/{cid}/messages/{mid}',
    region: 'us-central1',
    secrets: [MAIL_USER, MAIL_PASSWORD],
    memory: '256MiB',
    cpu: 1,
    concurrency: 20,
    timeoutSeconds: 60,
    maxInstances: 5,
    retry: false,
  },
  async (event) => {
    try {
      logger.info('message email', { outcome: await processMessage(event.params.cid, event.params.mid, live) });
    } catch (e) {
      logger.warn('message email failed', { error: (e as Error)?.name ?? 'Error' });
    }
  },
);
