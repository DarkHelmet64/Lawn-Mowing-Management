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

// Groups daily precipitation into calendar weeks starting Sunday. Dates are
// normalized as UTC midnight so the grouping is deterministic regardless of
// the viewer's local timezone.
export function weeklyRainfall(days) {
  const weeks = new Map();
  for (const d of days) {
    const date = new Date(`${d.date}T00:00:00Z`);
    const sunday = new Date(date);
    sunday.setUTCDate(date.getUTCDate() - date.getUTCDay());
    const key = sunday.toISOString().slice(0, 10);
    const entry = weeks.get(key) || { weekStart: key, totalPrecipIn: 0 };
    entry.totalPrecipIn += d.precipIn || 0;
    weeks.set(key, entry);
  }
  return Array.from(weeks.values()).sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
}

export function last7DaysRainfall(days, todayStr) {
  const cutoff = new Date(`${todayStr}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 6);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  return days
    .filter((d) => d.date >= cutoffStr && d.date <= todayStr)
    .reduce((sum, d) => sum + (d.precipIn || 0), 0);
}
