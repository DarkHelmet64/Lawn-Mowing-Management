import { listAll, batchSet } from "./db.js";
import { todayStr } from "./utils.js";

// Dayton, Ohio
export const LOCATION = { lat: 39.7589, lon: -84.1916, timezone: "America/New_York" };

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
export async function fetchRecent(pastDays = 10) {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${LOCATION.lat}&longitude=${LOCATION.lon}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum` +
    `&temperature_unit=fahrenheit&precipitation_unit=inch` +
    `&timezone=${encodeURIComponent(LOCATION.timezone)}&past_days=${pastDays}&forecast_days=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather forecast fetch failed (${res.status})`);
  return parseDaily(await res.json());
}

// Historical reanalysis archive - covers the full season but typically
// lags several days behind real time, so it's paired with fetchRecent().
export async function fetchHistorical(startDate, endDate) {
  if (startDate > endDate) return [];
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${LOCATION.lat}&longitude=${LOCATION.lon}` +
    `&start_date=${startDate}&end_date=${endDate}` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum` +
    `&temperature_unit=fahrenheit&precipitation_unit=inch` +
    `&timezone=${encodeURIComponent(LOCATION.timezone)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Weather archive fetch failed (${res.status})`);
  return parseDaily(await res.json());
}

// Fetches weather since seasonStartDate through today and caches the
// result in Firestore, returning the merged daily records. Once a day's
// weather is cached it never changes, so on every call this only re-fetches
// and re-writes the last 10 days (which the forecast API can still revise)
// plus any older days genuinely missing from the cache (e.g. the very
// first run, or after the app sat unused for a while) - not the whole
// season every time.
export async function syncWeather(seasonStartDate) {
  const today = todayStr();
  const recentCutoff = addDaysStr(today, -9);
  const archiveEnd = addDaysStr(recentCutoff, -1);

  const cached = await loadCachedWeather(seasonStartDate);
  const cachedDates = new Set(cached.map((d) => d.date));

  let needsBackfill = false;
  if (seasonStartDate <= archiveEnd) {
    for (let d = seasonStartDate; d <= archiveEnd; d = addDaysStr(d, 1)) {
      if (!cachedDates.has(d)) {
        needsBackfill = true;
        break;
      }
    }
  }

  const [historical, recent] = await Promise.all([
    needsBackfill ? fetchHistorical(seasonStartDate, archiveEnd) : Promise.resolve([]),
    fetchRecent(10),
  ]);

  const freshlyFetched = [...historical, ...recent];
  if (freshlyFetched.length) await batchSet("weatherDaily", freshlyFetched, "date");

  const merged = new Map(cached.map((d) => [d.date, d]));
  for (const d of freshlyFetched) merged.set(d.date, d);

  return Array.from(merged.values())
    .filter((d) => d.date >= seasonStartDate && d.date <= today)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export async function loadCachedWeather(seasonStartDate) {
  const days = await listAll("weatherDaily", { where: ["date", ">=", seasonStartDate] });
  return days.sort((a, b) => (a.date < b.date ? -1 : 1));
}
