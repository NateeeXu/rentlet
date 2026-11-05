// Who can sign in (Founder, Nov 4): any verified Google account with a school email ending in .edu,
// including subdomains (u.northwestern.edu, cs.stanford.edu). Rentlet is still about places near Northwestern.
const SCHOOL_EMAIL = /^[^@\s]+@([a-z0-9-]+\.)+edu$/i;
const NU_EMAIL = /^[^@\s]+@(u\.)?northwestern\.edu$/i;

export function isSchoolEmail(email: string | null | undefined): boolean {
  return !!email && SCHOOL_EMAIL.test(email.trim());
}

// The old name, kept for its callers: it now means any school (.edu) email, not only Northwestern.
export const isNorthwesternEmail = isSchoolEmail;

// Only for labels: whether the address is a Northwestern one.
export function isNorthwesternAddress(email: string | null | undefined): boolean {
  return !!email && NU_EMAIL.test(email.trim());
}

// Public profiles show a first name only.
export function firstName(displayName: string | null | undefined): string {
  const first = (displayName ?? '').trim().split(/\s+/)[0];
  return first || 'Student';
}
