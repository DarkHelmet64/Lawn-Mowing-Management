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

// Fetches weather since seasonStartDate through today, merges the archive
// and forecast sources (forecast wins on overlapping recent dates), caches
// the results in Firestore, and returns the merged daily records.
export async function syncWeather(seasonStartDate) {
  const today = todayStr();
  const recentCutoff = addDaysStr(today, -9);
  const archiveEnd = addDaysStr(recentCutoff, -1);

  const [historical, recent] = await Promise.all([
    seasonStartDate <= archiveEnd ? fetchHistorical(seasonStartDate, archiveEnd) : Promise.resolve([]),
    fetchRecent(10),
  ]);

  const merged = new Map();
  for (const d of historical) merged.set(d.date, d);
  for (const d of recent) merged.set(d.date, d);

  const days = Array.from(merged.values())
    .filter((d) => d.date >= seasonStartDate && d.date <= today)
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  await batchSet("weatherDaily", days, "date");
  return days;
}

export async function loadCachedWeather(seasonStartDate) {
  const all = await listAll("weatherDaily");
  return all
    .filter((d) => d.date >= seasonStartDate)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}
