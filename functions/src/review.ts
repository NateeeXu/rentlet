// The Rentlet team's review page (review.html). Who is on the team is the secret ADMIN_EMAILS (comma-separated sign-in
// emails), so the list never sits in the repository. claimAdmin gives a team member the `admin` token claim the rules
// read; everything a reviewer decides goes through these functions, which alone write reviews/{code}.
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall, type CallableOptions, type CallableRequest } from 'firebase-functions/https';
import * as logger from 'firebase-functions/logger';
import { logoAttachment } from './logo.js';
import { MAIL_PASSWORD, MAIL_USER, escapeHtml, transport } from './notify.js';

const ADMIN_EMAILS = defineSecret('ADMIN_EMAILS');
const OPTIONS: CallableOptions = { region: 'us-central1', memory: '256MiB', timeoutSeconds: 30, maxInstances: 5, secrets: [ADMIN_EMAILS] };
const SITE = 'https://rentlet-nu.web.app';

export const adminList = (raw: string): string[] => raw.split(/[\s,;]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.includes('@'));
export const isOnTeam = (token: { email?: unknown; email_verified?: unknown } | undefined, list: string[]): boolean =>
  !!token && token.email_verified === true && typeof token.email === 'string' && list.includes(token.email.trim().toLowerCase());

const CODE = /^[1-9][0-9]{7}$/;
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

// A decision that turns a host down needs a category and a sentence the host can act on.
export const LISTING_REASONS = ['Photos don’t show the place', 'Details look wrong', 'Looks like a scam', 'Not a sublet or lease takeover', 'Duplicate listing', 'Other'];
export const LEASE_REASONS = ['Name not visible', 'Address doesn’t match', 'Not a lease or landlord email', 'Hard to read', 'Other'];
export function reasonOf(data: { reason?: unknown; note?: unknown }, allowed: string[]): string | null {
  const reason = clean(data.reason, 60);
  const note = clean(data.note, 300);
  if (!allowed.includes(reason) || note.length < 10) return null;
  return `${reason}: ${note}`;
}

function teamMember(req: CallableRequest): string {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  if (!isOnTeam(req.auth.token, adminList(ADMIN_EMAILS.value()))) throw new HttpsError('permission-denied', 'This is for the Rentlet team.');
  return req.auth.uid;
}

// Tells the host what happened and why; a failure to send never undoes the decision.
async function tellHost(ownerId: string, subject: string, heading: string, body: string, link: string, linkText: string) {
  try {
    const u = await getAuth().getUser(ownerId);
    if (!u.email || !u.emailVerified) return;
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f7f7f7"><div style="box-sizing:border-box;max-width:480px;margin:0 auto;padding:28px 24px;background:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#222"><img src="cid:rentlet-logo" alt="Rentlet" width="99" height="26" style="display:block;width:99px;height:26px;border:0;margin:0 0 18px"><h1 style="font-size:20px;font-weight:650;margin:0 0 14px">${escapeHtml(heading)}</h1><p style="margin:0 0 18px;font-size:15px;line-height:1.5;padding:12px 14px;background:#f5f4f7;border-radius:12px">${escapeHtml(body)}</p><a href="${link}" style="display:inline-block;background:#222;color:#fff;text-decoration:none;border-radius:999px;padding:12px 24px;font-size:15px;font-weight:650">${escapeHtml(linkText)}</a></div></body></html>`;
    await transport().sendMail({ from: { name: 'Rentlet', address: MAIL_USER.value() }, to: u.email, subject, text: `${heading}\n\n${body}\n\n${linkText}: ${link}`, html, attachments: [logoAttachment()] });
  } catch (e) {
    logger.warn('Review email failed', { code: (e as { code?: string }).code ?? '' });
  }
}

export const claimAdmin = onCall(OPTIONS, async (req): Promise<{ admin: boolean }> => {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  const on = isOnTeam(req.auth.token, adminList(ADMIN_EMAILS.value()));
  if (on !== (req.auth.token.admin === true)) {
    const u = await getAuth().getUser(req.auth.uid);
    const claims = { ...(u.customClaims ?? {}) } as Record<string, unknown>;
    if (on) claims.admin = true;
    else delete claims.admin;
    await getAuth().setCustomUserClaims(req.auth.uid, claims);
  }
  return { admin: on };
});

const MAIL_OPTIONS: CallableOptions = { ...OPTIONS, secrets: [ADMIN_EMAILS, MAIL_USER, MAIL_PASSWORD] };

export const reviewListing = onCall(MAIL_OPTIONS, async (req): Promise<{ ok: true }> => {
  const by = teamMember(req);
  const d = (req.data ?? {}) as { code?: unknown; action?: unknown; reason?: unknown; note?: unknown };
  const code = String(d.code ?? '');
  if (!CODE.test(code) || (d.action !== 'approve' && d.action !== 'hide')) throw new HttpsError('invalid-argument', 'bad');
  const reason = d.action === 'hide' ? reasonOf(d, LISTING_REASONS) : '';
  if (reason === null) throw new HttpsError('invalid-argument', 'reason');
  const db = getFirestore();
  const ref = db.doc(`listings/${code}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'missing');
  const batch = db.batch();
  if (d.action === 'hide') batch.update(ref, { status: 'hidden' });
  // approving a listing the team took down (and the host has since edited) puts it back on search
  else if (snap.data()?.status === 'hidden' && (await db.doc(`reviews/${code}`).get()).data()?.listing === 'hidden') batch.update(ref, { status: 'active' });
  batch.set(db.doc(`reviews/${code}`), { listing: d.action === 'approve' ? 'approved' : 'hidden', listingReason: reason, listingAt: FieldValue.serverTimestamp(), listingBy: by }, { merge: true });
  await batch.commit();
  if (d.action === 'hide') {
    const name = String(snap.data()?.building || snap.data()?.title || 'Your listing');
    await tellHost(String(snap.data()?.ownerId ?? ''), `${name} was taken down`, `The Rentlet team took down ${name}`, `${reason}\n\nEdit the listing to fix this and the team will look at it again.`, `${SITE}/profile#listings`, 'Open your listings');
  }
  return { ok: true };
});

export const reviewLease = onCall(MAIL_OPTIONS, async (req): Promise<{ ok: true }> => {
  const by = teamMember(req);
  const d = (req.data ?? {}) as { code?: unknown; action?: unknown; reason?: unknown; note?: unknown };
  const code = String(d.code ?? '');
  if (!CODE.test(code) || (d.action !== 'verify' && d.action !== 'return')) throw new HttpsError('invalid-argument', 'bad');
  const reason = d.action === 'return' ? reasonOf(d, LEASE_REASONS) : '';
  if (reason === null) throw new HttpsError('invalid-argument', 'reason');
  const db = getFirestore();
  const snap = await db.doc(`listings/${code}`).get();
  if (!snap.exists || snap.data()?.form?.proof !== 'lease') throw new HttpsError('not-found', 'missing');
  await db.doc(`reviews/${code}`).set({ lease: d.action === 'verify' ? 'verified' : 'returned', leaseReason: reason, leaseAt: FieldValue.serverTimestamp(), leaseBy: by }, { merge: true });
  if (d.action === 'return') {
    const name = String(snap.data()?.building || snap.data()?.title || 'your listing');
    await tellHost(String(snap.data()?.ownerId ?? ''), `Lease proof for ${name} needs another look`, `Your lease proof for ${name} was sent back`, reason, `${SITE}/verification`, 'Add new lease proof');
  }
  return { ok: true };
});

export const resolveReport = onCall(MAIL_OPTIONS, async (req): Promise<{ ok: true }> => {
  const by = teamMember(req);
  const d = (req.data ?? {}) as { id?: unknown; action?: unknown; reason?: unknown; note?: unknown };
  const id = clean(d.id, 64);
  if (!id || (d.action !== 'hide' && d.action !== 'dismiss')) throw new HttpsError('invalid-argument', 'bad');
  const db = getFirestore();
  const rep = await db.doc(`reports/${id}`).get();
  if (!rep.exists) throw new HttpsError('not-found', 'missing');
  if (d.action === 'hide') {
    const code = String(rep.data()?.listingId ?? '');
    const reason = reasonOf(d, LISTING_REASONS);
    if (!CODE.test(code)) throw new HttpsError('invalid-argument', 'bad');
    if (reason === null) throw new HttpsError('invalid-argument', 'reason');
    const listing = await db.doc(`listings/${code}`).get();
    const batch = db.batch();
    if (listing.exists) batch.update(listing.ref, { status: 'hidden' });
    batch.set(db.doc(`reviews/${code}`), { listing: 'hidden', listingReason: reason, listingAt: FieldValue.serverTimestamp(), listingBy: by }, { merge: true });
    batch.update(rep.ref, { status: 'hidden', resolvedAt: FieldValue.serverTimestamp(), resolvedBy: by });
    await batch.commit();
    if (listing.exists) {
      const name = String(listing.data()?.building || listing.data()?.title || 'Your listing');
      await tellHost(String(listing.data()?.ownerId ?? ''), `${name} was taken down`, `The Rentlet team took down ${name}`, reason, `${SITE}/profile#listings`, 'Open your listings');
    }
  } else await rep.ref.update({ status: 'dismissed', resolvedAt: FieldValue.serverTimestamp(), resolvedBy: by });
  return { ok: true };
});

export const resolveFeedback = onCall(OPTIONS, async (req): Promise<{ ok: true }> => {
  const by = teamMember(req);
  const id = clean((req.data as { id?: unknown } | null)?.id, 64);
  if (!id) throw new HttpsError('invalid-argument', 'bad');
  const ref = getFirestore().doc(`feedback/${id}`);
  if (!(await ref.get()).exists) throw new HttpsError('not-found', 'missing');
  await ref.update({ status: 'done', resolvedAt: FieldValue.serverTimestamp(), resolvedBy: by });
  return { ok: true };
});
