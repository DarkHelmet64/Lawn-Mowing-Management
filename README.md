# Lawn Mowing Management

A personal web app for tracking a lawn care business: mow/trim/edge visits
(with the mowing pattern used per visit), driveway and flowerbed weed
spraying, equipment maintenance (like blade sharpening), and local weather
with growing degree days (GDD) and weekly rainfall for grass near Dayton,
Ohio.

Built as a static site on **Firebase Hosting**, with **Firestore** as the
database and **Firebase Authentication** to keep the data private to one
account. There is no backend server to run or Cloud Functions to pay for —
weather data is fetched directly from the free [Open-Meteo](https://open-meteo.com/)
API in the browser and cached in Firestore.

## Features

- **Customers** — name, address, contact info, service frequency, active/inactive.
- **Mow / Trim / Edge Log** — per-visit record of what was done, the mowing
  pattern used (stripes, diagonal, checkerboard, waves, circular, diamond,
  etc.), deck height, and notes.
- **Spray Log** — records whether you sprayed weeds (or other targets) in
  driveways, walkways, flowerbeds, or the lawn itself, which product you
  used, and notes.
- **Equipment Maintenance** — logs tasks like blade sharpening, blade
  replacement, oil changes, air filters, spark plugs, belts/cables, per
  piece of equipment.
- **Weather & GDD** — daily high/low temps and precipitation for Dayton, OH,
  a configurable-base-temperature growing degree day calculation with
  season-to-date accumulation, and a weekly rainfall chart.
- **Dashboard** — today's GDD, season cumulative GDD, last 7 days of
  rainfall, and recent activity at a glance.

## Tech stack

- Plain HTML/CSS/JavaScript (ES modules), no build step required.
- [Firebase](https://firebase.google.com/) Hosting, Firestore, and Authentication (Email/Password).
- [Open-Meteo](https://open-meteo.com/) forecast + historical archive APIs for weather (no API key needed).

## Firebase project setup

1. Go to the [Firebase console](https://console.firebase.google.com/) and create a new project.
2. **Enable Firestore**: Build → Firestore Database → Create database (start in production mode; the security rules in this repo lock it down).
3. **Enable Authentication**: Build → Authentication → Sign-in method → enable **Email/Password**.
4. **Create your one user account**: Authentication → Users → Add user. Use the same email you plan to sign in with — this repo's `firestore.rules` is pre-configured to only allow `chris64brock@gmail.com`. If you use a different email, update that address in `firestore.rules` first.
5. **Register a web app**: Project Settings → General → Your apps → Add app → Web. Copy the resulting `firebaseConfig` object.
6. **Enable Hosting** (optional at this point, needed before you deploy): Build → Hosting → Get started.

## Local configuration

1. Open `public/js/firebase-config.js` and replace the placeholder values with the config object from step 5 above.
2. Open `.firebaserc` and replace `REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID` with your actual Firebase project ID.

Until `firebase-config.js` is filled in, the app shows a setup banner instead of trying (and failing) to connect to Firebase.

## Deploying

You'll need the [Firebase CLI](https://firebase.google.com/docs/cli) (`npm install -g firebase-tools`) installed locally, or use it via `npx firebase-tools`.

```bash
firebase login
firebase deploy --only firestore:rules,firestore:indexes,hosting
```

### Automatic deploys via GitHub Actions

`.github/workflows/firebase-hosting.yml` deploys `public/` to Firebase Hosting on every push to `main`. To enable it:

1. Edit the workflow file and replace `REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID` with your project ID.
2. Generate a service account key for deploys: `firebase init hosting:github` (this walks you through creating the `FIREBASE_SERVICE_ACCOUNT` GitHub secret automatically), or create one manually under Project Settings → Service Accounts and add it as a repository secret named `FIREBASE_SERVICE_ACCOUNT`.
3. Merge your changes to `main` — the workflow deploys automatically after that.

### Local preview without deploying

Any static file server works, e.g.:

```bash
npx serve public
# or
python3 -m http.server --directory public 8080
```

Firebase Auth/Firestore calls will still hit your live Firebase project even when previewing locally, since there's no local backend.

## How growing degree days (GDD) are calculated

Daily GDD uses the standard average method:

```
dailyGDD = max(0, ((highTempF + lowTempF) / 2) - baseTempF)
```

These accumulate from a **season start date** through the current day to
give season-to-date cumulative GDD. Both the **base temperature** and
**season start date** are adjustable in the Weather & GDD tab (defaults:
50°F base, April 1 of the current year — reasonable for tracking active
growth of cool-season turfgrass in Ohio). Some turf GDD models used in the
turfgrass industry instead use a 32°F base starting January 1; adjust the
settings to match whichever model you prefer to track by.

Weather data (daily high/low temperature and precipitation) is fetched
directly from Open-Meteo for Dayton, OH (39.7589, -84.1916) — recent days
from the forecast API (which also serves recent observed data) and the
rest of the season from the historical archive API — then cached in the
`weatherDaily` Firestore collection so the app doesn't need to refetch the
whole season every time.

## Data model (Firestore collections)

| Collection | Purpose |
|---|---|
| `customers` | Customer/property records |
| `mowVisits` | Mow/trim/edge visit log entries |
| `sprayApplications` | Weed/insect/fungus/fertilizer spray log entries |
| `maintenanceTasks` | Equipment maintenance log entries |
| `weatherDaily` | Cached daily weather + GDD inputs, keyed by date |
| `settings` | App settings (GDD base temp, season start) |

## Security

Firestore rules (`firestore.rules`) restrict all reads and writes to a
signed-in user whose auth token email matches the address configured at
the top of that file. There's no public sign-up flow in the app UI, and
only the account you create manually in the Firebase console can sign in.
