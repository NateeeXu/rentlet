# Acceptance tests (E2E)

End-to-end checks of the journeys a visitor can take without signing in, written as
Given / When / Then and implemented with Playwright against the Firebase emulators.

## Run them

```bash
npm run test:e2e
```

This starts the auth, Firestore and storage emulators, seeds the listings in
[seed.ts](./seed.ts) (two live, one taken down, one ended), serves the app with
`VITE_USE_EMULATORS=true`, and runs the specs below in Chromium. Each run starts from an
empty emulator database, so the specs are independent and never touch the real project.

To click through the seeded app by hand instead:

```bash
npm run emulators     # in one terminal: auth :9099, firestore :8080, storage :9199, UI :4000
npm run dev:emu       # in another: the app at http://localhost:5173 on the emulators
```

## Specs

### Browsing rooms — [home.spec.ts](./home.spec.ts)

1. Given two live listings near Northwestern · Evanston, one taken down and one ended,
   when a visitor opens the homepage's All rooms section,
   then the two live rooms show as cards with their title, area and monthly rent,
   newest first.
2. Given the same listings,
   when a visitor opens the homepage's All rooms section,
   then the taken-down and ended listings show no card.

### Searching rooms — [search.spec.ts](./search.spec.ts)

3. Given the seeded Evanston listings,
   when a visitor searches Evanston with dates they cover and a $1,200 monthly budget,
   then only the matching E2 Apartments room appears.
4. Given the same listings,
   when a visitor searches Evanston for dates no listing covers,
   then no room cards appear and Create a housing request opens the request page.

### Opening a room — [room.spec.ts](./room.spec.ts)

5. Given a live listing at E2 Apartments ($950/mo, Downtown Evanston),
   when a visitor opens its room page directly,
   then the page shows the building, title, area, rent and listing number.
6. Given a listing number that was never posted,
   when a visitor opens its room page,
   then the page says the listing could not be found.
7. Given a listing the host took down,
   when a visitor opens its room page,
   then the page says the listing is no longer available.
8. Given a listing whose last day has passed,
   when a visitor opens its old link,
   then the room still opens, marked Ended, with search offered instead of Message.

### Posting — [post-gate.spec.ts](./post-gate.spec.ts)

9. Given a signed-out visitor,
   when they open the post-a-listing page,
   then the page asks them to sign in with Google before the first step.

### Room to room — [home.spec.ts](./home.spec.ts)

10. Given the All rooms section,
   when a visitor clicks a room card,
   then the room page for that listing opens.

The homepage search specs use the suite's default signed-out browser context. Signed-in
coverage needs the test sign-in path described under Follow-ups.

## Follow-ups (need a signed-in test user)

- Publish flow: a signed-in host completes the post form and the new listing appears live.
- Messaging: a signed-in renter messages a host and the chat shows both sides.
- Saves: a signed-in visitor hearts a room and Profile lists it under Saved.

These need sign-in inside the test. The app only signs in through the Google popup, which
the Auth emulator cannot complete, so they wait on a test sign-in path (for example an
emulator-only credential sign-in helper).
