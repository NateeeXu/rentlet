// The post form's edit mode (post.html?edit={code}, opened from Profile): a published listing turned back
// into the form's answers, and which files a save stops using. Pure and tested; src/listings.ts does the I/O.
import { CAMPUS_NAME, type ListingDoc } from './listingView';
import { listingFilePaths } from './profileData';

export const AREA_CAPTION: Record<string, string> = {
  bedroom: 'Bedroom',
  living: 'Living room',
  bath: 'Bathroom',
  kitchen: 'Kitchen',
  building: 'Window or building',
};
// The order photos are stored in: the first bedroom photo is the listing's cover.
export const AREA_ORDER = ['bedroom', 'living', 'kitchen', 'bath', 'building'];

// listings/{code}/private/location, which only the host can read.
export interface PrivateLocation {
  address: string;
  building: string;
  site: string;
  zip: string | null;
}

// Each photo back in its area, by the caption it was saved with. An unknown caption counts as the bedroom.
export function photosByArea(photos: unknown, captions: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = Object.fromEntries(AREA_ORDER.map((a) => [a, [] as string[]]));
  const caps = Array.isArray(captions) ? captions : [];
  (Array.isArray(photos) ? photos : []).forEach((url, i) => {
    if (typeof url !== 'string' || !url.startsWith('https://')) return;
    const area = AREA_ORDER.find((a) => AREA_CAPTION[a] === caps[i]) ?? 'bedroom';
    out[area].push(url);
  });
  return out;
}

// The post form's answers for a listing. The map point stays as saved, so a moved pin keeps its spot and an
// unchanged address is not looked up again. `video` is the label the Photos step shows; a save keeps the file.
export function editState(l: ListingDoc, loc: PrivateLocation) {
  const form = JSON.parse(JSON.stringify(l.form ?? {}));
  const address = loc.address.trim();
  return {
    ...form,
    f: { ...(form.f ?? {}), addr: loc.address, building: loc.building || l.building || '', site: loc.site },
    subletType: l.kind,
    campusId: l.campusId,
    campus: form.campus || CAMPUS_NAME[l.campusId] || '',
    start: l.start,
    end: l.end,
    rent: l.price,
    multi: { fees: [], amen: [], habits: [], items: [], ...(form.multi ?? {}) },
    prefs: form.prefs ?? {},
    photos: photosByArea(l.photos, l.captions),
    video: l.video ? 'Current video' : null,
    place:
      l.location && address
        ? { lat: l.location.lat, lng: l.location.lng, area: l.area, zip: loc.zip, walk: l.walk, label: address, campusId: l.campusId }
        : null,
  };
}

// The old listing's photos and video that the saved one no longer uses (only this host's files for this listing).
export function removedFiles(
  old: Pick<ListingDoc, 'code' | 'photos' | 'video'>,
  uid: string,
  photos: string[],
  video: string | null,
): string[] {
  const kept = new Set(listingFilePaths({ code: old.code, photos, video }, uid));
  return listingFilePaths(old, uid).filter((p) => !kept.has(p));
}
