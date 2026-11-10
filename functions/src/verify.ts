// The student tag: confirm a .edu address with a 6-digit code sent to it. Only these functions (the Admin SDK) can
// write verifications/{uid}, the public yes/no the tag reads, so nobody can give themselves the tag. The rest is
// private: schoolEmails/{hash} (one address, one account), verifyCodes/{uid} and verifyTargets/{hash} (no client rule).
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { HttpsError, onCall, type CallableOptions, type CallableRequest } from 'firebase-functions/https';
import * as logger from 'firebase-functions/logger';
import { MAIL_PASSWORD, MAIL_USER, transport } from './notify.js';

export const CODE_TTL_MS = 10 * 60_000;
export const RESEND_MS = 60_000;
export const MAX_SENDS_PER_DAY = 6; // per account
export const MAX_TO_ONE_ADDRESS_PER_DAY = 5; // per address, so nobody can flood someone else's inbox
export const MAX_TRIES = 5;
const DAY_MS = 24 * 60 * 60_000;

const SCHOOL_EMAIL = /^[^@\s]+@([a-z0-9-]+\.)+edu$/;

// A trimmed, lower-case .edu address, or null.
export function normalizeEmail(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const email = x.trim().toLowerCase();
  return email.length <= 254 && SCHOOL_EMAIL.test(email) ? email : null;
}

export const emailKey = (email: string): string => createHash('sha256').update(email).digest('hex');
export const codeDigest = (uid: string, code: string): string => createHash('sha256').update(`${uid}:${code}`).digest('hex');
export const newCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, '0');

export interface CodeState {
  email?: string;
  digest?: string;
  expiresAt?: number;
  tries?: number;
  sentAt?: number;
  dayStart?: number;
  sends?: number;
}

export interface Counter {
  dayStart?: number;
  sends?: number;
}

// How many sends count toward today's limit, starting over once a day has passed.
export const sendsToday = (c: Counter | undefined, now: number): number => (c && now - (c.dayStart ?? 0) < DAY_MS ? (c.sends ?? 0) : 0);

export type SendCheck = { ok: true } | { ok: false; reason: 'wait'; seconds: number } | { ok: false; reason: 'limit' };

export function canSend(state: CodeState | undefined, target: Counter | undefined, now: number): SendCheck {
  const since = now - (state?.sentAt ?? 0);
  if (since < RESEND_MS) return { ok: false, reason: 'wait', seconds: Math.ceil((RESEND_MS - since) / 1000) };
  if (sendsToday(state, now) >= MAX_SENDS_PER_DAY || sendsToday(target, now) >= MAX_TO_ONE_ADDRESS_PER_DAY) return { ok: false, reason: 'limit' };
  return { ok: true };
}

export type CodeCheck = 'ok' | 'none' | 'expired' | 'too-many' | 'wrong';

export function checkCode(state: CodeState | undefined, uid: string, code: string, now: number): CodeCheck {
  if (!state?.digest || !state.email) return 'none';
  if (now > (state.expiresAt ?? 0)) return 'expired';
  if ((state.tries ?? 0) >= MAX_TRIES) return 'too-many';
  const a = Buffer.from(state.digest, 'hex');
  const b = Buffer.from(codeDigest(uid, code), 'hex');
  return a.length === b.length && timingSafeEqual(a, b) ? 'ok' : 'wrong';
}

// The email: nothing in it comes from anyone but Rentlet.
export function codeEmail(code: string): { subject: string; text: string; html: string } {
  const subject = 'Your Rentlet verification code';
  const text = `${code}\n\nEnter this code on Rentlet to verify your school email. It expires in 10 minutes.\n\nIf you didn't ask for it, you can ignore this email.`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f7f7f7"><div style="box-sizing:border-box;max-width:480px;margin:0 auto;padding:28px 24px;background:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#222"><img src="https://rentlet-nu.web.app/img/rentlet-logo.png" alt="Rentlet" height="26" style="display:block;height:26px;margin:0 0 18px"><h1 style="font-size:20px;font-weight:650;margin:0 0 14px">Your verification code</h1><p style="margin:0 0 14px;font-size:34px;font-weight:700;letter-spacing:6px">${code}</p><p style="margin:0;font-size:15px;line-height:1.5">Enter this code on Rentlet to verify your school email. It expires in 10 minutes.</p><p style="margin:18px 0 0;font-size:12.5px;color:#717171">If you didn't ask for it, you can ignore this email.</p></div></body></html>`;
  return { subject, text, html };
}

const OPTIONS: CallableOptions = { region: 'us-central1', memory: '256MiB', timeoutSeconds: 30, maxInstances: 5 };

function accountOf(req: CallableRequest): string {
  if (!req.auth) throw new HttpsError('unauthenticated', 'Sign in first.');
  if (req.auth.token.email_verified !== true) throw new HttpsError('permission-denied', 'Sign in with a Google account with a verified email.');
  return req.auth.uid;
}

const refuse = (reason: string, seconds?: number) => new HttpsError('failed-precondition', reason, { reason, ...(seconds ? { seconds } : {}) });

async function accountExists(uid: string): Promise<boolean> {
  try {
    await getAuth().getUser(uid);
    return true;
  } catch (e) {
    return (e as { code?: string }).code !== 'auth/user-not-found';
  }
}

export const sendSchoolCode = onCall({ ...OPTIONS, secrets: [MAIL_USER, MAIL_PASSWORD] }, async (req): Promise<{ ok: true }> => {
  const uid = accountOf(req);
  const email = normalizeEmail((req.data as { email?: unknown } | null)?.email);
  if (!email) throw refuse('not-edu');
  const db = getFirestore();
  const key = emailKey(email);
  const claimRef = db.doc(`schoolEmails/${key}`);
  const claim = (await claimRef.get()).data() as { uid?: string } | undefined;
  if (claim?.uid && claim.uid !== uid) {
    // an address held by a deleted account is free again
    if (await accountExists(claim.uid)) throw refuse('taken');
    await claimRef.delete();
  }
  const code = newCode();
  const now = Date.now();
  const codeRef = db.doc(`verifyCodes/${uid}`);
  const targetRef = db.doc(`verifyTargets/${key}`);
  const before = await db.runTransaction(async (tx) => {
    const [stateSnap, targetSnap] = await Promise.all([tx.get(codeRef), tx.get(targetRef)]);
    const state = stateSnap.data() as CodeState | undefined;
    const target = targetSnap.data() as Counter | undefined;
    const check = canSend(state, target, now);
    if (!check.ok) throw refuse(check.reason, check.reason === 'wait' ? check.seconds : undefined);
    const count = (c: Counter | undefined) => (sendsToday(c, now) ? { dayStart: c!.dayStart, sends: sendsToday(c, now) + 1 } : { dayStart: now, sends: 1 });
    tx.set(codeRef, { email, digest: codeDigest(uid, code), expiresAt: now + CODE_TTL_MS, tries: 0, sentAt: now, ...count(state) });
    tx.set(targetRef, count(target));
    return state;
  });
  try {
    await transport().sendMail({ from: { name: 'Rentlet', address: MAIL_USER.value() }, to: email, ...codeEmail(code) });
  } catch (e) {
    // the code never arrived, so it doesn't count against waiting
    await codeRef.set({ ...(before ?? {}), digest: FieldValue.delete(), sentAt: before?.sentAt ?? 0 }, { merge: true }).catch(() => undefined);
    logger.warn('School code email failed', { code: (e as { code?: string }).code ?? '' });
    throw refuse('send-failed');
  }
  return { ok: true };
});

export const verifySchoolCode = onCall(OPTIONS, async (req): Promise<{ ok: true; email: string }> => {
  const uid = accountOf(req);
  const code = String((req.data as { code?: unknown } | null)?.code ?? '').replace(/\D/g, '').slice(0, 6);
  if (code.length !== 6) throw refuse('wrong');
  const db = getFirestore();
  const codeRef = db.doc(`verifyCodes/${uid}`);
  const result = await db.runTransaction(async (tx): Promise<{ v: CodeCheck | 'taken'; email?: string }> => {
    const state = (await tx.get(codeRef)).data() as CodeState | undefined;
    const v = checkCode(state, uid, code, Date.now());
    if (v === 'wrong') {
      tx.update(codeRef, { tries: FieldValue.increment(1) });
      return { v };
    }
    if (v !== 'ok') return { v };
    const claimRef = db.doc(`schoolEmails/${emailKey(state!.email!)}`);
    const claim = (await tx.get(claimRef)).data() as { uid?: string } | undefined;
    if (claim?.uid && claim.uid !== uid) return { v: 'taken' };
    tx.set(claimRef, { uid, at: FieldValue.serverTimestamp() });
    tx.set(db.doc(`verifications/${uid}`), { school: true, verifiedAt: FieldValue.serverTimestamp() });
    tx.set(db.doc(`users/${uid}/private/verification`), { email: state!.email!, verifiedAt: FieldValue.serverTimestamp() });
    tx.delete(codeRef);
    return { v, email: state!.email! };
  });
  if (result.v !== 'ok') throw refuse(result.v);
  return { ok: true, email: result.email! };
});
