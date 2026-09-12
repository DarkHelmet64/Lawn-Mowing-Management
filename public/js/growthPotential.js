// Growth Potential (GP) model (Woods / PACE Turf) - estimates the fraction
// of a turfgrass species' maximum growth rate expected at a given mean
// temperature. GP ranges 0-1 (shown as 0-100%): higher means the grass is
// growing faster and will need mowing sooner.
//
//   GP = exp(-0.5 * ((T - Topt) / a)^2)
//
// T is the mean daily air temperature in Celsius. Topt and a are species
// constants - these are the standard published values for the two broad
// turfgrass groups.
export const COOL_SEASON = {
  key: "cool",
  label: "Cool-season (bluegrass, tall fescue, ryegrass)",
  Topt: 20,
  a: 5.5,
};

export const WARM_SEASON = {
  key: "warm",
  label: "Warm-season (bermudagrass, zoysiagrass)",
  Topt: 31,
  a: 10,
};

export function profileFor(grassType) {
  return grassType === "warm" ? WARM_SEASON : COOL_SEASON;
}

function meanTempC(tmaxF, tminF) {
  const meanF = (tmaxF + tminF) / 2;
  return (meanF - 32) * (5 / 9);
}

export function dailyGrowthPotential(tmaxF, tminF, profile) {
  const t = meanTempC(tmaxF, tminF);
  return Math.exp(-0.5 * Math.pow((t - profile.Topt) / profile.a, 2));
}

// days: [{date, tmaxF, tminF, precipIn}], any order.
export function growthPotentialSeries(days, profile) {
  return [...days]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((d) => ({ ...d, gp: dailyGrowthPotential(d.tmaxF, d.tminF, profile) }));
}

// Calendar week (Sunday start) containing a date, as a "YYYY-MM-DD" key.
// Dates are normalized as UTC midnight so the grouping is deterministic
// regardless of the viewer's local timezone.
function weekStartKey(dateStr) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  const sunday = new Date(date);
  sunday.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return sunday.toISOString().slice(0, 10);
}

// Groups daily precipitation into calendar weeks starting Sunday.
export function weeklyRainfall(days) {
  const weeks = new Map();
  for (const d of days) {
    const key = weekStartKey(d.date);
    const entry = weeks.get(key) || { weekStart: key, totalPrecipIn: 0 };
    entry.totalPrecipIn += d.precipIn || 0;
    weeks.set(key, entry);
  }
  return Array.from(weeks.values()).sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
}

// Averages a GP series (as returned by growthPotentialSeries) into calendar
// weeks starting Sunday. Average, not sum, since GP is itself a 0-1 fraction.
export function weeklyGrowthPotential(series) {
  const weeks = new Map();
  for (const d of series) {
    const key = weekStartKey(d.date);
    const entry = weeks.get(key) || { weekStart: key, total: 0, count: 0 };
    entry.total += d.gp;
    entry.count += 1;
    weeks.set(key, entry);
  }
  return Array.from(weeks.values())
    .sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1))
    .map((w) => ({ weekStart: w.weekStart, gp: w.total / w.count }));
}

// Averages a GP series into calendar months ("YYYY-MM").
export function monthlyGrowthPotential(series) {
  const months = new Map();
  for (const d of series) {
    const key = d.date.slice(0, 7);
    const entry = months.get(key) || { month: key, total: 0, count: 0 };
    entry.total += d.gp;
    entry.count += 1;
    months.set(key, entry);
  }
  return Array.from(months.values())
    .sort((a, b) => (a.month < b.month ? -1 : 1))
    .map((m) => ({ month: m.month, gp: m.total / m.count }));
}

export function last7DaysRainfall(days, todayStr) {
  const cutoff = new Date(`${todayStr}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 6);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return days
    .filter((d) => d.date >= cutoffStr && d.date <= todayStr)
    .reduce((sum, d) => sum + (d.precipIn || 0), 0);
}
