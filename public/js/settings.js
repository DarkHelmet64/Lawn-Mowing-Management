import { getDocById, setDocById } from "./db.js";

const DOC_ID = "gdd";
const DEFAULTS = { baseTempF: 50, seasonStart: `${new Date().getFullYear()}-04-01` };

let cached = null;

export async function getSettings() {
  if (cached) return cached;
  const doc = await getDocById("settings", DOC_ID);
  cached = { ...DEFAULTS, ...(doc || {}) };
  return cached;
}

export async function saveSettings(data) {
  cached = { ...(cached || DEFAULTS), ...data };
  await setDocById("settings", DOC_ID, cached);
  return cached;
}
