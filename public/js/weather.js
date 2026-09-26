import { listAll, batchSet, getDocById, setDocById } from "./db.js";
import { todayStr } from "./utils.js";

// Dayton, Ohio
export const LOCATION = { lat: 39.7589, lon: -84.1916, timezone: "America/New_York" };

// Days of forecast kept after today, for when a lawn will be ready to mow.
const FORECAST_DAYS = 7;

function addDaysStr(dateStr, delta) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

function parseDaily(json) {
  const { time, temperature_2m_max, temperature_2m_min, precipitation_sum } = json.daily;
  return time.map((date, i) => ({
    date,
    tmaxF: temperature_2m_max[i],
    tminF: temperature_2m_min[i],
    precipIn: precipitation_sum[i] ?? 0,
  }));
}

// Forecast API also serves the last `pastDays` of observed data, and is
// more current than the archive API for the most recent few days.
// forecastDays counts today.
export async function fetchRecent(pastDays = 10, forecastDays = 1, place = LOCATION) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum` +
    `&temperature_unit=fahrenheit&precipitation_unit=inch` +
    `&timezone=${encodeURIComponent(LOCATION.timezone)}&past_days=${pastDays}&forecast_days=${forecastDays}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather forecast fetch failed (${res.status})`);
  return parseDaily(await res.json());
}

// Historical reanalysis archive - covers the full season but typically
// lags several days behind real time, so it's paired with fetchRecent().
export async function fetchHistorical(startDate, endDate, place = LOCATION) {
  if (startDate > endDate) return [];
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${place.lat}&longitude=${place.lon}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum` +
    `&temperature_unit=fahrenheit&precipitation_unit=inch` +
    `&timezone=${encodeURIComponent(LOCATION.timezone)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather archive fetch failed (${res.status})`);
  return parseDaily(await res.json());
}

// Whether any day from start through end is missing from dates.
function hasGap(dates, start, end) {
  for (let d = start; d <= end; d = addDaysStr(d, 1)) {
    if (!dates.has(d)) return true;
  }
  return false;
}

// Fetches what a place's cached days are missing: the season from the
// archive when there's a gap, and always the last 10 days (which the
// forecast API can still revise) plus the coming week's forecast. Returns
// { days: fetched days through today, forecast: the days after }.
async function fetchMissing(cachedDates, seasonStartDate, place) {
  const today = todayStr();
  const archiveEnd = addDaysStr(today, -10);
  const [historical, recent] = await Promise.all([
    hasGap(cachedDates, seasonStartDate, archiveEnd) ? fetchHistorical(seasonStartDate, archiveEnd, place) : Promise.resolve([]),
    fetchRecent(10, FORECAST_DAYS + 1, place),
  ]);
  return {
    days: [...historical, ...recent.filter((d) => d.date <= today)],
    forecast: recent.filter((d) => d.date > today),
  };
}

function seasonDays(daysByDate, seasonStartDate) {
  const today = todayStr();
  return Array.from(daysByDate.values())
    .filter((d) => d.date >= seasonStartDate && d.date <= today)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

// Fetches weather since seasonStartDate through today and caches the
// result in Firestore, returning the merged daily records. Once a day's
// weather is cached it never changes, so on every call this only re-fetches
// and re-writes the last 10 days (which the forecast API can still revise)
// plus any older days genuinely missing from the cache (e.g. the very
// first run, or after the app sat unused for a while) - not the whole
// season every time. The coming week's forecast is kept alongside (see
// loadForecast).
export async function syncWeather(seasonStartDate) {
  const cached = await loadCachedWeather(seasonStartDate);
  const { days, forecast } = await fetchMissing(new Set(cached.map((d) => d.date)), seasonStartDate, LOCATION);
  if (days.length) await batchSet("weatherDaily", days, "date");
  await setDocById("weatherCells", "home", { forecast, syncedOn: todayStr() });

  const merged = new Map(cached.map((d) => [d.date, d]));
  for (const d of days) merged.set(d.date, d);
  return seasonDays(merged, seasonStartDate);
}

export async function loadCachedWeather(seasonStartDate) {
  const days = await listAll("weatherDaily", { where: ["date", ">=", seasonStartDate] });
  return days.sort((a, b) => (a.date < b.date ? -1 : 1));
}

function upcoming(forecast = []) {
  const today = todayStr();
  return forecast.filter((d) => d.date > today);
}

// The coming week's forecast for Dayton, from the last sync.
export async function loadForecast() {
  const doc = await getDocById("weatherCells", "home");
  return upcoming(doc?.forecast);
}

// Weather for another spot (a customer's lawn some miles away), cached as
// one weatherCells doc per spot - the season's days and the coming week's
// forecast - and fetched at most once a day. Returns whether it fetched.
export async function syncCellWeather(id, place, seasonStartDate) {
  const today = todayStr();
  const cached = await getDocById("weatherCells", id);
  if (cached?.syncedOn === today) return false;
  const cachedDays = cached?.days || [];
  const { days, forecast } = await fetchMissing(new Set(cachedDays.map((d) => d.date)), seasonStartDate, place);
  const merged = new Map(cachedDays.map((d) => [d.date, d]));
  for (const d of days) merged.set(d.date, d);
  await setDocById("weatherCells", id, { lat: place.lat, lon: place.lon, days: seasonDays(merged, seasonStartDate), forecast, syncedOn: today });
  return true;
}

// A spot's cached weather: { days, forecast }, or null if never fetched.
export async function loadCellWeather(id) {
  const doc = await getDocById("weatherCells", id);
  return doc?.days?.length ? { days: doc.days, forecast: upcoming(doc.forecast) } : null;
}
