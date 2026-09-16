// Lawn treatment timing based on Growing Degree Days (GDD) - the standard
// method turf professionals use to time preemergent herbicides, since it
// tracks accumulated heat rather than the calendar, adapting to whether the
// season is running warm or cool instead of using the same fixed date every
// year.
//
// GDD50 (base 50°F, no upper cap, accumulated from Jan 1) is the model most
// commonly cited for crabgrass germination timing: crabgrass typically
// starts germinating once GDD50 reaches roughly 300-400, so a preemergent
// needs to go down before that point, once the soil has warmed enough for
// it to activate. Weed & Feed follows the same GDD50 clock, timed later
// once broadleaf weeds are actively growing and temperatures suit a
// combined herbicide/fertilizer product.
//
// Fall fertilizing for cool-season turf (this app's default grass type)
// isn't naturally a GDD-driven decision - GDD keeps climbing all summer
// with no signal for the fall growth flush that makes fall feeding so
// effective. University extension guidance for those is calendar-based
// instead: roughly Labor Day for the early fall feeding, and again about
// six weeks later for a "winterizer" feeding - tracked as two separate
// treatments since they're two separate applications.
//
// The GDD thresholds below are reasonable general-purpose defaults for a
// cool-season lawn - they're editable in Settings on the Weather & Growth
// page, since exact regional timing varies and a local extension office's
// numbers should win over these if they differ.

export const TREATMENT_STATE_BADGE = {
  now: { cls: "badge-active", label: "Apply Now" },
  upcoming: { cls: "badge-inactive", label: "Not Yet" },
  past: { cls: "badge-waiting", label: "Window Passed" },
};

export function dailyGDD(tmaxF, tminF, baseF = 50) {
  return Math.max(0, (tmaxF + tminF) / 2 - baseF);
}

// Accumulates GDD50 across every day given. `days` is expected to already
// start at Jan 1 of the current year (see weatherView.js's FETCH_SINCE), so
// this is a plain sum through whatever the latest day present is.
export function cumulativeGDD(days, baseF = 50) {
  return days.reduce((sum, d) => sum + dailyGDD(d.tmaxF, d.tminF, baseF), 0);
}

function gddWindowStatus(gdd, start, end) {
  if (gdd < start) {
    return {
      state: "upcoming",
      detail: `Not yet - ${(start - gdd).toFixed(0)} GDD to go (${gdd.toFixed(0)} of ${start} GDD50 accumulated).`,
    };
  }
  if (gdd <= end) {
    return {
      state: "now",
      detail: `${gdd.toFixed(0)} GDD50 accumulated - within the ${start}-${end} GDD50 window.`,
    };
  }
  return {
    state: "past",
    detail: `Window has passed (${gdd.toFixed(0)} GDD50 accumulated, window was ${start}-${end}).`,
  };
}

function monthDay(dateStr) {
  return dateStr.slice(5);
}

// Cool-season turf's most important feedings are in fall, not tied to GDD -
// an early-September feed and a mid/late-October "winterizer" feed, per
// standard university extension guidance. Tracked as two separate
// treatments since they're two separate applications, roughly six weeks
// apart.
function fertilizerStatus(todayStr) {
  const md = monthDay(todayStr || "");
  if (md < "09-01") {
    return { state: "upcoming", detail: "Not yet - opens around Labor Day (Sept 1)." };
  }
  if (md <= "09-21") {
    return { state: "now", detail: "Early fall feeding window (Sept 1-21)." };
  }
  return { state: "past", detail: "This year's window has passed - next opens around next Labor Day." };
}

// The winterizer feeding (higher potassium, lower nitrogen) is what really
// sets a cool-season lawn up for winter and next spring's green-up - many
// turf programs treat it as the single most important feeding of the year.
function winterizerStatus(todayStr) {
  const md = monthDay(todayStr || "");
  if (md < "10-01") {
    return { state: "upcoming", detail: "Not yet - opens Oct 1, about six weeks after the early fall feeding." };
  }
  if (md <= "11-15") {
    return { state: "now", detail: "Winterizer window (Oct 1 - Nov 15) - the most important feeding of the year for cool-season turf." };
  }
  return { state: "past", detail: "This year's window has passed - next opens around next October." };
}

// days: [{date, tmaxF, tminF}], starting Jan 1 through today (see
// weatherView.js). settings: {crabgrassGddStart, crabgrassGddEnd,
// weedFeedGddStart, weedFeedGddEnd} (see settings.js DEFAULTS).
export function getTreatmentStatuses(days, settings) {
  const gdd = cumulativeGDD(days);
  const today = days[days.length - 1]?.date;
  return [
    {
      key: "crabgrass",
      label: "Crabgrass Preventer",
      gdd,
      ...gddWindowStatus(gdd, settings.crabgrassGddStart, settings.crabgrassGddEnd),
    },
    {
      key: "weedfeed",
      label: "Weed & Feed",
      gdd,
      ...gddWindowStatus(gdd, settings.weedFeedGddStart, settings.weedFeedGddEnd),
    },
    {
      key: "fertilizer",
      label: "Fertilizer (Early Fall)",
      gdd: null,
      ...fertilizerStatus(today),
    },
    {
      key: "winterizer",
      label: "Winterizing Fertilizer",
      gdd: null,
      ...winterizerStatus(today),
    },
  ];
}
