import { describe, expect, it } from 'vitest';
import { chicagoDate, parseTripShot, STALE_SECONDS, stopName, tripshotUrl } from './shuttle';

// Trimmed from TripShot's Intercampus live data on 2026-11-04 at 13:33 Chicago time (only the fields
// the parser reads); the Loop ride follows the same shape with the Loop's own stop ids.
const NOW = Date.parse('2026-11-04T19:33:03Z');
const visit = (state: string, stopId: string, expectedArrivalTime: string) => ({ [state]: { stopId, expectedArrivalTime } });
const via = (stopId: string, name: string) => ({ ViaStop: { stop: { stopId, name } } });
const ride = (
  name: string,
  where: [number, number] | null,
  when: string,
  bearing: number | null,
  state: string,
  stops: ReturnType<typeof visit>[],
  vias: ReturnType<typeof via>[] = [],
) => ({
  vehicleStatus: { name, location: where && { lt: where[0], lg: where[1] }, when, bearing },
  ride: { state: { [state]: [] }, vehicleName: name, stopStatus: stops, vias },
});

const RIDGE = '3e9a09ae-af03-4a72-8c0f-44fa58592992';
const WARD = '6983f6d3-fcd9-4932-b9fb-7120f8c2f999';
const GREENLEAF = '127d653b-04c8-403b-9773-7d8ad76b69f3';
const DAVIS = 'D463D994-BB7F-40FC-A01C-4413AD12F855'; // TripShot ids may come in upper case

const INTERCAMPUS = {
  InternalRouteGroupLiveData: {
    exactLiveData: [
      {
        direction: 'Inbound',
        liveRides: [
          // assigned its next ride, not yet under way: skipped
          ride('35008', [42.0018761, -87.66069], '2026-11-04T17:23:31.963Z', null, 'Accepted', [
            visit('Awaiting', '60e7b447-b29d-4812-bf93-7a77a1d5ae5b', '2026-11-04T18:50:00.000Z'),
          ]),
          ride(
            '35001',
            [42.0615593, -87.6845977],
            '2026-11-04T19:32:58.988Z',
            17,
            'Active',
            [
              visit('Departed', '27fbb8fb-2f8d-471e-9559-0ced0d1bde16', '2026-11-04T19:31:05.302Z'),
              visit('Awaiting', RIDGE, '2026-11-04T19:32:30.453Z'), // a little late: shown as now
              visit('Awaiting', '807f6444-ddaa-4c26-9c43-163c8b05bf4d', '2026-11-04T19:33:15.000Z'),
            ],
            [via(RIDGE, 'Ridge - Civic Center (SB)')],
          ),
        ],
      },
      {
        direction: 'Outbound',
        liveRides: [
          // under way but its position is two hours old: skipped
          ride('35008', [42.0018761, -87.66069], '2026-11-04T17:23:31.963Z', null, 'Active', [
            visit('Present', 'e647afb1-e56d-4b28-b58a-b581f27b3e90', '2026-11-04T17:27:43.898Z'),
          ]),
          ride(
            '35005',
            [41.8967679, -87.6197247],
            '2026-11-04T19:32:52.006Z',
            null,
            'Active',
            [visit('Awaiting', WARD, '2026-11-04T19:40:00.000Z'), visit('Awaiting', DAVIS, '2026-11-04T23:40:00.000Z')],
            [via(WARD, 'Ward')],
          ),
          ride(
            '35012',
            [42.0340538, -87.6793591],
            '2026-11-04T19:32:59.969Z',
            350,
            'Active',
            [
              visit('Departed', '403949ad-d32b-4aa3-b8b9-306ceb242638', '2026-11-04T19:32:00.000Z'),
              visit('Awaiting', GREENLEAF, '2026-11-04T19:34:00.000Z'),
              visit('Awaiting', DAVIS, '2026-11-04T19:37:00.000Z'),
            ],
            [via(GREENLEAF, 'Chicago/Greenleaf (NB)'), via(DAVIS, 'Chicago/Davis (NB)')],
          ),
          ride('no-position', null, '2026-11-04T19:33:00.000Z', 0, 'Active', []),
        ],
      },
    ],
  },
};

const NORRIS = '69465207-776c-44e1-92ab-df9cf4360415';
const FISK = 'e8365ed5-d332-4294-9384-a7d29f17ea01';
const loopRide = (name: string, third: string) =>
  ride(name, [42.0507, -87.6738], '2026-11-05T00:20:00.000Z', 180, 'Active', [
    visit('Departed', NORRIS, '2026-11-05T00:15:00.000Z'),
    visit('Present', FISK, '2026-11-05T00:19:00.000Z'),
    visit('Awaiting', third, '2026-11-05T00:22:00.000Z'),
    visit('Awaiting', NORRIS, '2026-11-05T00:45:00.000Z'),
  ]);
const LOOP = {
  InternalRouteGroupLiveData: {
    exactLiveData: [
      {
        direction: 'NonDirectional',
        liveRides: [
          loopRide('35020', '9c179fa3-3a81-4f61-9626-0ef4fe075b58'), // Weber Arch next: Loop A
          loopRide('35021', 'f1204401-3cce-41a8-80ab-86a84e250949'), // 619 Clark next: Loop B
          loopRide('35022', '00000000-0000-0000-0000-000000000000'), // neither: no line, skipped
        ],
      },
    ],
  },
};

describe('parseTripShot', () => {
  it('keeps the buses under way with fresh positions, on their line', () => {
    const v = parseTripShot(INTERCAMPUS, NOW);
    expect(v.map((x) => [x.id, x.line])).toEqual([
      ['35001', 'to-chicago'],
      ['35005', 'to-evanston'],
      ['35012', 'to-evanston'],
    ]);
    expect(v[0]).toMatchObject({ lat: 42.061559, lng: -87.684598, heading: 17, ageSeconds: 4 });
    expect(v[1].heading).toBeNull();
  });

  it('passes on arrival predictions in seconds after the reading, keyed by lower-case stop id', () => {
    const [a, b, c] = parseTripShot(INTERCAMPUS, NOW);
    expect(a.arrivals).toEqual({ [RIDGE]: 0, '807f6444-ddaa-4c26-9c43-163c8b05bf4d': 12 });
    expect(a.nextStop).toEqual({ id: RIDGE, name: 'Ridge - Civic Center', seconds: 0 });
    expect(b.arrivals).toEqual({ [WARD]: 417 }); // the one four hours out is dropped
    expect(c.nextStop).toEqual({ id: GREENLEAF, name: 'Chicago / Greenleaf', seconds: 57 });
    expect(c.arrivals[DAVIS.toLowerCase()]).toBe(237);
  });

  it('tells the two Loop patterns apart by the stop after Fisk Hall', () => {
    const v = parseTripShot(LOOP, Date.parse('2026-11-05T00:20:10Z'));
    expect(v.map((x) => [x.id, x.line])).toEqual([
      ['35020', 'loop-a'],
      ['35021', 'loop-b'],
    ]);
    // a bus at a stop arrives now; Norris is reported for the first pass only
    expect(v[0].nextStop).toMatchObject({ id: FISK, seconds: 0 });
    expect(v[0].arrivals[NORRIS]).toBe(1490);
  });

  it('drops positions older than the stale limit', () => {
    const late = Date.parse('2026-11-04T19:32:58.988Z') + (STALE_SECONDS + 1) * 1000;
    expect(parseTripShot(INTERCAMPUS, late).map((x) => x.id)).not.toContain('35001');
  });

  it('survives payloads of the wrong shape', () => {
    for (const bad of [null, undefined, 42, 'x', [], {}, { InternalRouteGroupLiveData: { exactLiveData: [null, { liveRides: [null, {}] }] } }]) {
      expect(parseTripShot(bad, NOW)).toEqual([]);
    }
  });
});

describe('helpers', () => {
  it('works out the Chicago service day across daylight saving', () => {
    expect(chicagoDate(Date.parse('2026-11-04T05:30:00Z'))).toBe('2026-11-03'); // 11:30 pm CST
    expect(chicagoDate(Date.parse('2026-11-04T06:30:00Z'))).toBe('2026-11-04');
    expect(chicagoDate(Date.parse('2026-07-01T04:30:00Z'))).toBe('2026-06-30'); // 11:30 pm CDT
    expect(chicagoDate(Date.parse('2026-07-01T05:30:00Z'))).toBe('2026-07-01');
  });
  it('writes stop names the way the site does', () => {
    expect(stopName('Sheridan/Loyola (NB)')).toBe('Sheridan / Loyola');
    expect(stopName('Ryan Field - Ashland/Walker Way (SB)')).toBe('Ryan Field - Ashland / Walker Way');
    expect(stopName(undefined)).toBe('');
  });
  it('builds the TripShot live URL for the day', () => {
    expect(tripshotUrl('IRGI:2CA5DC76-DD3F-4AB4-BD10-056785A989ED', '2026-11-04')).toBe(
      'https://northwestern.tripshot.com/v2/p/shared/route/IRGI:2CA5DC76-DD3F-4AB4-BD10-056785A989ED/live?day=2026-11-04&includePreviousDayRidesSpanningMidnight=true',
    );
  });
});
