// Who can sign in (Founder, Nov 9): any Google account with a verified email. The student tag is separate: it takes
// a .edu address confirmed with a code (verifications/{uid}, written by functions/src/verify.ts).
export const canSignIn = (u: { emailVerified: boolean } | null | undefined): boolean => !!u && u.emailVerified;

const SCHOOL_EMAIL = /^[^@\s]+@([a-z0-9-]+\.)+edu$/i;
const NU_EMAIL = /^[^@\s]+@(u\.)?northwestern\.edu$/i;

export function isSchoolEmail(email: string | null | undefined): boolean {
  return !!email && SCHOOL_EMAIL.test(email.trim());
}

// Only for labels: whether the address is a Northwestern one.
export function isNorthwesternAddress(email: string | null | undefined): boolean {
  return !!email && NU_EMAIL.test(email.trim());
}

// Public profiles show a first name only.
export function firstName(displayName: string | null | undefined): string {
  const first = (displayName ?? '').trim().split(/\s+/)[0];
  return first || 'Member';
}
