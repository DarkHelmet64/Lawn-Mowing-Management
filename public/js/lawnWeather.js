import { LOCATION, syncCellWeather, loadCellWeather, loadForecast } from "./weather.js";
import { getActiveCustomers } from "./customers.js";
import { getLocationsForCustomer } from "./locations.js";
import { getVisits } from "./mowLog.js";
import { geocodeAddress } from "./addressValidation.js";
import { updateDocById } from "./db.js";
import { todayStr } from "./utils.js";

// Ready to Mow uses the weather at each lawn rather than one town-wide
// reading, since rain especially can differ a lot a few miles apart. Lawns
// are grouped into squares 0.1° of latitude/longitude across (about 7
// miles, roughly the weather data's own resolution) and each square's
// weather is fetched once. A lawn whose address hasn't been found on the
// map yet uses Dayton's.

export function cellKey(lat, lon) {
  return `${lat.toFixed(1)},${lon.toFixed(1)}`;
}

function cellCenter(key) {
  const [lat, lon] = key.split(",").map(Number);
  return { lat, lon };
}

const HOME_CELL = cellKey(LOCATION.lat, LOCATION.lon);

// Nominatim asks for no more than one lookup a second.
const GEOCODE_GAP_MS = 1100;

// Where a customer's lawn is: the location of their last mow, else their
// first location with an address, else their own address. { collection,
// record } - the record whose address (and looked-up geo) is used.
export function lawnPlaceFor(customer) {
  const locations = getLocationsForCustomer(customer.id).filter((l) => l.address);
  const lastMow = getVisits()
    .filter((v) => v.customerId === customer.id && v.mowed && v.locationId)
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const location = locations.find((l) => l.id === lastMow?.locationId) || locations[0];
  if (location) return { collection: "locations", record: location };
  if (customer.address) return { collection: "customers", record: customer };
  return null;
}

// The record's { lat, lon } if its current address has been found.
function coordsOf(place) {
  const geo = place?.record.geo;
  return geo && geo.lat != null && geo.address === place.record.address ? geo : null;
}

function needsLookup(place) {
  return place && place.record.geo?.address !== place.record.address;
}

function cellFor(customer) {
  const geo = coordsOf(lawnPlaceFor(customer));
  return geo ? cellKey(geo.lat, geo.lon) : HOME_CELL;
}

// "Weather: from Home (123 Main St)." - for the customer form.
export function lawnWeatherText(customer) {
  const place = lawnPlaceFor(customer);
  if (!place) return "Weather: Dayton, OH (no address on file).";
  const { record } = place;
  const where = place.collection === "locations" ? `${record.label} (${record.address})` : record.address;
  if (coordsOf(place)) return `Weather: from ${where}.`;
  if (!needsLookup(place)) return `Weather: Dayton, OH - ${where} couldn't be found on the map.`;
  return `Weather: Dayton, OH until ${where} is found on the map.`;
}

// Each active customer's weather from what's cached, as a function giving
// a customer's { days, forecast }. homeDays is Dayton's season, already
// loaded for the Weather page.
export async function loadLawnWeather(homeDays) {
  const keys = [...new Set(getActiveCustomers().map(cellFor))].filter((k) => k !== HOME_CELL);
  const [homeForecast, ...cells] = await Promise.all([loadForecast(), ...keys.map((k) => loadCellWeather(k).catch(() => null))]);
  const home = { days: homeDays, forecast: homeForecast };
  const byCell = new Map(keys.map((k, i) => [k, cells[i] || home]));
  return (customer) => byCell.get(cellFor(customer)) || home;
}

async function lookUpAddresses() {
  const places = new Map();
  for (const c of getActiveCustomers()) {
    const place = lawnPlaceFor(c);
    if (needsLookup(place)) places.set(`${place.collection}/${place.record.id}`, place);
  }
  let changed = false;
  let first = true;
  for (const { collection, record } of places.values()) {
    if (!first) await new Promise((resolve) => setTimeout(resolve, GEOCODE_GAP_MS));
    first = false;
    const address = record.address;
    let geo;
    try {
      const found = await geocodeAddress(address);
      geo = found ? { ...found, address } : { address, notFound: true };
    } catch (err) {
      console.error("Address lookup failed, will retry next time", err);
      continue;
    }
    await updateDocById(collection, record.id, { geo });
    record.geo = geo;
    changed = true;
  }
  return changed;
}

// Spots already brought up to date today, so a re-run skips them.
const syncedToday = new Map();

async function syncOnce(seasonStartDate) {
  let changed = await lookUpAddresses();
  const today = todayStr();
  const keys = [...new Set(getActiveCustomers().map(cellFor))].filter((k) => k !== HOME_CELL && syncedToday.get(k) !== today);
  for (const key of keys) {
    try {
      if (await syncCellWeather(key, cellCenter(key), seasonStartDate)) changed = true;
      syncedToday.set(key, today);
    } catch (err) {
      console.error(`Weather sync failed for ${key}, keeping cached data`, err);
    }
  }
  return changed;
}

let running = null;
let again = false;

// Finds any new lawn addresses on the map, then fetches weather for any
// spot not yet fetched today. Resolves to whether anything changed. If
// called again while running, runs once more afterwards (for a customer
// saved mid-sync).
export function syncLawnWeather(seasonStartDate) {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    let changed = false;
    do {
      again = false;
      if (await syncOnce(seasonStartDate)) changed = true;
    } while (again);
    return changed;
  })().finally(() => {
    running = null;
  });
  return running;
}
