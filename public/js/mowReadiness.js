import { dailyGrowthPotential } from "./growthPotential.js";

// Estimates, per customer, how close their lawn is to needing another mow.
// The idea: after a mow, accumulate each day's Growth Potential (a 0-1
// score for how fast the grass is growing that day) until the running
// total crosses a threshold the operator has tuned by observation - at
// that point the lawn is considered "ready to mow" again.
//
// customers: [{id, ...}]
// visits: [{customerId, date, mowed}]
// weatherDays: [{date, tmaxF, tminF}] (any order, no gaps assumed)
// options: { grassProfile, mowThresholdGPDays }
//
// Returns Map<customerId, {
//   lastMowDate: string | null,
//   daysSinceMow: number | null,
//   accumulatedGP: number | null,
//   ready: boolean,
//   estimatedDaysUntilReady: number | null,
// }>
export function computeMowStatus(customers, visits, weatherDays, { grassProfile, mowThresholdGPDays }) {
  const byDate = new Map(weatherDays.map((d) => [d.date, d]));
  const sortedDates = [...byDate.keys()].sort();

  const result = new Map();
  for (const customer of customers) {
    const mowedVisits = visits
      .filter((v) => v.customerId === customer.id && v.mowed)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    const lastMow = mowedVisits[0];

    if (!lastMow) {
      result.set(customer.id, {
        lastMowDate: null,
        daysSinceMow: null,
        accumulatedGP: null,
        ready: false,
        estimatedDaysUntilReady: null,
      });
      continue;
    }

    const daysSince = sortedDates.filter((d) => d > lastMow.date);
    let accumulatedGP = 0;
    for (const d of daysSince) {
      const rec = byDate.get(d);
      accumulatedGP += dailyGrowthPotential(rec.tmaxF, rec.tminF, grassProfile);
    }

    const recentWindow = daysSince.slice(-5);
    const avgRecentGP = recentWindow.length
      ? recentWindow.reduce((sum, d) => {
          const rec = byDate.get(d);
          return sum + dailyGrowthPotential(rec.tmaxF, rec.tminF, grassProfile);
        }, 0) / recentWindow.length
      : 0;

    const ready = accumulatedGP >= mowThresholdGPDays;
    const estimatedDaysUntilReady = ready || avgRecentGP <= 0
      ? 0
      : Math.ceil((mowThresholdGPDays - accumulatedGP) / avgRecentGP);

    result.set(customer.id, {
      lastMowDate: lastMow.date,
      daysSinceMow: daysSince.length,
      accumulatedGP,
      ready,
      estimatedDaysUntilReady,
    });
  }
  return result;
}
