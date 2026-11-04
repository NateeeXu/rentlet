// Rentlet is for Northwestern students and staff. Student accounts are @u.northwestern.edu
// Google Workspace accounts; staff and instructors use @northwestern.edu.
const NU_EMAIL = /^[^@\s]+@(u\.)?northwestern\.edu$/i;

export function isNorthwesternEmail(email: string | null | undefined): boolean {
  return !!email && NU_EMAIL.test(email.trim());
}

// Public profiles show a first name only.
export function firstName(displayName: string | null | undefined): string {
  const first = (displayName ?? '').trim().split(/\s+/)[0];
  return first || 'Northwestern student';
}
