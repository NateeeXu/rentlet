// Link previews for shared rooms: GET /r/{code} (Hosting rewrite -> sharePreview). Chat apps
// (iMessage, WhatsApp, Facebook, GroupMe, WeChat) read a page's Open Graph tags without running its
// scripts, and the room page fills itself in with scripts, so shared links point here instead: this
// page carries the room's cover photo, title, price and dates, and sends a person straight on to the
// room page. Only active listings are described; any other code gets the site's own preview.
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/https';
import * as logger from 'firebase-functions/logger';

export const SITE = 'https://rentlet-nu.web.app';
const CODE = /^[1-9][0-9]{7}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface PreviewRoom {
  title: string;
  price: number;
  start: string;
  end: string;
  area: string;
  photo: string;
}

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

// /r/12345678 -> '12345678'; anything else -> ''
export function codeFromPath(path: string): string {
  const m = /^\/r\/([^/?#]+)\/?$/.exec(path);
  return m && CODE.test(m[1]) ? m[1] : '';
}

// 'Jan 3 – Jun 12, 2027', or 'Dec 1, 2026 – Jan 31, 2027' across years (the site's one date format)
export function dateRange(start: string, end: string): string {
  const p = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return { y, md: `${MONTHS[m - 1]} ${d}` };
  };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return '';
  const a = p(start);
  const b = p(end);
  return a.y === b.y ? `${a.md} – ${b.md}, ${b.y}` : `${a.md}, ${a.y} – ${b.md}, ${b.y}`;
}

export function toPreview(d: Record<string, unknown> | undefined): PreviewRoom | null {
  if (!d || d.status !== 'active') return null;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const photos = Array.isArray(d.photos) ? d.photos : [];
  const photo = str(photos[0]);
  return {
    title: str(d.title).slice(0, 120) || 'A room near Northwestern',
    price: typeof d.price === 'number' ? d.price : 0,
    start: str(d.start),
    end: str(d.end),
    area: str(d.area).slice(0, 80),
    photo: /^https:\/\//.test(photo) ? photo : '',
  };
}

export function previewHtml(room: PreviewRoom | null, code: string): string {
  const to = room ? `${SITE}/room?room=${code}` : `${SITE}/`;
  const title = room
    ? `${room.title}${room.price ? ` · $${room.price.toLocaleString('en-US')} / mo` : ''}`
    : 'Rentlet · Sublets near Northwestern';
  const desc = room
    ? [dateRange(room.start, room.end), room.area].filter(Boolean).join(' · ')
    : 'Sublets and lease takeovers between Northwestern students.';
  const image = room?.photo || `${SITE}/apple-touch-icon.png`;
  const self = code ? `${SITE}/r/${code}` : `${SITE}/`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Rentlet">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:url" content="${esc(self)}">
<meta name="twitter:card" content="${room?.photo ? 'summary_large_image' : 'summary'}">
<link rel="canonical" href="${esc(to)}">
<meta http-equiv="refresh" content="0;url=${esc(to)}">
<script>location.replace(${JSON.stringify(to)})</script>
</head><body><p><a href="${esc(to)}">Open on Rentlet</a></p></body></html>`;
}

if (!getApps().length) initializeApp();

export const sharePreview = onRequest(
  { region: 'us-central1', invoker: 'public', memory: '256MiB', timeoutSeconds: 10, maxInstances: 5 },
  async (req, res) => {
    const code = codeFromPath(req.path);
    let room: PreviewRoom | null = null;
    if (code) {
      try {
        room = toPreview((await getFirestore().doc(`listings/${code}`).get()).data());
      } catch (e) {
        logger.warn('share preview lookup failed', { code, error: String(e) });
      }
    }
    // a few minutes at the CDN: a price or photo change shows up in new previews soon after
    res.set('Cache-Control', 'public, max-age=300, s-maxage=300').type('html').send(previewHtml(room, code));
  },
);
