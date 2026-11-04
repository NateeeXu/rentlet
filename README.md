# Rentlet

Sublets and lease takeovers between Northwestern students: post a place, browse by dates, rent and
campus, and message the other student in the app.

A student class project. Not affiliated with or endorsed by Northwestern University.

## Stack

- Multi-page site built with Vite: each page (`index.html`, `room.html`, `post.html`, `request.html`,
  `requests.html`, `messages.html`, `profile.html`, `how-it-works.html`, `terms.html`, `privacy.html`) is the approved design moved
  over as HTML + JavaScript; the shared pickers live in `public/` (`when-picker.js`, `where-search.js`,
  `budget-picker.js`).
- TypeScript helpers in `src/lib` with Vitest tests; Firebase config in `src/firebase.ts`.
- Firebase (project `rentlet-nu`): Authentication (Google, Northwestern accounts only) and Cloud Firestore.
- Firebase Hosting for deployment (`cleanUrls`, so `/room?room=…` works).

The date picker overlays Northwestern's 2026–27 calendar from the Office of the Registrar; update
`EVENTS` in `public/when-picker.js` each academic year.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173 (use localhost, not 127.0.0.1, for Google sign-in)
npm test           # unit tests (Vitest)
npm run build      # typecheck + production build into dist/
```

## Addresses and walking times (HERE)

HERE Geocoding & Search and Routing run behind three Cloud Functions in `functions/` (`placeSuggest`,
`placeLookup`, `nearby`), so the HERE API key stays a Firebase secret and never reaches the browser.
`src/place.ts` calls them. On the post form, the Building field lists the apartment directory
(`src/lib/apartments.ts`) and the Street address field lists full addresses from HERE; a published listing
stores the picked place's area, walk to campus and exact map spot (`location`), while the street address,
building name and website stay in the host-only `listings/{id}/private/location`. Without the functions the
site still works: no address suggestions, a picked building uses the directory's walking estimate, a typed
address gets its area from the text, and a listing with no picked place has no walk or map spot. Setup and
deploy steps: [functions/README.md](functions/README.md).

## Data and access

`firestore.rules` is the source of truth for who can read and write what:

- Anyone can browse active listings and open requests.
- Writing needs a signed-in, verified `@u.northwestern.edu` or `@northwestern.edu` Google account.
- People edit only their own profile, listings and requests; conversations and messages are visible
  only to the two participants; timestamps must come from the server.

Deploy rules with `npx firebase-tools deploy --only firestore:rules`.

The web config in `src/firebase.ts` identifies the project and is meant to be public; access is
enforced by the rules above.
