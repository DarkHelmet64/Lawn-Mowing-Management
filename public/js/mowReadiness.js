import { dailyGrowthPotential, profileFor } from "./growthPotential.js";
import { todayStr } from "./utils.js";

// Estimates, per customer, how close their lawn is to needing another mow.
// The idea: after a mow, accumulate each day's growth - its Growth Potential
// (a 0-1 score for how fast the grass grows at that day's temperature),
// slowed down in a dry spell - until the running total crosses a threshold
// the operator has tuned by observation. At that point the lawn is "ready
// to mow" again. The next week's forecast says when a lawn that isn't
// ready yet will be.

// Rain is counted over the last two weeks, since the soil holds water for a
// while - one dry week after a wet one barely slows a lawn down.
const RAIN_WINDOW_DAYS = 14;
// A lawn with no rain at all for two weeks still grows a little.
const DRY_FLOOR = 0.3;
// Days whose growth, on average, is below this aren't really growing (cold
// or drought dormancy), so no ready date is guessed.
const MIN_GROWTH = 0.02;

// How much a dry spell slows growth: 1 with at least the rain the lawn
// needs, down to DRY_FLOOR with none. The curve drops gently at first and
// steeply near bone dry, since the soil keeps a lawn going through a
// somewhat dry stretch (half the rain still gives about 80% growth).
export function moistureFactor(rainIn, neededIn) {
  if (!(neededIn > 0)) return 1;
  return DRY_FLOOR + (1 - DRY_FLOOR) * Math.sqrt(Math.min(1, rainIn / neededIn));
}

// Each day's growth, in date order: its GP, times the dry-spell factor when
// rainFullGrowthIn (inches a week for full growth) is set.
export function growthSeries(days, profile, rainFullGrowthIn = null) {
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : 1));
  return sorted.map((d, i) => {
    const gp = dailyGrowthPotential(d.tmaxF, d.tminF, profile);
    if (!rainFullGrowthIn) return { date: d.date, gp, moisture: 1, growth: gp };
    const window = sorted.slice(Math.max(0, i - RAIN_WINDOW_DAYS + 1), i + 1);
    const rain = window.reduce((sum, w) => sum + (w.precipIn || 0), 0);
    const moisture = moistureFactor(rain, (rainFullGrowthIn * window.length) / 7);
    return { date: d.date, gp, moisture, growth: gp * moisture };
  });
}

// A customer's own grass type, threshold and watering, falling back to the
// Weather & Growth settings. An irrigated lawn never runs dry, so rainfall
// doesn't slow it down.
export function mowSettingsFor(customer, settings) {
  const own = Number(customer?.mowThresholdGPDays);
  return {
    profile: profileFor(customer?.grassType || settings.grassType),
    threshold: own > 0 ? own : settings.mowThresholdGPDays,
    rainFullGrowthIn: settings.rainAdjust !== false && !customer?.irrigated ? settings.rainFullGrowthIn || null : null,
  };
}

function utcMs(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function daysBetween(from, to) {
  return Math.round((utcMs(to) - utcMs(from)) / 86400000);
}

function addDays(dateStr, n) {
  return new Date(utcMs(dateStr) + n * 86400000).toISOString().slice(0, 10);
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// customers: [{id, grassType?, mowThresholdGPDays?, irrigated?}]
// visits: [{customerId, date, mowed}]
// weatherFor(customer): { days: [{date, tmaxF, tminF, precipIn}] through
//   today, forecast: [the same] for the days after }
// settings: { grassType, mowThresholdGPDays, rainAdjust, rainFullGrowthIn }
//
// Returns Map<customerId, {
//   neverMowed: boolean,
//   lastMowDate: string | null,
//   daysSinceMow: number | null,
//   accumulatedGP: number | null,
//   threshold: number,
//   ready: boolean,
//   estimatedDaysUntilReady: number | null (null: not growing enough to say),
//   estimatedDate: string | null,
//   estimateFromForecast: boolean (false: extrapolated past the forecast),
// }>
export function computeMowStatus(customers, visits, weatherFor, settings, today = todayStr()) {
  const result = new Map();
  for (const customer of customers) {
    const { profile, threshold, rainFullGrowthIn } = mowSettingsFor(customer, settings);
    const lastMow = visits
      .filter((v) => v.customerId === customer.id && v.mowed)
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];

    if (!lastMow) {
      result.set(customer.id, {
        neverMowed: true,
        lastMowDate: null,
        daysSinceMow: null,
        accumulatedGP: null,
        threshold,
        ready: false,
        estimatedDaysUntilReady: null,
        estimatedDate: null,
        estimateFromForecast: false,
      });
      continue;
    }

    // History and forecast together, so the rain window runs straight on
    // from the last few days into the forecast.
    const { days, forecast = [] } = weatherFor(customer);
    const series = growthSeries([...days.filter((d) => d.date <= today), ...forecast.filter((d) => d.date > today)], profile, rainFullGrowthIn);
    const sinceMow = series.filter((d) => d.date > lastMow.date && d.date <= today);
    const ahead = series.filter((d) => d.date > today);

    const accumulatedGP = sinceMow.reduce((sum, d) => sum + d.growth, 0);
    const ready = accumulatedGP >= threshold;

    let estimatedDaysUntilReady = ready ? 0 : null;
    let estimateFromForecast = ready;
    if (!ready) {
      let total = accumulatedGP;
      for (const d of ahead) {
        total += d.growth;
        if (total >= threshold) {
          estimatedDaysUntilReady = daysBetween(today, d.date);
          estimateFromForecast = true;
          break;
        }
      }
      if (!estimateFromForecast) {
        // Past the forecast, keep going at the forecast's pace (or the last
        // few days', with no forecast).
        const pace = mean((ahead.length ? ahead : series.filter((d) => d.date <= today).slice(-5)).map((d) => d.growth));
        if (pace >= MIN_GROWTH) estimatedDaysUntilReady = ahead.length + Math.ceil((threshold - total) / pace);
      }
    }

    result.set(customer.id, {
      neverMowed: false,
      lastMowDate: lastMow.date,
      daysSinceMow: daysBetween(lastMow.date, today),
      accumulatedGP,
      threshold,
      ready,
      estimatedDaysUntilReady,
      estimatedDate: estimatedDaysUntilReady == null ? null : addDays(today, estimatedDaysUntilReady),
      estimateFromForecast,
    });
  }
  return result;
}

// What someone's own mowing says their threshold is. Every gap between
// back-to-back mows is how much growth they let build up before mowing;
// the middle value of the recent gaps is the suggestion. For a group
// (customers mowed together) the gaps are between the group's mow rounds,
// with each gap's growth averaged over its customers.

// Mows this close together are one round - a street done over a day or two.
const SAME_ROUND_DAYS = 2;
// Longer gaps are vacations, dormancy or the season's start, not a normal
// mowing interval.
const MAX_GAP_DAYS = 21;
const MAX_GAPS = 10;
export const MIN_GAPS = 4;

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Returns {
//   suggestion: number | null (null: fewer than MIN_GAPS gaps to go on),
//   gaps: [{ from, to, days, growth }] counted, newest first,
//   skipped: [{ from, to, days }] too long to count, newest first,
//   low, high: the counted gaps' range,
// }
export function suggestThreshold(customers, visits, weatherFor, settings, today = todayStr()) {
  const ids = new Set(customers.map((c) => c.id));
  const dates = [...new Set(visits.filter((v) => ids.has(v.customerId) && v.mowed && v.date <= today).map((v) => v.date))].sort();
  // Each round starts on its first day.
  const rounds = [];
  let lastDate = null;
  for (const d of dates) {
    if (!lastDate || daysBetween(lastDate, d) > SAME_ROUND_DAYS) rounds.push(d);
    lastDate = d;
  }

  // Each customer's growth by date, on their own weather and settings.
  const growthByCustomer = customers.map((c) => {
    const { profile, rainFullGrowthIn } = mowSettingsFor(c, settings);
    const days = weatherFor(c).days.filter((d) => d.date <= today);
    return new Map(growthSeries(days, profile, rainFullGrowthIn).map((d) => [d.date, d.growth]));
  });

  const gaps = [];
  const skipped = [];
  for (let i = 1; i < rounds.length; i++) {
    const from = rounds[i - 1];
    const to = rounds[i];
    const days = daysBetween(from, to);
    if (days > MAX_GAP_DAYS) {
      skipped.push({ from, to, days });
      continue;
    }
    // From the day after one round through the day of the next - what Ready
    // to Mow would have shown that morning.
    const totals = growthByCustomer
      .map((growth) => {
        let total = 0;
        for (let n = 1; n <= days; n++) {
          const g = growth.get(addDays(from, n));
          if (g == null) return null;
          total += g;
        }
        return total;
      })
      .filter((t) => t != null);
    if (totals.length) gaps.push({ from, to, days, growth: mean(totals) });
  }

  const recent = gaps.slice(-MAX_GAPS).reverse();
  const oldest = recent.length ? recent[recent.length - 1].from : null;
  const result = {
    suggestion: null,
    gaps: recent,
    skipped: skipped.filter((g) => !oldest || g.to >= oldest).reverse(),
    low: recent.length ? Math.min(...recent.map((g) => g.growth)) : null,
    high: recent.length ? Math.max(...recent.map((g) => g.growth)) : null,
  };
  if (recent.length >= MIN_GAPS) result.suggestion = Math.max(0.5, Math.round(median(recent.map((g) => g.growth)) * 2) / 2);
  return result;
}
