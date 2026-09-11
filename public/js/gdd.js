// Pure calculation helpers - no Firebase or DOM dependencies, so these are
// easy to reason about and test in isolation.

export function dailyGDD(tmaxF, tminF, baseF) {
  const avg = (tmaxF + tminF) / 2;
  return Math.max(0, avg - baseF);
}

// days: [{date: "YYYY-MM-DD", tmaxF, tminF, precipIn}], any order.
// Dates are compared as strings, which works because ISO YYYY-MM-DD sorts
// lexicographically in calendar order.
export function accumulateGDD(days, baseF, seasonStartDate) {
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : 1));
  let cumulative = 0;
  return sorted
    .filter((d) => d.date >= seasonStartDate)
    .map((d) => {
      const gdd = dailyGDD(d.tmaxF, d.tminF, baseF);
      cumulative += gdd;
      return { ...d, gdd, cumulativeGdd: cumulative };
    });
}

// Groups daily precipitation into calendar weeks starting Sunday.
// Dates are normalized as UTC midnight so the grouping is deterministic
// regardless of the viewer's local timezone.
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
