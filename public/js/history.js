import { byId, escapeHtml, formatDateDisplay, todayStr, confirmAction } from "./utils.js";
import { getCustomers, getCustomerName, populateCustomerSelect } from "./customers.js";
import { getCustomerGroups, getCustomerGroupById, getGroupsForCustomer } from "./customerGroups.js";
import {
  getVisits,
  loadVisits,
  PATTERN_LABELS,
  TIME_OF_DAY_LABELS,
  GRASS_CONDITION_LABELS,
  initVisitForm,
  openVisitForm,
  deleteVisit,
} from "./mowLog.js";
import { getSprays, loadSprays, TARGET_LABELS, initSprayForm, openSprayForm, deleteSpray } from "./sprayLog.js";
import { recordAreaIds, getAreaNames } from "./areas.js";
import { getYardFeatureName } from "./yardFeatures.js";
import { getEquipmentName } from "./equipment.js";
import { getLocationLabel } from "./locations.js";
import { getProductName, getProductById } from "./products.js";
import { openLogEventFor } from "./eventLog.js";
import { countDuplicates, combineDuplicates } from "./duplicates.js";
import { createdMs, mowHistory, nextPattern, patternGlyph } from "./visitDefaults.js";
import { visitCuts, cutNumbers, passCount, multiCutAreaIds, cutLabel } from "./cuts.js";

// History replaces the separate Yard Work and Spray Log pages: every visit
// and spray in one place, browsable five ways (Days, Groups, Calendar,
// Customer, Last Sprayed). Yard work visits and sprays stay in their own
// collections; they're only merged here, for display, into "entries".

const VIEWS = ["days", "groups", "calendar", "customer", "sprays"];
const VIEW_STORAGE_KEY = "historyView";
const DAYS_PER_PAGE = 30;
const CUSTOMER_ENTRY_LIMIT = 30;

// Which filter controls each view actually uses - the rest are hidden
// rather than left on screen doing nothing.
const VIEW_CONTROLS = {
  days: { type: true, group: true, customer: true, range: true, target: false },
  groups: { type: true, group: true, customer: false, range: true, target: false },
  calendar: { type: true, group: true, customer: true, range: false, target: false },
  customer: { type: true, group: false, customer: false, range: false, target: false },
  sprays: { type: false, group: true, customer: false, range: false, target: true },
};

const YARD_FLAGS = { mowed: "Mowed", trimmed: "Trimmed", edged: "Edged" };
const EXTRA_FLAGS = { pruned: "Pruned", trimmedBushes: "Trimmed Bushes", mulched: "Mulched" };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SPRAY_DUE_PHRASES = {
  any: "spray",
  weeds: "weed spray",
  insects: "insect spray",
  fungus: "fungus / disease spray",
  fertilizer: "fertilizer application",
  other: "other spray",
};

const state = {
  view: "days",
  type: "all",
  subject: "customer",
  expanded: new Set(),
  dayLimit: DAYS_PER_PAGE,
  calendarMonth: todayStr().slice(0, 7),
  calendarDay: todayStr(),
  combineMessage: "",
};
let listenersBound = false;

// ---------- dates ----------

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

function dayHeading(dateStr) {
  return `${WEEKDAYS[new Date(utcMs(dateStr)).getUTCDay()]} ${formatDateDisplay(dateStr)}`;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// ---------- entries ----------

function flagsDone(record, flags) {
  return Object.keys(flags)
    .filter((f) => record[f])
    .map((f) => flags[f]);
}

// A visit record can hold yard work, extra yard work, or (for records saved
// from the Edit Visit form) both - so it can count as either type.
function entryKinds(entry) {
  if (entry.source === "spray") return ["spray"];
  const kinds = [];
  if (flagsDone(entry.record, YARD_FLAGS).length) kinds.push("yard");
  if (flagsDone(entry.record, EXTRA_FLAGS).length) kinds.push("extra");
  return kinds;
}

function allEntries() {
  return [
    ...getVisits().map((record) => ({ source: "visit", record })),
    ...getSprays().map((record) => ({ source: "spray", record })),
  ].map((e) => ({ ...e, customerId: e.record.customerId, date: e.record.date, created: createdMs(e.record) }));
}

function isMultiCut(entry) {
  return entry.source === "visit" && passCount(entry.record) >= 2;
}

function matchesType(entry) {
  if (state.type === "multi") return isMultiCut(entry);
  return state.type === "all" || entryKinds(entry).includes(state.type);
}

// "Front Yard · Parallel · Toro TimeMaster · 3.5" · speed 2 · High"
function cutSummaryText(c, { withMower = true } = {}) {
  return [
    getAreaNames(c.areaIds || []),
    patternLabel(c.pattern),
    withMower ? getEquipmentName(c.equipmentId) : "",
    c.deckHeight != null ? `${c.deckHeight}"` : "",
    c.groundSpeed ? `speed ${c.groundSpeed}` : "",
    c.bladeSpeed || "",
  ]
    .filter(Boolean)
    .join(" · ");
}

// Yard work first, then extra, then sprays - the order they read on a card.
function sectionRank(entry) {
  if (entry.source === "spray") return 2;
  return entryKinds(entry).includes("yard") ? 0 : 1;
}

function sortSections(entries) {
  return [...entries].sort((a, b) => sectionRank(a) - sectionRank(b) || a.created - b.created);
}

// ---------- filters ----------

function selectedGroup() {
  return getCustomerGroupById(byId("history-filter-group").value) || null;
}

function rangeStart() {
  const value = byId("history-filter-range").value;
  const today = todayStr();
  if (value === "all") return null;
  if (value === "year") return `${today.slice(0, 4)}-01-01`;
  return addDays(today, -(Number(value) - 1));
}

function filteredEntries() {
  const controls = VIEW_CONTROLS[state.view];
  const group = controls.group ? selectedGroup() : null;
  const groupIds = group ? new Set(group.customerIds || []) : null;
  const customerId = controls.customer ? byId("history-filter-customer").value : "";
  const start = controls.range ? rangeStart() : null;
  return allEntries().filter(
    (e) =>
      matchesType(e) &&
      (!groupIds || groupIds.has(e.customerId)) &&
      (!customerId || e.customerId === customerId) &&
      (!start || e.date >= start)
  );
}

function groupByDate(entries) {
  const byDate = new Map();
  for (const e of entries) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }
  return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
}

// One bucket per customer for a single day, in the order they were logged
// that day - which is usually the order they were actually done in.
function entriesByCustomer(dayEntries) {
  const byCustomer = new Map();
  for (const e of [...dayEntries].sort((a, b) => a.created - b.created)) {
    if (!byCustomer.has(e.customerId)) byCustomer.set(e.customerId, []);
    byCustomer.get(e.customerId).push(e);
  }
  return byCustomer;
}

// ---------- small pieces ----------

function patternLabel(pattern) {
  return PATTERN_LABELS[pattern] || pattern || "";
}

function patternBadge(pattern) {
  return `<span class="pattern-label">${patternGlyph(pattern)}${escapeHtml(patternLabel(pattern))}</span>`;
}

const CHEVRONS = { down: "M6 9l6 6 6-6", up: "M18 15l-6-6-6 6", left: "M15 6l-6 6 6 6", right: "M9 6l6 6-6 6" };

function chevron(direction) {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${CHEVRONS[direction]}"></path></svg>`;
}

function chip(label, kind) {
  return `<span class="chip chip-${kind}">${escapeHtml(label)}</span>`;
}

function marker(kind) {
  return `<span class="marker marker-${kind}" aria-hidden="true"></span>`;
}

function detailItem(label, value) {
  return value ? `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>` : "";
}

function sprayProductText(spray) {
  const product = getProductName(spray.productId) || spray.product || "Product";
  if (!spray.quantityUsed) return product;
  const unit = getProductById(spray.productId)?.unit || "";
  return `${product} · ${spray.quantityUsed}${unit ? ` ${unit}` : ""}`;
}

function toggleButton(key, expanded) {
  return `<button type="button" class="icon-btn" data-toggle-card="${escapeHtml(key)}" aria-expanded="${expanded}" aria-label="${expanded ? "Hide" : "Show"} details">${chevron(expanded ? "up" : "down")}</button>`;
}

// ---------- record sections (shared by Days, Groups and Calendar) ----------

function visitDetails(v) {
  const cuts = visitCuts(v);
  const multi = cuts.length > 1;
  // With more than one cut, each cut's areas and settings are listed below
  // instead of one set - and its mower too, when the cuts used different ones.
  const oneMower = new Set(cuts.map((c) => c.equipmentId)).size <= 1;
  const items = [
    multi && !oneMower ? "" : detailItem(v.mowed ? "Mower" : "Equipment", getEquipmentName(v.equipmentId)),
    multi ? "" : detailItem("Deck height", v.deckHeight != null ? `${v.deckHeight}"` : ""),
    multi ? "" : detailItem("Ground speed", v.groundSpeed),
    multi ? "" : detailItem("Blade speed", v.bladeSpeed),
    detailItem("Grass", GRASS_CONDITION_LABELS[v.grassCondition]),
    detailItem("Time of day", TIME_OF_DAY_LABELS[v.timeOfDay]),
    detailItem("Location", getLocationLabel(v.locationId)),
  ].join("");
  // Numbered per area: the front yard's second cut is its cut 2 even if the
  // back yard was cut in between.
  const numbers = cutNumbers(cuts);
  const cutList = multi
    ? `<ol class="cut-detail-list">${cuts
        .map((c, i) => `<li><span class="cut-detail-label">Cut ${numbers[i]}</span><span>${escapeHtml(cutSummaryText(c, { withMower: !oneMower }))}</span></li>`)
        .join("")}</ol>`
    : "";
  return `
    ${items ? `<dl class="record-details">${items}</dl>` : ""}
    ${cutList}
    ${v.notes ? `<p class="record-notes">${escapeHtml(v.notes)}</p>` : ""}
    <div class="record-actions">
      <button type="button" class="ghost-btn" data-edit-visit="${escapeHtml(v.id)}">Edit</button>
      <button type="button" class="danger-btn" data-delete-visit="${escapeHtml(v.id)}">Delete</button>
    </div>`;
}

function renderVisitSection(v, expanded) {
  const yard = flagsDone(v, YARD_FLAGS);
  const extra = flagsDone(v, EXTRA_FLAGS);
  const areas = escapeHtml(getAreaNames(recordAreaIds(v)));
  const feature = escapeHtml(getYardFeatureName(v.featureId) || "");
  const rows = [];
  if (yard.length) {
    const cuts = visitCuts(v);
    const multi = cuts.length > 1;
    // "Double cut", or "Double cut: Front Yard" when only part of the lawn
    // was cut twice.
    const passes = passCount(v);
    const doubledAreas = multiCutAreaIds(v);
    const partial = doubledAreas.length && doubledAreas.length < recordAreaIds(v).length;
    const cutChip = passes > 1 ? chip(`${cutLabel(passes)}${partial ? `: ${getAreaNames(doubledAreas)}` : ""}`, "cut") : "";
    rows.push(`<div class="chip-row">${yard.map((l) => chip(l, "yard")).join("")}${cutChip}</div>`);
    // More than one cut shows each cut's pattern in order - with its areas
    // when the cuts covered different parts of the lawn.
    const areasDiffer = new Set(cuts.map((c) => [...(c.areaIds || [])].sort().join())).size > 1;
    const patterns = multi
      ? cuts
          .map((c) => `${patternBadge(c.pattern)}${areasDiffer && c.areaIds?.length ? `<span class="cut-area-tag">${escapeHtml(getAreaNames(c.areaIds))}</span>` : ""}`)
          .join('<span aria-hidden="true">→</span>')
      : v.mowed && v.pattern
      ? patternBadge(v.pattern)
      : "";
    const meta = [patterns, areas].filter(Boolean);
    if (meta.length) rows.push(`<div class="record-meta">${meta.join('<span aria-hidden="true">·</span>')}</div>`);
  }
  if (extra.length) {
    const where = [yard.length ? "" : areas, feature].filter(Boolean).join(" · ");
    rows.push(
      `<div class="chip-row">${extra.map((l) => chip(l, "extra")).join("")}${where ? `<span class="record-meta">${where}</span>` : ""}</div>`
    );
  }
  if (!yard.length && !extra.length) rows.push(`<div class="record-meta">Visit${areas ? ` · ${areas}` : ""}</div>`);
  if (expanded) rows.push(visitDetails(v));
  return `<div class="record-section">${rows.join("")}</div>`;
}

function sprayDetails(s) {
  const items = [
    detailItem("Equipment", getEquipmentName(s.equipmentId)),
    detailItem("Time of day", TIME_OF_DAY_LABELS[s.timeOfDay]),
    detailItem("Location", getLocationLabel(s.locationId)),
    detailItem("Plant / object", getYardFeatureName(s.featureId)),
  ].join("");
  return `
    ${items ? `<dl class="record-details">${items}</dl>` : ""}
    ${s.notes ? `<p class="record-notes">${escapeHtml(s.notes)}</p>` : ""}
    <div class="record-actions">
      <button type="button" class="ghost-btn" data-edit-spray="${escapeHtml(s.id)}">Edit</button>
      <button type="button" class="danger-btn" data-delete-spray="${escapeHtml(s.id)}">Delete</button>
    </div>`;
}

function renderSpraySection(s, expanded) {
  const areas = getAreaNames(recordAreaIds(s));
  const rows = [
    `<div class="chip-row">${chip(TARGET_LABELS[s.target] || s.target || "Spray", "spray")}<span class="record-product">${escapeHtml(sprayProductText(s))}</span></div>`,
  ];
  if (areas) rows.push(`<div class="record-meta">${escapeHtml(areas)}</div>`);
  if (expanded) rows.push(sprayDetails(s));
  return `<div class="record-section">${rows.join("")}</div>`;
}

function renderSections(entries, expanded) {
  return sortSections(entries)
    .map((e) => (e.source === "spray" ? renderSpraySection(e.record, expanded) : renderVisitSection(e.record, expanded)))
    .join("");
}

// One-line summaries (Groups rows, Customer list) - each carries its type's
// marker shape so yard work, extra work and sprays read apart at a glance.
function summaryLines(entry) {
  const r = entry.record;
  if (entry.source === "spray") {
    const target = TARGET_LABELS[r.target] || r.target || "Spray";
    return [`<span class="summary-line">${marker("spray")}${escapeHtml(`${sprayProductText(r)} · ${target}`)}</span>`];
  }
  const areas = getAreaNames(recordAreaIds(r));
  const lines = [];
  const yard = flagsDone(r, YARD_FLAGS);
  const extra = flagsDone(r, EXTRA_FLAGS);
  if (yard.length) {
    const n = passCount(r);
    const tasks = yard.map((t) => (t === "Mowed" && n > 1 ? `Mowed (${cutLabel(n).toLowerCase()})` : t)).join(", ");
    lines.push(`<span class="summary-line">${marker("yard")}${escapeHtml([tasks, areas].filter(Boolean).join(" · "))}</span>`);
  }
  if (extra.length) {
    const where = [yard.length ? "" : areas, getYardFeatureName(r.featureId)].filter(Boolean).join(" · ");
    lines.push(`<span class="summary-line">${marker("extra")}${escapeHtml([extra.join(", "), where].filter(Boolean).join(" · "))}</span>`);
  }
  if (!lines.length) lines.push(`<span class="summary-line">Visit</span>`);
  return lines;
}

function renderCustomerCard(date, customerId, entries) {
  const key = `${date}|${customerId}`;
  const expanded = state.expanded.has(key);
  return `
    <article class="visit-card">
      <div class="visit-card-head">
        <h4>${escapeHtml(getCustomerName(customerId) || "Unknown customer")}</h4>
        ${toggleButton(key, expanded)}
      </div>
      ${renderSections(entries, expanded)}
    </article>`;
}

function dayHeader(date, count) {
  return `<div class="day-heading"><h3>${dayHeading(date)}</h3><span class="hint-text">${plural(count, "visit")}</span></div>`;
}

function showMoreButton(totalDays) {
  return totalDays > state.dayLimit
    ? `<button type="button" class="ghost-btn show-more-btn" data-show-more="1">Show more days</button>`
    : "";
}

const EMPTY_FILTER_MESSAGE = `<p class="hint-text">Nothing logged for these filters.</p>`;

// ---------- Days ----------

// With the Multi-cut filter on: how many double and triple cuts are in view.
function multiCutSummary(entries) {
  if (state.type !== "multi" || !entries.length) return "";
  const counts = entries.map((e) => passCount(e.record));
  const doubles = counts.filter((n) => n === 2).length;
  const triples = counts.filter((n) => n >= 3).length;
  const parts = [doubles ? plural(doubles, "double cut") : "", triples ? plural(triples, "triple cut") : ""].filter(Boolean);
  return `<p class="results-summary"><strong>${plural(entries.length, "multi-cut mow")}</strong> · ${parts.join(", ")}</p>`;
}

function renderDaysView() {
  const container = byId("history-panel-days");
  const entries = filteredEntries();
  const days = groupByDate(entries);
  if (!days.length) {
    container.innerHTML = EMPTY_FILTER_MESSAGE;
    return;
  }
  container.innerHTML =
    multiCutSummary(entries) +
    days
      .slice(0, state.dayLimit)
      .map(([date, dayEntries]) => {
        const byCustomer = entriesByCustomer(dayEntries);
        return `
        <section class="day-section">
          ${dayHeader(date, byCustomer.size)}
          <div class="card-grid">${[...byCustomer].map(([cid, es]) => renderCustomerCard(date, cid, es)).join("")}</div>
        </section>`;
      })
      .join("") + showMoreButton(days.length);
}

// ---------- Groups ----------

function renderGroupRow(date, customerId, entries) {
  const key = `${date}|${customerId}`;
  const expanded = state.expanded.has(key);
  return `
    <div class="group-row">
      <div class="group-row-main">
        <div class="group-row-text">
          <span class="group-row-name">${escapeHtml(getCustomerName(customerId) || "Unknown customer")}</span>
          ${expanded ? "" : sortSections(entries).flatMap(summaryLines).join("")}
        </div>
        ${toggleButton(key, expanded)}
      </div>
      ${expanded ? `<div class="group-row-details">${renderSections(entries, true)}</div>` : ""}
    </div>`;
}

function renderMissingRow(date, customerId) {
  return `
    <div class="group-row missing">
      <div class="group-row-main">
        <div class="group-row-text">
          <span class="group-row-name">${escapeHtml(getCustomerName(customerId))}</span>
          <span class="summary-line">Not logged this day</span>
        </div>
        <button type="button" class="ghost-btn" data-log-visit="${escapeHtml(customerId)}" data-log-date="${date}">Log visit</button>
      </div>
    </div>`;
}

// A group's header shows the pattern from its latest mow that day, since the
// neighbors are mowed together, plus how many of them got done.
function renderGroupBlock(date, name, memberIds, byCustomer, isGroup) {
  const done = memberIds.filter((id) => byCustomer.has(id));
  const lastMow = done
    .flatMap((id) => byCustomer.get(id))
    .filter((e) => e.source === "visit" && e.record.mowed && e.record.pattern)
    .sort((a, b) => b.created - a.created)[0];
  const badge = isGroup
    ? `<span class="badge ${done.length === memberIds.length ? "badge-active" : "badge-inactive"}">${done.length} of ${memberIds.length} done</span>`
    : "";
  const rows = memberIds
    .map((id) => (byCustomer.has(id) ? renderGroupRow(date, id, byCustomer.get(id)) : renderMissingRow(date, id)))
    .join("");
  return `
    <article class="group-block">
      <div class="group-block-head">
        <div class="group-block-title">
          <h4 class="${isGroup ? "" : "muted"}">${escapeHtml(name)}</h4>
          ${lastMow ? patternBadge(lastMow.record.pattern) : ""}
        </div>
        ${badge}
      </div>
      ${rows}
    </article>`;
}

function renderGroupsView() {
  const container = byId("history-panel-groups");
  const days = groupByDate(filteredEntries());
  if (!days.length) {
    container.innerHTML = EMPTY_FILTER_MESSAGE;
    return;
  }
  const filterGroup = selectedGroup();
  const groups = filterGroup ? [filterGroup] : getCustomerGroups();
  const existingIds = new Set(getCustomers().map((c) => c.id));

  container.innerHTML =
    days
      .slice(0, state.dayLimit)
      .map(([date, dayEntries]) => {
        const byCustomer = entriesByCustomer(dayEntries);
        const blocks = [];
        for (const g of groups) {
          const members = (g.customerIds || []).filter((id) => existingIds.has(id));
          if (members.some((id) => byCustomer.has(id))) blocks.push(renderGroupBlock(date, g.name, members, byCustomer, true));
        }
        if (!filterGroup) {
          const ungrouped = [...byCustomer.keys()].filter((id) => !getGroupsForCustomer(id).length);
          if (ungrouped.length) blocks.push(renderGroupBlock(date, "Ungrouped", ungrouped, byCustomer, false));
        }
        return `
        <section class="day-section">
          ${dayHeader(date, byCustomer.size)}
          <div class="card-grid">${blocks.join("")}</div>
        </section>`;
      })
      .join("") + showMoreButton(days.length);
}

// ---------- Calendar ----------

function renderCalendarView() {
  const container = byId("history-panel-calendar");
  const month = state.calendarMonth;
  const [year, monthNum] = month.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(year, monthNum - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  const today = todayStr();

  const entries = filteredEntries().filter((e) => e.date.startsWith(`${month}-`));
  const countsByDate = new Map();
  for (const e of entries) {
    if (!countsByDate.has(e.date)) countsByDate.set(e.date, { yard: 0, extra: 0, spray: 0 });
    const counts = countsByDate.get(e.date);
    for (const kind of entryKinds(e)) counts[kind]++;
  }

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(`<div class="calendar-blank"></div>`);
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const counts = countsByDate.get(date) || { yard: 0, extra: 0, spray: 0 };
    const parts = [];
    if (counts.yard) parts.push(`${counts.yard} yard work`);
    if (counts.extra) parts.push(`${counts.extra} extra yard work`);
    if (counts.spray) parts.push(plural(counts.spray, "spray"));
    const label = `${MONTHS[monthNum - 1]} ${day}: ${parts.length ? parts.join(", ") : "nothing logged"}`;
    const selected = date === state.calendarDay;
    cells.push(`
      <button type="button" class="calendar-day${selected ? " selected" : ""}${date === today ? " today" : ""}" data-calendar-day="${date}" aria-pressed="${selected}" aria-label="${label}">
        <span class="calendar-day-num">${day}</span>
        <span class="calendar-markers">${counts.yard ? marker("yard") : ""}${counts.extra ? marker("extra") : ""}${counts.spray ? marker("spray") : ""}</span>
      </button>`);
  }

  let dayPanel = `<p class="hint-text">Pick a day to see what was logged.</p>`;
  if (state.calendarDay?.startsWith(`${month}-`)) {
    const dayEntries = entries.filter((e) => e.date === state.calendarDay);
    if (dayEntries.length) {
      const byCustomer = entriesByCustomer(dayEntries);
      dayPanel = `
        ${dayHeader(state.calendarDay, byCustomer.size)}
        <div class="card-grid">${[...byCustomer].map(([cid, es]) => renderCustomerCard(state.calendarDay, cid, es)).join("")}</div>`;
    } else {
      dayPanel = `<p class="hint-text">Nothing logged on ${dayHeading(state.calendarDay)}.</p>`;
    }
  }

  container.innerHTML = `
    <div class="calendar-head">
      <button type="button" class="icon-btn bordered" data-calendar-nav="-1" aria-label="Previous month">${chevron("left")}</button>
      <h3>${MONTHS[monthNum - 1]} ${year}</h3>
      <button type="button" class="icon-btn bordered" data-calendar-nav="1" aria-label="Next month">${chevron("right")}</button>
    </div>
    <div class="calendar-legend">
      <span>${marker("yard")}Yard work</span>
      <span>${marker("extra")}Extra yard work</span>
      <span>${marker("spray")}Spray</span>
    </div>
    <div class="calendar-weekdays" aria-hidden="true">${WEEKDAYS.map((d) => `<span>${d}</span>`).join("")}</div>
    <div class="calendar-grid">${cells.join("")}</div>
    <section class="day-section calendar-day-panel">${dayPanel}</section>`;
}

function shiftCalendarMonth(delta) {
  const [year, monthNum] = state.calendarMonth.split("-").map(Number);
  const d = new Date(Date.UTC(year, monthNum - 1 + delta, 1));
  state.calendarMonth = d.toISOString().slice(0, 7);
}

// ---------- Customer ----------

function populateSubjectSelect() {
  const select = byId("history-subject");
  const current = select.value;
  const options = state.subject === "group" ? getCustomerGroups() : getCustomers();
  select.innerHTML = options.map((o) => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.name)}</option>`).join("");
  if (options.some((o) => o.id === current)) select.value = current;
  byId("history-subject-label").textContent = state.subject === "group" ? "Group" : "Customer";
  document.querySelectorAll("[data-subject]").forEach((btn) => {
    const active = btn.dataset.subject === state.subject;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
}

function tile(label, value, sub, accent = false) {
  return `
    <div class="tile">
      <span class="tile-label">${label}</span>
      <span class="tile-value${accent ? " accent" : ""}">${escapeHtml(value)}</span>
      <span class="tile-sub">${escapeHtml(sub)}</span>
    </div>`;
}

function renderCustomerView() {
  populateSubjectSelect();
  const body = byId("history-customer-body");
  const subjectId = byId("history-subject").value;
  if (!subjectId) {
    body.innerHTML = `<p class="hint-text">${
      state.subject === "group" ? "No customer groups yet - create one in Settings → Customer Groups." : "Add a customer first."
    }</p>`;
    return;
  }
  const isGroup = state.subject === "group";
  const ids = new Set(isGroup ? getCustomerGroupById(subjectId)?.customerIds || [] : [subjectId]);
  const mows = mowHistory(ids);
  const last = mows[0] || null;
  const next = last ? nextPattern(last.pattern) : null;
  const recent = mows.slice(0, 6);
  const today = todayStr();

  const sinceDays = last ? daysBetween(last.date, today) : null;
  // Counted per mow day, like the rotation: a group mowed together is one mow.
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const mowsThisYear = mows.filter((v) => v.date >= yearStart);
  const multiThisYear = mowsThisYear.filter((v) => passCount(v) >= 2);
  const avgGap = recent.length >= 2 ? Math.round(daysBetween(recent[recent.length - 1].date, recent[0].date) / (recent.length - 1)) : null;
  const tiles = [
    tile("Last pattern", last ? patternLabel(last.pattern) : "–", last ? dayHeading(last.date) : "No mow recorded yet", true),
    tile(
      "Next in rotation",
      next ? patternLabel(next) : "–",
      next ? `Follows ${patternLabel(last.pattern)}` : last ? "Last pattern was Other" : "Log a mow first",
      true
    ),
    tile("Since last mow", last ? (sinceDays <= 0 ? "Today" : plural(sinceDays, "day")) : "–", last ? `Mowed ${dayHeading(last.date)}` : ""),
    tile("Typical gap", avgGap != null ? plural(avgGap, "day") : "–", avgGap != null ? `Average of last ${recent.length} mows` : "Needs 2+ mows"),
    tile("Mows this year", String(mowsThisYear.length), `Since Jan 1, ${yearStart.slice(0, 4)}`),
    tile(
      "Double/triple cuts",
      String(multiThisYear.length),
      multiThisYear.length
        ? `${multiThisYear.filter((v) => passCount(v) === 2).length} double · ${multiThisYear.filter((v) => passCount(v) >= 3).length} triple this year`
        : "None this year"
    ),
  ].join("");

  const strip = recent.length
    ? `
    <section class="card rotation-card">
      <div class="day-heading"><h3>Pattern rotation</h3><span class="hint-text">Last ${plural(recent.length, "mow")}${next ? ", then next" : ""}</span></div>
      <ol class="rotation-strip">
        ${[...recent]
          .reverse()
          .map(
            (v, i, arr) => `
          <li class="rotation-item${i === arr.length - 1 ? " latest" : ""}">
            ${patternGlyph(v.pattern, 36).replace('aria-hidden="true"', `role="img" aria-label="${escapeHtml(patternLabel(v.pattern))} on ${formatDateDisplay(v.date)}"`)}
            <span class="rotation-date">${formatDateDisplay(v.date).slice(0, 5)}</span>
          </li>`
          )
          .join("")}
        ${
          next
            ? `<li class="rotation-item next">${patternGlyph(next, 36).replace('aria-hidden="true"', `role="img" aria-label="Next: ${escapeHtml(patternLabel(next))}"`)}<span class="rotation-date">Next</span></li>`
            : ""
        }
      </ol>
    </section>`
    : "";

  const entries = allEntries()
    .filter((e) => ids.has(e.customerId) && matchesType(e))
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : b.created - a.created));
  const rows = entries
    .slice(0, CUSTOMER_ENTRY_LIMIT)
    .map((e) => {
      const r = e.record;
      return `
      <div class="entry-row">
        <span class="entry-date">${formatDateDisplay(e.date)}</span>
        <span class="entry-text">
          ${isGroup ? `<span class="group-row-name">${escapeHtml(getCustomerName(e.customerId))}</span>` : ""}
          ${summaryLines(e).join("")}
        </span>
        <span class="entry-pattern">${e.source === "visit" && r.mowed && r.pattern ? patternBadge(r.pattern) : ""}</span>
      </div>`;
    })
    .join("");

  body.innerHTML = `
    <div class="tile-grid">${tiles}</div>
    ${strip}
    <section class="card entry-card">
      <h3>Visits</h3>
      ${rows || `<p class="hint-text">Nothing logged yet.</p>`}
      ${entries.length > CUSTOMER_ENTRY_LIMIT ? `<p class="hint-text">Showing the latest ${CUSTOMER_ENTRY_LIMIT} of ${entries.length}.</p>` : ""}
    </section>`;
}

// ---------- Last Sprayed ----------

function renderSpraysView() {
  const container = byId("history-panel-sprays");
  const target = byId("history-filter-target").value;
  const group = selectedGroup();
  const customers = getCustomers().filter((c) => !group || (group.customerIds || []).includes(c.id));
  const today = todayStr();
  const phrase = SPRAY_DUE_PHRASES[target] || "spray";

  const rows = customers
    .map((customer) => {
      const last = getSprays()
        .filter((s) => s.customerId === customer.id && (target === "any" || s.target === target))
        .reduce((best, s) => (!best || s.date > best.date || (s.date === best.date && createdMs(s) > createdMs(best)) ? s : best), null);
      return { customer, last, days: last ? daysBetween(last.date, today) : null };
    })
    .sort((a, b) => {
      if (a.last && b.last) return b.days - a.days || a.customer.name.localeCompare(b.customer.name);
      if (a.last || b.last) return a.last ? -1 : 1;
      return a.customer.name.localeCompare(b.customer.name);
    });

  if (!rows.length) {
    container.innerHTML = `<p class="hint-text">No customers in this group.</p>`;
    return;
  }

  container.innerHTML = `
    <p class="hint-text">Longest since the last ${phrase} first.</p>
    <div class="due-list">
      ${rows
        .map(({ customer, last, days }) => {
          const detail = last
            ? `${sprayProductText(last)}${target === "any" ? ` (${TARGET_LABELS[last.target] || last.target})` : ""} · ${formatDateDisplay(last.date)}`
            : `No ${phrase} logged`;
          const since = !last
            ? `<span class="due-number muted">–</span>`
            : days <= 0
            ? `<span class="due-today">Today</span>`
            : `<span class="due-number">${days}</span><span class="due-unit">${days === 1 ? "day" : "days"} ago</span>`;
          return `
          <div class="due-row">
            <div class="due-text">
              <span class="group-row-name">${escapeHtml(customer.name)}</span>
              <span class="hint-text">${escapeHtml(detail)}</span>
            </div>
            <div class="due-days">${since}</div>
          </div>`;
        })
        .join("")}
    </div>`;
}

// ---------- page ----------

function populateFilterSelects() {
  const groupSelect = byId("history-filter-group");
  const current = groupSelect.value;
  groupSelect.innerHTML =
    `<option value="">All groups</option>` +
    getCustomerGroups()
      .map((g) => `<option value="${escapeHtml(g.id)}">${escapeHtml(g.name)}</option>`)
      .join("");
  if (getCustomerGroupById(current)) groupSelect.value = current;
  populateCustomerSelect(byId("history-filter-customer"), { includeAll: true });
}

function applyControlVisibility() {
  const controls = VIEW_CONTROLS[state.view];
  byId("history-type-tabs").classList.toggle("hidden", !controls.type);
  byId("history-group-field").classList.toggle("hidden", !controls.group);
  byId("history-customer-field").classList.toggle("hidden", !controls.customer);
  byId("history-range-field").classList.toggle("hidden", !controls.range);
  byId("history-target-field").classList.toggle("hidden", !controls.target);
  byId("history-filters").classList.toggle("hidden", !(controls.group || controls.customer || controls.range || controls.target));
  for (const view of VIEWS) byId(`history-panel-${view}`).classList.toggle("hidden", view !== state.view);
  document.querySelectorAll("[data-history-view]").forEach((btn) => {
    const active = btn.dataset.historyView === state.view;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-history-type]").forEach((btn) => {
    const active = btn.dataset.historyType === state.type;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
}

const RENDERERS = {
  days: renderDaysView,
  groups: renderGroupsView,
  calendar: renderCalendarView,
  customer: renderCustomerView,
  sprays: renderSpraysView,
};

// Shown only while old one-record-per-area duplicates exist (and once more
// right after combining, to confirm what happened).
function renderDuplicateNotice() {
  const container = byId("history-duplicates");
  const { sets, records } = countDuplicates();
  if (!sets) {
    container.innerHTML = state.combineMessage ? `<p class="notice-done">${escapeHtml(state.combineMessage)}</p>` : "";
    return;
  }
  container.innerHTML = `
    <div class="card notice-card">
      <div class="notice-text">
        <strong>Old duplicate records</strong>
        <span class="hint-text">Before the fix, each area was saved as its own record, so some visits show up more than once. ${records} records can be combined into ${sets}, keeping all of their areas.</span>
      </div>
      <button type="button" class="primary-btn" id="combine-duplicates-btn">Combine duplicates</button>
    </div>`;
}

async function handleCombineDuplicates() {
  const { sets, records } = countDuplicates();
  if (!sets) return;
  const ok = await confirmAction(
    `Combine ${records} duplicate records into ${sets}? Each combined record keeps every area from its copies. This can't be undone.`,
    { confirmLabel: "Combine", danger: false }
  );
  if (!ok) return;
  const btn = byId("combine-duplicates-btn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Combining…";
  }
  try {
    const result = await combineDuplicates();
    state.combineMessage = `Combined ${result.records} records into ${result.sets}.`;
  } catch (err) {
    console.error("Failed to combine duplicate records", err);
    state.combineMessage = "";
    alert("Couldn't combine the duplicates. Nothing was changed for any record that failed - try again.");
  }
  render();
}

function render() {
  applyControlVisibility();
  renderDuplicateNotice();
  RENDERERS[state.view]();
}

function setView(view) {
  state.view = view;
  state.combineMessage = "";
  state.dayLimit = DAYS_PER_PAGE;
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // Storage can be unavailable (private browsing) - the view just won't be remembered.
  }
  render();
}

// Opens History from elsewhere in the app (e.g. "Edit" on a Dashboard
// confirmation) on a particular view.
export function showHistory(view = "days") {
  if (VIEWS.includes(view)) {
    state.view = view;
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      // Not remembered for next time - state.view still applies now.
    }
  }
  document.dispatchEvent(new CustomEvent("app:navigate", { detail: { view: "history" } }));
}

function logVisitFor(customerId, date) {
  document.dispatchEvent(new CustomEvent("app:navigate", { detail: { view: "dashboard" } }));
  openLogEventFor({ customerIds: [customerId], date });
}

async function handleClick(e) {
  const btn = e.target.closest("button");
  if (!btn) return;
  const d = btn.dataset;
  if (d.toggleCard) {
    if (state.expanded.has(d.toggleCard)) state.expanded.delete(d.toggleCard);
    else state.expanded.add(d.toggleCard);
    render();
    document.querySelector(`[data-toggle-card="${CSS.escape(d.toggleCard)}"]`)?.focus();
  } else if (d.editVisit) {
    openVisitForm(getVisits().find((v) => v.id === d.editVisit));
  } else if (d.deleteVisit) {
    await deleteVisit(d.deleteVisit);
  } else if (d.editSpray) {
    openSprayForm(getSprays().find((s) => s.id === d.editSpray));
  } else if (d.deleteSpray) {
    await deleteSpray(d.deleteSpray);
  } else if (d.showMore) {
    state.dayLimit += DAYS_PER_PAGE;
    render();
  } else if (d.logVisit) {
    logVisitFor(d.logVisit, d.logDate);
  } else if (d.calendarDay) {
    state.calendarDay = d.calendarDay;
    render();
  } else if (d.calendarNav) {
    shiftCalendarMonth(Number(d.calendarNav));
    render();
  }
}

export async function refreshHistoryView() {
  await Promise.allSettled([loadVisits(), loadSprays()]);
  populateFilterSelects();
  render();
}

export function initHistoryView() {
  if (!listenersBound) {
    try {
      const saved = localStorage.getItem(VIEW_STORAGE_KEY);
      if (VIEWS.includes(saved)) state.view = saved;
    } catch {
      // Fall back to the default view.
    }
    document.querySelectorAll("[data-history-view]").forEach((btn) => btn.addEventListener("click", () => setView(btn.dataset.historyView)));
    document.querySelectorAll("[data-history-type]").forEach((btn) =>
      btn.addEventListener("click", () => {
        state.type = btn.dataset.historyType;
        render();
      })
    );
    document.querySelectorAll("[data-subject]").forEach((btn) =>
      btn.addEventListener("click", () => {
        state.subject = btn.dataset.subject;
        render();
      })
    );
    for (const id of ["history-filter-group", "history-filter-customer", "history-filter-range", "history-filter-target"]) {
      byId(id).addEventListener("change", () => {
        state.dayLimit = DAYS_PER_PAGE;
        render();
      });
    }
    byId("history-subject").addEventListener("change", render);
    byId("history-results").addEventListener("click", handleClick);
    byId("history-duplicates").addEventListener("click", (e) => {
      if (e.target.closest("#combine-duplicates-btn")) handleCombineDuplicates();
    });
    document.addEventListener("records:changed", render);
    document.addEventListener("event:logged", render);
    document.addEventListener("customers:changed", () => {
      populateFilterSelects();
      render();
    });
    document.addEventListener("customerGroups:changed", () => {
      populateFilterSelects();
      render();
    });
    initVisitForm();
    initSprayForm();
    listenersBound = true;
  }
  return refreshHistoryView();
}
