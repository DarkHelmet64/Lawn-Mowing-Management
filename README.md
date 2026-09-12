# Lawn Mowing Management

A personal web app for tracking a lawn care business: yard-work visits
(mowing, trimming, edging, pruning, bush trimming - with the mowing pattern
used per visit), driveway and flowerbed weed spraying, equipment
maintenance (like blade sharpening), and local weather with a turfgrass
Growth Potential model and weekly rainfall for grass near Dayton, Ohio —
including a per-customer "ready to mow" indicator. A single "+ Log Event"
button on the Dashboard covers all of these event types in one place.

Built as a static site on **Firebase Hosting**, with **Firestore** as the
database and **Firebase Authentication** to keep the data private to one
account. There is no backend server to run or Cloud Functions to pay for —
weather data is fetched directly from the free [Open-Meteo](https://open-meteo.com/)
API in the browser and cached in Firestore.

## Features

- **Customers** — name, address, contact info, service frequency, active/inactive.
- **Log an Event (Dashboard button)** — one quick-entry form covering every
  event type: mowing, trimming, edging, pruning, and bush trimming as a
  single yard-work visit, or a spray application, without leaving the
  Dashboard.
- **Yard Work Log** — per-visit record of what was done (mowed, trimmed,
  edged, pruned, bushes trimmed), the mowing pattern used (stripes,
  diagonal, checkerboard, waves, circular, diamond, etc.), deck height, and
  notes.
- **Spray Log** — records whether you sprayed weeds (or other targets) in
  driveways, walkways, flowerbeds, or the lawn itself, which product you
  used, and notes.
- **Equipment Maintenance** — logs tasks like blade sharpening, blade
  replacement, oil changes, air filters, spark plugs, belts/cables, per
  piece of equipment.
- **Weather & Growth Potential** — daily high/low temps and precipitation
  for Dayton, OH, a turfgrass Growth Potential (GP) score (0-100%, how fast
  the grass is growing today), and a weekly rainfall chart.
- **Ready to Mow** — per customer, tracks accumulated Growth Potential
  since their last mow and flags the lawn "ready to mow" once it crosses a
  threshold you tune by observation. Shown on both the Dashboard and the
  Customers table.
- **Dashboard** — today's Growth Potential, 7-day average, last 7 days of
  rainfall, how many customers are ready to mow right now, and recent
  activity at a glance.

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

## How Growth Potential (GP) and "ready to mow" are calculated

Growth Potential is a model published by [PACE Turf](https://www.paceturf.org/)
(Woods, et al.) that estimates the fraction of a turfgrass species' maximum
growth rate you'd expect at a given temperature, as a Gaussian curve
centered on that species' optimal temperature:

```
GP = exp(-0.5 * ((meanTempC - Topt) / a)^2)
```

`meanTempC` is the day's mean temperature ((high + low) / 2, converted to
Celsius). `Topt` and `a` are species constants — this app uses the two
standard published profiles, selectable in the Weather & Growth tab:

| Grass type | Topt | a |
|---|---|---|
| Cool-season (Kentucky bluegrass, tall fescue, perennial ryegrass) | 20°C | 5.5 |
| Warm-season (bermudagrass, zoysiagrass) | 31°C | 10 |

Lawns in the Dayton, Ohio area are almost always cool-season turf, so that's
the default. GP is shown as a 0-100% score — near 100% means conditions are
close to ideal for that species and the grass is growing fast; low GP means
slow growth (too cold, too hot, or dormant).

**Ready to mow**: for each customer, the app sums the daily GP score for
every day since their last logged mow. Once that running total crosses the
**Mow Threshold (GP-days)** setting (default: 5), the lawn is flagged
"Ready to mow" — both on the Dashboard and as a column on the Customers
table, which also shows an estimated number of days until ready based on
the last 5 days' average GP. There's no universally "correct" threshold —
watch how the accumulated GP-days value tracks against what you actually
see in the yard over a few mow cycles, and adjust the threshold up or down
to match.

Weather data (daily high/low temperature and precipitation) is fetched
directly from Open-Meteo for Dayton, OH (39.7589, -84.1916) — recent days
from the forecast API (which also serves recent observed data) and the
rest of the year from the historical archive API — then cached in the
`weatherDaily` Firestore collection so the app doesn't need to refetch the
whole year every time.

## Data model (Firestore collections)

| Collection | Purpose |
|---|---|
| `customers` | Customer/property records |
| `mowVisits` | Yard-work visit log entries (mow/trim/edge/prune/bush-trim flags) |
| `sprayApplications` | Weed/insect/fungus/fertilizer spray log entries |
| `maintenanceTasks` | Equipment maintenance log entries |
| `weatherDaily` | Cached daily weather + Growth Potential inputs, keyed by date |
| `settings` | App settings (grass type, mow threshold in GP-days) |

## Security

Firestore rules (`firestore.rules`) restrict all reads and writes to a
signed-in user whose auth token email matches the address configured at
the top of that file. There's no public sign-up flow in the app UI, and
only the account you create manually in the Firebase console can sign in.
