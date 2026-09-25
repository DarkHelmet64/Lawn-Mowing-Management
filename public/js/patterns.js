// Mow patterns: labels, the rotation order, and the small stripe icons. No
// imports, so any module (including the visit and cut code) can use it
// without creating an import cycle.

export const PATTERN_LABELS = {
  parallel: "Parallel",
  perpendicular: "Perpendicular",
  diagonal_left: "Diagonal Left",
  diagonal_right: "Diagonal Right",
  other: "Other",
};

export const PATTERN_ROTATION = ["parallel", "perpendicular", "diagonal_left", "diagonal_right"];

// The pattern `steps` places further along the rotation. null for "other"
// (or an unknown value): there's no rotation to continue.
export function rotatePattern(pattern, steps = 1) {
  const i = PATTERN_ROTATION.indexOf(pattern);
  if (i === -1) return null;
  const n = PATTERN_ROTATION.length;
  return PATTERN_ROTATION[(((i + steps) % n) + n) % n];
}

export function nextPattern(pattern) {
  return rotatePattern(pattern, 1);
}

const PATTERN_STRIPES = {
  parallel: "M4.5 5h7M4.5 8h7M4.5 11h7",
  perpendicular: "M5 4.5v7M8 4.5v7M11 4.5v7",
  diagonal_left: "M4.5 4.5l7 7M4.5 8l3.5 3.5M8 4.5l3.5 3.5",
  diagonal_right: "M4.5 11.5l7-7M4.5 8L8 4.5M8 11.5L11.5 8",
};

export function patternStripes(pattern) {
  return PATTERN_STRIPES[pattern] || null;
}

// A small square drawn with the pattern's stripe direction.
export function patternGlyph(pattern, size = 16) {
  const stripes = PATTERN_STRIPES[pattern];
  const inner = stripes ? `<path d="${stripes}"></path>` : `<circle cx="8" cy="8" r="1.5"></circle>`;
  return `<svg class="pattern-glyph" width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><rect x="1.5" y="1.5" width="13" height="13" rx="3"></rect>${inner}</svg>`;
}
