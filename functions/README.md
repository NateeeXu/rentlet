# Rentlet Cloud Functions

Three callable functions (Firebase Functions v2, Node 22, region `us-central1`) that talk to HERE so the
HERE API key never reaches the browser. Each one answers only a signed-in Google account with a verified
`@u.northwestern.edu` or `@northwestern.edu` email.

| Callable | Input | Returns |
| --- | --- | --- |
| `placeSuggest` | `{q, campusId}`: `q` up to 120 characters | Up to 5 full street addresses `{id, label, title, sub}` near the campus |
| `placeLookup` | `{id, campusId}` (a suggestion), `{q, campusId}` (a typed address) or `{lat, lng, campusId}` (walk only, for a directory building) | `{lat, lng, label, title, area, zip, walk}` or `null` |
| `nearby` | `{lat, lng, campusId}`, within 60 km of the campus | Up to 4 `{kind, name, meters, walk}`: transit stop, grocery, pharmacy, food within about a mile |

`campusId` is `nu-evn` (42.0565, -87.6753), `nu-chi` (41.8963, -87.6188) or `chi-dt` (41.8826, -87.6233).
`walk` is minutes on foot from HERE Routing v8 (pedestrian), or `null` when routing fails or the place is
more than 6 km in a straight line from the campus. `area` is HERE's district or subdistrict, or `null`.

HERE endpoints used, all server-side with the `apiKey` query parameter: Geocoding & Search v7
`autocomplete`, `lookup`, `geocode` and `browse`, and Routing v8 `routes`.
Logs record the endpoint name and HTTP status only, never a URL (it contains the key).

The site calls these through `src/place.ts`. When the functions are not deployed, or HERE is down, the
site shows no address suggestions, a picked directory building uses the directory's walking estimate, a
typed address gets its area from the text, and publishing still works.

## Deploy (the founder, once)

1. Create the key. Sign in at [platform.here.com](https://platform.here.com), open **Access Manager**,
   create an app (for example `rentlet-nu`), then under **Credentials** create an **API key**. Make sure
   the app is allowed to use *Geocoding and Search* and *Routing*. Do not paste the key anywhere else.
2. Store it as a Firebase secret. In your own terminal, from the repository root:

   ```bash
   npx firebase-tools functions:secrets:set HERE_API_KEY --project rentlet-nu
   ```

   Paste the key when asked. It goes into Google Secret Manager; it is never in this repository.
3. Deploy the functions (the build runs first, from `firebase.json`):

   ```bash
   npm --prefix functions install
   npx firebase-tools deploy --only functions --project rentlet-nu
   ```

To rotate the key, set the secret again and redeploy. To check that it works, sign in on the site, open
Post a listing → Where is it?, and type a street address: suggestions should appear under the field.

## Message emails

`emailOnMessage` runs on each new message in `conversations/{cid}/messages/{mid}`. It waits 30 seconds, then emails
the other person if they still haven't read it, at most once per chat until they open it. Muted chats, blocked
people and anyone who turned it off in Profile get nothing. `notifyState/{cid}_{uid}` records the last email and is
out of reach of the site. It needs two secrets, set by the founder in their own terminal from the repository root:

```bash
npx firebase-tools functions:secrets:set MAIL_USER --project rentlet-nu
```

```bash
npx firebase-tools functions:secrets:set MAIL_PASSWORD --project rentlet-nu
```

`MAIL_USER` is the full address of a Tencent Exmail mailbox (mail goes out through `smtp.exmail.qq.com`, port 465). `MAIL_PASSWORD` is that
mailbox's client password: turn on SMTP in the mailbox settings first, and if secure login is on, generate a client-specific password rather
than using the login password. Recipients see this address as the sender, and any reply to an email lands in that mailbox. Then deploy `emailOnMessage` with the other functions.

## Develop

```bash
npm --prefix functions run build   # TypeScript -> functions/lib
npm test                           # from the root: includes functions/src/*.test.ts (no network, no key)
```
