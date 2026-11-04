// Northwestern's shuttles, ported from the CloudSublet mini program's shuttle map
// (pages/shuttle-map/northwestern-intercampus-data.js, shuttle-routes.js, campus-zones-data.js).
// Road shapes and stops come from the university's real-time system (TripShot); stops are
// [name, longitude, latitude, TripShot stop id, listing region], and the stop ids match TripShot's
// live arrival predictions (functions/src/shuttle.ts). Hours come from Northwestern Transportation &
// Parking's route pages. Campus and neighborhood outlines are from City of Chicago, OpenStreetMap and
// US Census TIGER boundaries. Pure data and helpers (no DOM), so the room page can reuse them.

export interface Point {
  lat: number;
  lng: number;
}

export type LineId = 'intercampus' | 'loop';
export type DirectionId = 'to-chicago' | 'to-evanston' | 'loop-a' | 'loop-b';
export type RegionId = 'north_evanston' | 'downtown_evanston' | 'south_evanston' | '';
export type ZoneId = 'nu-campus' | 'northwestern-chicago-streeterville' | 'north-evanston' | 'downtown-evanston' | 'south-evanston';

type RawStop = [name: string, lng: number, lat: number, tripshotStopId: string, region: RegionId];

export interface Stop extends Point {
  id: string; // TripShot stop id (lower case), the key of live arrival predictions
  name: string;
  region: RegionId;
}

export interface Direction {
  id: DirectionId;
  line: LineId;
  label: string;
  route: string; // where it runs, in a few words
  color: string;
  hours: string; // service hours, Chicago time
  stops: Stop[];
}

export interface Line {
  id: LineId;
  label: string;
  summary: string;
  directions: DirectionId[];
}

export interface Zone {
  id: ZoneId;
  name: string;
  kind: 'campus' | 'area';
  label: Point;
  points: Point[];
}

export const SOURCES = {
  live: { label: 'Northwestern shuttle system (TripShot)', url: 'https://northwestern.tripshot.com' },
  shapes: { label: 'Northwestern shuttle system (TripShot)', checkedAt: '2026-10-22' },
  intercampus: {
    label: 'Northwestern Transportation & Parking',
    url: 'https://www.northwestern.edu/transportation-parking/shuttles/routes/intercampus.html',
    checkedAt: '2026-11-04',
  },
  loop: {
    label: 'Northwestern Transportation & Parking',
    url: 'https://www.northwestern.edu/transportation-parking/shuttles/routes/loop-shuttle.html',
    checkedAt: '2026-11-04',
  },
  zones: { label: 'City of Chicago, OpenStreetMap and US Census TIGER boundaries', checkedAt: '2026-10-22' },
} as const;

// Rentlet purple for the Intercampus line; the evening Loop's two patterns in colors that read on the map.
export const LINE_COLOR = { intercampus: '#4E2A84', loopA: '#e8590c', loopB: '#1c7ed6' } as const;

export const REGION_LABEL: Record<RegionId, string> = {
  north_evanston: 'North Evanston',
  downtown_evanston: 'Downtown Evanston',
  south_evanston: 'South Evanston',
  '': '',
};

// TripShot road shapes, checked 2026-10-22 (SOURCES.shapes).
const ENCODED: Record<DirectionId, string> = {
  'to-chicago': 'i_w_GnufvOhIBFeZJ}@AoLVca@nb@LEhOB~HrDlAbJfCnUvDFoR\\@?TQoDtHoLsGSIG?Pqg@UHa[rk@Xp@N|GhCd@ZvZ|KnAZhANrCHjRDjAEva@sE`^kEjLy@Lwv@DqBd@iBn@wAv@iAp@k@xAy@pNiGZI^@TPb@pAh@pCN\\\\^|@g@jIyAx]gHxL{FfIyCjc@{JtDQfPSnQQNJvCQGcYDaAPm@X_@f@SnkAkACkFDq@F]RO^o@d@]x@QrGElDMtC_@fDq@zC_Ard@oPzFyAjOcCpq@uJ`E[rHQ~D]xDu@lJqCbCi@hF_@fMJ`BMn@OhAa@lImExQ{IvYkMbCuAvEsDhCmCtLmQhByBtCeCvBmAnAg@~Bq@nDc@~XB~AGrCc@vf@oKlLgBbE}@rCw@zE_BbKmEjLsErA_@~AOlIKtDSxYiEhJgBt@Wh@[hAcA`AwAf@oA\\qAXuBTcIRaA`@w@f@a@vKoGf@LfIaFFzP',
  'to-evanston': '_~u~FngxuOG{PS{@gWhOk@f@e@|@UhAWdISzAe@dB}@fBu@z@aAt@qAf@uM|B}ALcRvCmCPqKPkBVcJhDkQnH{GrBqFlAqJtAsi@jLeBRmCHeRKiCBgDZuCr@_Bl@qC`BwChC_BpB{LpQeBjB_FzDgCzAmZtMmJrEiNhHyB`AcATeAHcMKeDL}Cd@{A\\{H|BqDv@sDb@aJRqDT{a@zFyHlAsRfCqFfAcFtA}`@|NkEnAsCd@eDXaJLiAN}@l@e@t@Sj@B^MnABjFokAjAg@ROP[z@EtAFvRyBjD_@DMJia@b@cFRkc@zJgIxCyLzFy]fHaIxAc@Ge@BWQaAwEOY[W_@Ko@HuPrHs@h@w@|@k@`Aa@hAUvABXEpBMvv@kLx@a^jEwa@rEkADkREsCIiAOoA[wZ}Ke@[}GiCq@OmjAm@qCB[ts@IpH@nLK|@GdZiIC',
  'loop-a': 'ept_GrubvOlIBfCb@x@j@@Gj@Tb@p@Pv@SRK`@uBvLSh@]h@e]YyEBm[MDwOBc@FOjDFNFNRX|@ZVpEBPOBQ?yC?xCCPQNqEC[WY}@OSOGeDKKLEh@Oxk@jSHGxTHpCfEtA|HxB~U~DFuUh@uAfCqDjCsEHWf@_CDBvFa\\yHaDFqAt@qC^i@{@qA[s@y@i@oNI',
  'loop-b': 'ept_GrubvOrNl@f@v@f@As@OjAj@RfAUd@]rA_@jB?T`ItCwClN?ZH@a@bCs@xBwA|Gg@jA_BlCiDdFGnW_V_E}HyBgEuAIyBFqUkSINyk@Bc@LSzCFXJNRX|@ZVpEBPOBQ?yC?xCCPQNqEC[WY}@OSOGkDGGNCb@EvOnRHZE`GHxECd]XvAd@CNdCn@nB`ALWPwAr@aDPiAgIaDdAgEFe@Dq@]aAYQ_Cq@i@LeK_@',
};

// In service order; ids are TripShot's. A corner has a different id in each direction.
const RAW_STOPS: Record<DirectionId, RawStop[]> = {
  'to-chicago': [
    ['Ryan Field - Ashland / Walker Way', -87.693785, 42.065973, '60e7b447-b29d-4812-bf93-7a77a1d5ae5b', 'north_evanston'],
    ['Central / Jackson', -87.692252, 42.064172, 'b3f50cbe-621f-4664-934a-fe48d4901250', 'north_evanston'],
    ['Central L', -87.68581, 42.064164, '04bd6431-355d-4362-8987-d752662ef5d5', 'north_evanston'],
    ['Noyes L', -87.683084, 42.058495, '27fbb8fb-2f8d-471e-9559-0ced0d1bde16', 'north_evanston'],
    ['Ridge - Civic Center', -87.686686, 42.056773, '3e9a09ae-af03-4a72-8c0f-44fa58592992', 'north_evanston'],
    ['Ridge / Garnett', -87.687487, 42.053579, '807f6444-ddaa-4c26-9c43-163c8b05bf4d', 'north_evanston'],
    ['Emerson / Maple', -87.684845, 42.051974, '5f01bd2f-8d7e-44df-8f8d-5bf9cdf711f6', 'downtown_evanston'],
    ['Sherman / Emerson', -87.681674, 42.051936, '4b19acfa-ab9a-4514-a062-8f787b3fd421', 'downtown_evanston'],
    ['Sherman / Foster', -87.681671, 42.053758, '0cead214-2210-4086-8233-3600594adea0', 'north_evanston'],
    ['Sherman / Gaffield', -87.681627, 42.056847, 'e5e52d59-d602-4b34-8190-5874cd2e143a', 'north_evanston'],
    ['Sheridan / Haven - Tech', -87.677249, 42.05746, '0d6b1867-9fa4-4319-a817-87b4908fcbb5', 'north_evanston'],
    ['Sheridan / Foster', -87.677308, 42.053737, '1953608e-38d5-40aa-a06a-5a7242a4ff1e', 'north_evanston'],
    ['Chicago / Sheridan', -87.677556, 42.050746, '4e1730d5-aea7-4cc9-aa16-300c0e0e7933', 'downtown_evanston'],
    ['Chicago / Grove', -87.680228, 42.045164, '1a1b0d27-8c62-4d62-b9c0-86224a1466b3', 'downtown_evanston'],
    ['Chicago / Greenleaf', -87.680218, 42.037722, '443d51e6-c3cf-4506-9893-bd72758e1b10', 'south_evanston'],
    ['Chicago / Main', -87.679379, 42.033651, 'e6dac526-8258-4984-b890-e57bc0980832', 'south_evanston'],
    ['Sheridan / Loyola', -87.660864, 42.001244, 'e5aa8b6f-44b5-4c4b-becd-1125a1fa4db4', ''],
    ['Ward', -87.619894, 41.896647, '6983f6d3-fcd9-4932-b9fb-7120f8c2f999', ''],
  ],
  'to-evanston': [
    ['Ward', -87.619894, 41.896647, '6983f6d3-fcd9-4932-b9fb-7120f8c2f999', ''],
    ['Sheridan / Loyola', -87.66066, 42.001701, 'e647afb1-e56d-4b28-b58a-b581f27b3e90', ''],
    ['Chicago / Kedzie', -87.678935, 42.031953, '403949ad-d32b-4aa3-b8b9-306ceb242638', 'south_evanston'],
    ['Chicago / Greenleaf', -87.679971, 42.037422, '127d653b-04c8-403b-9773-7d8ad76b69f3', 'south_evanston'],
    ['Chicago / Davis', -87.679657, 42.046057, 'd463d994-bb7f-40fc-a01c-4413ad12f855', 'downtown_evanston'],
    ['Weber Arch', -87.677186, 42.052056, '251727c6-f3b9-4904-86be-fe0df971f890', 'downtown_evanston'],
    ['Sheridan / Foster', -87.677081, 42.054039, '792117f5-c311-4826-890e-d6e7cd49cdca', 'north_evanston'],
    ['Sheridan / Haven - Tech', -87.677103, 42.057409, 'afedecae-1527-498a-94d7-ab1949be7cb6', 'north_evanston'],
    ['Sheridan / Lincoln', -87.676977, 42.061273, '4b78c678-a53e-48ee-b361-cc07444f0390', 'north_evanston'],
    ['Central L', -87.685988, 42.064274, 'ee69938d-68a3-488c-94f8-111f4e145765', 'north_evanston'],
    ['Central / Jackson', -87.692139, 42.064331, 'c28a43f2-95c6-442f-9077-adfcdda4a4cf', 'north_evanston'],
    ['Ryan Field - Ashland / Walker Way', -87.693785, 42.065973, '60e7b447-b29d-4812-bf93-7a77a1d5ae5b', 'north_evanston'],
  ],
  'loop-a': [
    ['Campus Dr - Norris Center', -87.673384, 42.053312, '69465207-776c-44e1-92ab-df9cf4360415', 'north_evanston'],
    ['Campus Dr - Fisk Hall', -87.673799, 42.050672, 'e8365ed5-d332-4294-9384-a7d29f17ea01', 'downtown_evanston'],
    ['Weber Arch', -87.677182, 42.051982, '9c179fa3-3a81-4f61-9626-0ef4fe075b58', 'downtown_evanston'],
    ['Sheridan / Foster', -87.677128, 42.054073, '1f5bed07-3b33-4945-b03d-40c5d3aced3f', 'north_evanston'],
    ['Sheridan / Haven - Tech', -87.677142, 42.057806, '18a8dcd2-acae-469a-b176-deb5adcf7f17', 'north_evanston'],
    ['Schapiro Hall', -87.67574, 42.061596, '6fd1fff1-a6c7-402d-a55b-817f88de4138', 'north_evanston'],
    ['Henry Crown Sports Pavilion', -87.673857, 42.059108, '0b165f35-2a4b-4fb9-ad97-472e4be4c9e6', 'north_evanston'],
    ['Lincoln / Sheridan', -87.67691, 42.061678, '9538fe97-2594-464b-90b7-4bec3922731b', 'north_evanston'],
    ['Noyes L', -87.683084, 42.058495, '27fbb8fb-2f8d-471e-9559-0ced0d1bde16', 'north_evanston'],
    ['Ridge - Civic Center', -87.686686, 42.056773, '3e9a09ae-af03-4a72-8c0f-44fa58592992', 'north_evanston'],
    ['Ridge / Garnett', -87.687487, 42.053579, '807f6444-ddaa-4c26-9c43-163c8b05bf4d', 'north_evanston'],
    ['Emerson / Maple', -87.685064, 42.052087, '6d977ac7-be5b-4605-b6ee-208902ffe6f1', 'downtown_evanston'],
    ['Elgin / Sherman', -87.681116, 42.050241, '85ead2d9-3a04-45d0-85b5-605a7999d080', 'downtown_evanston'],
  ],
  'loop-b': [
    ['Campus Dr - Norris Center', -87.673384, 42.053312, '69465207-776c-44e1-92ab-df9cf4360415', 'north_evanston'],
    ['Campus Dr - Fisk Hall', -87.673799, 42.050672, 'e8365ed5-d332-4294-9384-a7d29f17ea01', 'downtown_evanston'],
    ['619 Clark', -87.679002, 42.049763, 'f1204401-3cce-41a8-80ab-86a84e250949', 'downtown_evanston'],
    ['Emerson / Maple', -87.684611, 42.052146, '563c5055-f21e-4423-9839-e2738221c277', 'north_evanston'],
    ['Ridge / Garnett', -87.687678, 42.053082, 'ea2c4bd5-082c-4880-9d72-418d81ae0fa4', 'north_evanston'],
    ['Noyes L', -87.685262, 42.058462, '2d955e44-097c-45e8-a713-2f7d41dcc9a2', 'north_evanston'],
    ['Noyes L', -87.683337, 42.058452, '3fba873e-5347-4b07-b1b5-ecbb1441265f', 'north_evanston'],
    ['Elder Hall - Lincoln', -87.67748, 42.061512, '661c9b98-158f-464d-89cc-2a0c0ac83209', 'north_evanston'],
    ['Schapiro Hall', -87.67574, 42.061596, '6fd1fff1-a6c7-402d-a55b-817f88de4138', 'north_evanston'],
    ['Henry Crown Sports Pavilion', -87.673857, 42.059108, '0b165f35-2a4b-4fb9-ad97-472e4be4c9e6', 'north_evanston'],
    ['Sheridan / Haven - Tech', -87.677185, 42.057411, 'c4c4d853-a8fd-457f-8134-8c0352a9a74f', 'north_evanston'],
    ['Sheridan / Foster', -87.677308, 42.053737, '1953608e-38d5-40aa-a06a-5a7242a4ff1e', 'north_evanston'],
    ['Chicago / Sheridan', -87.677556, 42.050746, '4e1730d5-aea7-4cc9-aa16-300c0e0e7933', 'downtown_evanston'],
  ],
};

// Outlines as [longitude, latitude], label points where the name sits (SOURCES.zones).
const RAW_ZONES: Record<ZoneId, { label: [number, number]; points: [number, number][] }> = {
  'nu-campus': {
    label: [-87.6752, 42.0555],
    points: [[-87.6794,42.06273], [-87.67729,42.06267], [-87.67729,42.06149], [-87.67242,42.06154], [-87.67104,42.05987], [-87.67075,42.06003], [-87.66973,42.05981], [-87.66959,42.05965], [-87.67002,42.05825], [-87.67024,42.05609], [-87.67002,42.05442], [-87.6693,42.05215], [-87.6701,42.05193], [-87.67053,42.05253], [-87.67097,42.05253], [-87.67046,42.05264], [-87.67075,42.05323], [-87.67075,42.05409], [-87.67097,42.05458], [-87.67177,42.05512], [-87.67191,42.0556], [-87.67162,42.05582], [-87.67097,42.05577], [-87.67068,42.05604], [-87.67068,42.05631], [-87.67111,42.05668], [-87.67184,42.05674], [-87.67235,42.05641], [-87.67235,42.05593], [-87.67264,42.05566], [-87.67366,42.05512], [-87.67395,42.05452], [-87.67315,42.05393], [-87.6717,42.05393], [-87.67155,42.05382], [-87.67155,42.05291], [-87.67111,42.05258], [-87.67111,42.05048], [-87.67126,42.05086], [-87.67206,42.05086], [-87.67249,42.05053], [-87.67293,42.05059], [-87.67293,42.05021], [-87.67329,42.04994], [-87.67409,42.05015], [-87.67446,42.0501], [-87.67468,42.04864], [-87.68158,42.05059], [-87.68158,42.05199], [-87.67954,42.05204], [-87.67954,42.05323], [-87.67874,42.05323], [-87.67874,42.05496], [-87.67802,42.05501], [-87.67795,42.05625], [-87.67831,42.05631], [-87.67831,42.05674], [-87.67867,42.05679], [-87.67867,42.05728], [-87.67845,42.05733], [-87.67845,42.0576], [-87.67802,42.05765], [-87.67802,42.05846], [-87.67867,42.05852], [-87.67867,42.05992], [-87.67802,42.05997], [-87.67802,42.06057], [-87.6794,42.06068]],
  },
  'northwestern-chicago-streeterville': {
    label: [-87.6151, 41.8935],
    points: [[-87.62017,41.90095], [-87.61908,41.9009], [-87.61495,41.89464], [-87.61372,41.89313], [-87.61263,41.8934], [-87.61198,41.89334], [-87.61017,41.8962], [-87.60575,41.8962], [-87.60248,41.89636], [-87.60234,41.89329], [-87.60981,41.89318], [-87.60981,41.89226], [-87.60393,41.89226], [-87.60096,41.89232], [-87.60067,41.89243], [-87.60053,41.89221], [-87.59857,41.89226], [-87.59857,41.89145], [-87.60053,41.89145], [-87.6006,41.89113], [-87.60894,41.89108], [-87.60959,41.89097], [-87.60944,41.88935], [-87.6077,41.88935], [-87.6077,41.8887], [-87.60749,41.88859], [-87.60473,41.88865], [-87.60524,41.88849], [-87.61162,41.88854], [-87.61814,41.88832], [-87.62256,41.88886], [-87.62394,41.88886], [-87.62372,41.88962], [-87.6238,41.90063], [-87.62372,41.90079], [-87.62343,41.90084]],
  },
  'north-evanston': {
    label: [-87.6997, 42.061],
    points: [[-87.6827,42.07168], [-87.67958,42.07163], [-87.67711,42.06763], [-87.67573,42.06623], [-87.67551,42.06493], [-87.67406,42.06407], [-87.6742,42.0638], [-87.67376,42.06321], [-87.67347,42.06191], [-87.67282,42.061], [-87.67129,42.0597], [-87.671,42.06002], [-87.66984,42.05992], [-87.66955,42.0597], [-87.67013,42.05743], [-87.67013,42.05511], [-87.66984,42.05366], [-87.66933,42.05242], [-87.66941,42.05215], [-87.6702,42.05209], [-87.67042,42.05231], [-87.671,42.05236], [-87.67108,42.05209], [-87.68314,42.05209], [-87.69215,42.05225], [-87.70668,42.05198], [-87.70806,42.05231], [-87.70879,42.05231], [-87.70886,42.05247], [-87.70988,42.05274], [-87.7146,42.05501], [-87.71591,42.05538], [-87.72746,42.05528], [-87.72732,42.06245], [-87.7324,42.06251], [-87.73233,42.06887], [-87.72928,42.06958], [-87.72906,42.06909], [-87.72063,42.06914], [-87.70348,42.06887], [-87.70268,42.06898], [-87.70196,42.06887], [-87.68917,42.06871], [-87.68917,42.06963], [-87.68285,42.06947]],
  },
  'downtown-evanston': {
    label: [-87.6826, 42.0483],
    points: [[-87.68786,42.05209], [-87.67565,42.05204], [-87.67565,42.05053], [-87.67871,42.04411], [-87.68852,42.04421], [-87.68873,42.0488]],
  },
  'south-evanston': {
    label: [-87.6895, 42.0319],
    points: [[-87.69556,42.04427], [-87.67202,42.04394], [-87.67129,42.04292], [-87.67064,42.04249], [-87.67035,42.042], [-87.66933,42.04108], [-87.66911,42.03957], [-87.66955,42.03909], [-87.66962,42.03752], [-87.67006,42.0372], [-87.67006,42.03671], [-87.66911,42.03558], [-87.66962,42.03553], [-87.6697,42.03531], [-87.66955,42.03526], [-87.66941,42.03445], [-87.66962,42.03423], [-87.66926,42.03353], [-87.66897,42.0318], [-87.6689,42.03024], [-87.66861,42.02927], [-87.66875,42.029], [-87.66853,42.02824], [-87.66701,42.02684], [-87.66723,42.02662], [-87.66643,42.02571], [-87.66512,42.02306], [-87.66686,42.02317], [-87.67718,42.02295], [-87.67718,42.02258], [-87.67333,42.01939], [-87.69149,42.01956], [-87.70901,42.01918], [-87.70864,42.03364], [-87.70988,42.03369], [-87.70959,42.04405]],
  },
};

// Google's encoded polyline format (precision 1e5), as TripShot serves its road shapes.
export function decodePolyline(encoded: string): Point[] {
  const points: Point[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 31) << shift;
      shift += 5;
    } while (byte >= 32); // past the end charCodeAt is NaN, which ends the loop
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lng += next();
    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return points;
}

const toStop = ([name, lng, lat, id, region]: RawStop): Stop => ({ id: id.toLowerCase(), name, lat, lng, region });

export const DIRECTIONS: Record<DirectionId, Direction> = {
  'to-chicago': {
    id: 'to-chicago',
    line: 'intercampus',
    label: 'To Chicago',
    route: 'Ryan Field to Ward, Chicago campus',
    color: LINE_COLOR.intercampus,
    hours: 'Weekdays, first bus 6:35 am and last 9:30 pm from Ryan Field. No weekend or university holiday service.',
    stops: RAW_STOPS['to-chicago'].map(toStop),
  },
  'to-evanston': {
    id: 'to-evanston',
    line: 'intercampus',
    label: 'To Evanston',
    route: 'Ward, Chicago campus to Ryan Field',
    color: LINE_COLOR.intercampus,
    hours: 'Weekdays, first bus 6:40 am and last 10:25 pm from Ward. No weekend or university holiday service.',
    stops: RAW_STOPS['to-evanston'].map(toStop),
  },
  'loop-a': {
    id: 'loop-a',
    line: 'loop',
    label: 'Loop A',
    route: 'Norris, Weber Arch, Noyes L and Ridge',
    color: LINE_COLOR.loopA,
    hours: 'Every evening in term, every 30 minutes from Norris, 6:00 pm to 12:30 am. No service during breaks.',
    stops: RAW_STOPS['loop-a'].map(toStop),
  },
  'loop-b': {
    id: 'loop-b',
    line: 'loop',
    label: 'Loop B',
    route: 'Norris, 619 Clark, Ridge and Noyes L',
    color: LINE_COLOR.loopB,
    hours: 'Every evening in term, every 30 minutes from Norris, 6:15 pm to 12:45 am. No service during breaks.',
    stops: RAW_STOPS['loop-b'].map(toStop),
  },
};

export const LINES: Record<LineId, Line> = {
  intercampus: {
    id: 'intercampus',
    label: 'Intercampus',
    summary: 'Between the Evanston and Chicago campuses, on weekdays.',
    directions: ['to-chicago', 'to-evanston'],
  },
  loop: {
    id: 'loop',
    label: 'Loop',
    summary: 'Around the Evanston campus in the evening, in two patterns.',
    directions: ['loop-a', 'loop-b'],
  },
};

const pathCache = new Map<DirectionId, Point[]>();

// The road shape of a direction, decoded once.
export function routePath(id: DirectionId): Point[] {
  let path = pathCache.get(id);
  if (!path) {
    path = decodePolyline(ENCODED[id]);
    pathCache.set(id, path);
  }
  return path;
}

const ZONE_NAMES: Record<ZoneId, [string, Zone['kind']]> = {
  'nu-campus': ['Evanston campus', 'campus'],
  'northwestern-chicago-streeterville': ['Chicago campus, Streeterville', 'campus'],
  'north-evanston': ['North Evanston', 'area'],
  'downtown-evanston': ['Downtown Evanston', 'area'],
  'south-evanston': ['South Evanston', 'area'],
};

export const ZONES: Zone[] = (Object.keys(RAW_ZONES) as ZoneId[]).map((id) => ({
  id,
  name: ZONE_NAMES[id][0],
  kind: ZONE_NAMES[id][1],
  label: { lat: RAW_ZONES[id].label[1], lng: RAW_ZONES[id].label[0] },
  points: RAW_ZONES[id].points.map(([lng, lat]) => ({ lat, lng })),
}));

// ---------- distances ----------

const EARTH_METERS = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;

export function metersBetween(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Walking time estimated without a router: the straight line × 1.3 for streets, at 80 m a minute.
export const WALK_DETOUR = 1.3;
export const WALK_METERS_PER_MINUTE = 80;

export function walkingMinutes(meters: number): number {
  if (!Number.isFinite(meters) || meters < 0) return NaN;
  return Math.max(1, Math.round((meters * WALK_DETOUR) / WALK_METERS_PER_MINUTE));
}

export interface NearStop {
  stop: Stop;
  direction: DirectionId;
  meters: number; // straight line
  walk: number; // minutes, estimated
}

// Stops of the given directions nearest to a point, closest first; one entry per stop name, so a
// corner served in both directions or by both Loop patterns appears once (with its closest pole).
export function nearestStops(from: Point, opts: { directions?: DirectionId[]; limit?: number; maxMeters?: number } = {}): NearStop[] {
  const ids = opts.directions ?? (Object.keys(DIRECTIONS) as DirectionId[]);
  const best = new Map<string, NearStop>();
  for (const direction of ids) {
    for (const stop of DIRECTIONS[direction].stops) {
      const meters = metersBetween(from, stop);
      if (opts.maxMeters !== undefined && meters > opts.maxMeters) continue;
      const seen = best.get(stop.name);
      if (!seen || meters < seen.meters) best.set(stop.name, { stop, direction, meters, walk: walkingMinutes(meters) });
    }
  }
  return [...best.values()].sort((a, b) => a.meters - b.meters).slice(0, opts.limit ?? 3);
}

export function nearestStop(from: Point, directions?: DirectionId[]): NearStop | null {
  return nearestStops(from, { directions, limit: 1 })[0] ?? null;
}

// How far a point lies from a direction's road shape, in meters (flat-earth, fine at city scale).
export function metersFromRoute(p: Point, id: DirectionId): number {
  const path = routePath(id);
  const kx = Math.cos(rad(p.lat)) * 111320;
  const ky = 110574;
  const px = p.lng * kx;
  const py = p.lat * ky;
  let min = Infinity;
  for (let i = 1; i < path.length; i++) {
    const ax = path[i - 1].lng * kx;
    const ay = path[i - 1].lat * ky;
    const dx = path[i].lng * kx - ax;
    const dy = path[i].lat * ky - ay;
    const len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
    min = Math.min(min, Math.hypot(ax + t * dx - px, ay + t * dy - py));
  }
  return min;
}

// Consecutive stops with the same name (Loop B serves two Noyes L poles back to back) shown as one row.
export interface StopRow {
  name: string;
  region: RegionId;
  ids: string[];
  stops: Stop[];
}

export function stopRows(id: DirectionId): StopRow[] {
  const rows: StopRow[] = [];
  for (const stop of DIRECTIONS[id].stops) {
    const last = rows[rows.length - 1];
    if (last && last.name === stop.name) {
      last.ids.push(stop.id);
      last.stops.push(stop);
    } else rows.push({ name: stop.name, region: stop.region, ids: [stop.id], stops: [stop] });
  }
  return rows;
}
