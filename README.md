# Lawn Mowing Management

A personal web app for tracking a lawn care business: yard-work visits
(mowing, trimming, edging, pruning, bush trimming - with the mowing pattern
used, which piece of equipment, which part of the yard, and which plant or
object the work applied to), driveway and flowerbed weed spraying,
equipment maintenance (like blade sharpening), and local weather with a
turfgrass Growth Potential model and weekly rainfall for grass near
Dayton, Ohio — including a per-customer "ready to mow" indicator. A single
"+ Log Event" button on the Dashboard covers all of these event types in
one place.

Built as a static site on **Firebase Hosting**, with **Firestore** as the
database and **Firebase Authentication** to keep the data private to one
account. There is no backend server to run or Cloud Functions to pay for —
weather data is fetched directly from the free [Open-Meteo](https://open-meteo.com/)
API in the browser and cached in Firestore.

## Features

- **Log an Event (Dashboard button)** — one form for yard work, extra yard
  work and sprays, built from tap targets: pick a customer group or
  customers, tap the event types you did, then tasks and areas. The mow
  pattern is pre-picked as the next one in that customer's (or group's)
  rotation, and the mower with its deck height and speeds comes from their
  last mow; date, time, location and mower settings sit behind a "Change"
  button until you need them.
- **Log mow (Ready to Mow)** — each lawn (or street group) that's ready gets
  a button that opens Log Event already filled in for those customers: the
  next pattern, last visit's mower and settings, trim/edge choices,
  location and areas (and a double/triple cut if that's what was done last
  time), ready to check and save. The row previews what it will fill in.
- **Run sheet** — for a customer group: set the pattern, mower and grass once,
  tick each house done (or skip it) as you go, adjust tasks, extra work or
  areas per house, and save every finished house at the end. Start one from
  Group Mow Patterns or a group's Ready to Mow row.
- **Cuts: areas mowed differently, double and triple cuts** — "+ Add a
  second cut" (then another) on a mow in Log Event, the run sheet, or when
  editing a visit in History. Each cut has its own areas, pattern, mower,
  deck height and speeds, so the front yard can be cut twice with one mower
  while the back yard gets one pass with another. A double (or triple) cut
  means some area was cut twice (or three times): front twice and back once
  is a double cut on the front yard. The visit's pattern is the final
  cut's, so the rotation follows the stripes that show. On the run sheet,
  cuts pick areas by name ("Front Yard") and each house gets the cuts that
  match its own areas. The Dashboard counts this year's double/triple cuts,
  History's Customer view counts them per customer or group, and History's
  Multi-cut filter lists them. Ready to Mow's Log mow fills in the same
  cuts (areas, mowers and all) if that's what was done last time.
- **History** — every yard work visit and spray in one place. Yard work
  records what was done (mowed, trimmed, edged, pruned, bushes trimmed,
  mulched), the mowing pattern used (parallel, perpendicular, diagonal left,
  diagonal right, other), deck height, ground speed, blade speed, time of
  day, grass condition, areas, plant/object, equipment, and notes; sprays
  record the target (weeds, insects, fungus, fertilizer, or other), product
  and quantity, equipment, areas, and notes. Filter by type (yard work,
  extra yard work, sprays), customer group, customer, and date range, and
  browse it five ways:
  - **Days** — one card per customer per day combining everything done
    there; tap a card for the full details and Edit/Delete.
  - **Groups** — each day split by customer group, showing the group's mow
    pattern, how many neighbors got done, and a **Log visit** shortcut for
    anyone skipped.
  - **Calendar** — a month grid marking yard work, extra yard work, and
    spray days; pick a day to see its visits.
  - **Customer** — for one customer or group: last pattern, next pattern in
    the rotation, days since the last mow, typical gap between mows, the
    recent pattern rotation, and their full visit list.
  - **Last Sprayed** — every customer sorted by how long since their last
    spray for a given target (e.g. weeds), to see who's due.
- **Settings** — customer records, each with a **primary contact** (name,
  phone, email — the phone auto-formats to `(XXX) XXX-XXXX`) and an address
  you can validate against real US postal data with one click; **locations**
  (a customer's properties - most have one, but a customer with a rental or
  second property can have more), each with its own address (or "same as
  customer address"), validated the same way, and any **additional
  contacts** for that property (a tenant, property manager, etc. — separate
  from the customer's primary contact) with their own **areas** (Front
  Yard, Back Yard, or whatever subdivisions make sense for that property);
  **yard features** (plants, trees, shrubs, or other objects worth tracking
  within a specific area, like "rose bushes by the mailbox" in the Front
  Yard); an **equipment** registry (mowers, trimmers, edgers, blowers,
  sprayers, spare blades - mowers store their available deck height, ground
  speed, and blade speed settings, e.g. deck heights of 2", 2.5", 3",
  ground speeds of 1-5, blade speeds of Low/High; picking that mower
  elsewhere turns each of those fields into a select limited to its
  settings; each piece of equipment can also record its brand, model
  number, serial number, purchase date, and where it was purchased from -
  Brand and Purchased From offer a dropdown of values you've used before
  but still accept a new one); and equipment maintenance tasks (blade
  sharpening, tire checks, oil changes, etc., tied to a specific piece of
  equipment, filterable by equipment type). All of this lives in Settings
  since it's set-up/upkeep rather than day-to-day logging.
- **Weather & Growth Potential** — daily high/low temps and precipitation
  for Dayton, OH, a turfgrass Growth Potential (GP) score (0-100%, how fast
  the grass is growing today), and a weekly rainfall chart.
- **Ready to Mow** — per customer, tracks accumulated Growth Potential
  since their last mow and flags the lawn "ready to mow" once it crosses a
  threshold you tune by observation. Shown on the Dashboard.
- **Dashboard** — today's Growth Potential, 7-day average, last 7 days of
  rainfall, how many customers are ready to mow right now, and recent
  activity at a glance.

## Tech stack

- Plain HTML/CSS/JavaScript (ES modules), no build step required.
- [Firebase](https://firebase.google.com/) Hosting, Firestore, and Authentication (Email/Password).
- [Open-Meteo](https://open-meteo.com/) forecast + historical archive APIs for weather (no API key needed).
- [US Census Bureau Geocoder](https://geocoding.geo.census.gov/) for the "Validate" button on customer/location addresses (no API key needed; US addresses only).

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

`.github/workflows/firebase-hosting.yml` deploys `public/` to Firebase Hosting **and** deploys `firestore.rules`/`firestore.indexes.json` to your live Firestore project, on every push to `main`. Both matter: adding a new collection to `firestore.rules` in this repo does nothing on its own until it's actually deployed - Firestore denies access to any collection with no matching rule. To enable it:

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

## Locations, areas, and yard features

These three sit in a simple hierarchy, all managed in Settings:

```
Customer -> Location(s) -> Area(s) -> Yard Feature(s)
```

- A **Location** is a customer's property - its address. Most customers
  have exactly one; a customer with a rental property or a second home
  would have more than one.
- An **Area** is a subdivision of a location - Front Yard, Back Yard,
  Driveway, whatever makes sense for that property. Unlike the old fixed
  list, areas are just data you create, so name them however you like.
- A **Yard Feature** is a specific plant, tree, shrub, or other object
  worth tracking within a specific area - "Rose bushes by mailbox," "Oak
  tree in back corner" - with a type (plant/tree/shrub/hardscape/other)
  and notes.

When logging a yard-work visit or spray application, picking a customer
narrows the Location dropdown to that customer's properties, picking a
location narrows the Area dropdown to that property's areas, and picking
an area narrows the Plant/Object dropdown to that area's features - so you
can log something as specific as "pruned the boxwood hedge in the Front
Yard at the Smiths' rental property" instead of just "pruned."

## Data model (Firestore collections)

| Collection | Purpose |
|---|---|
| `customers` | Customer records, with a primary contact (name/phone/email) and address |
| `locations` | A customer's properties/addresses (usually one per customer), with any additional contacts for that property |
| `areas` | Subdivisions of a location (Front Yard, Back Yard, etc.) |
| `yardFeatures` | Plants/trees/shrubs/objects worth tracking, one per area |
| `mowVisits` | Yard-work visit log entries (mow/trim/edge/prune/bush-trim flags, pattern, deck height, ground speed, blade speed, time of day, grass condition, location, area, equipment, feature) |
| `sprayApplications` | Weed/insect/fungus/fertilizer spray log entries (target, product, location, area, equipment, feature) |
| `maintenanceTasks` | Equipment maintenance log entries, tied to an equipment record |
| `equipment` | Mowers, trimmers, edgers, blowers, sprayers - mowers carry lists of deck height, ground speed, and blade speed settings |
| `weatherDaily` | Cached daily weather + Growth Potential inputs, keyed by date |
| `settings` | App settings (grass type, mow threshold in GP-days) |

## Security

Firestore rules (`firestore.rules`) restrict all reads and writes to a
signed-in user whose auth token email matches the address configured at
the top of that file. There's no public sign-up flow in the app UI, and
only the account you create manually in the Firebase console can sign in.
