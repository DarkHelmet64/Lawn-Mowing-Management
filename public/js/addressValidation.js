import { byId, escapeHtml } from "./utils.js";

// Free, no-key US address lookup via OpenStreetMap's Nominatim geocoder.
// This used to call the Census Bureau geocoder, but that API doesn't send
// CORS headers, so a browser calling it directly always fails silently -
// Nominatim does support CORS for lightweight client-side lookups like this
// (the same approach libraries like Leaflet's search plugins use), so it
// works with no backend, matching the rest of this app's approach to
// third-party data (see weather.js / Open-Meteo).
async function lookupAddress(address) {
  const url =
    "https://nominatim.openstreetmap.org/search" +
    `?q=${encodeURIComponent(address)}&format=jsonv2&countrycodes=us&limit=1`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Address lookup failed (${res.status})`);
  return res.json();
}

// Where an address is on the map: { lat, lon }, or null when there's no
// match. Throws when the lookup itself fails (e.g. offline).
export async function geocodeAddress(address) {
  const [match] = await lookupAddress(address);
  return match ? { lat: Number(match.lat), lon: Number(match.lon) } : null;
}

// Wires a "Validate" button + status line to an address <input>. Clicking
// the button looks up the current address and reports whether it matched a
// real US address, offering the standardized version if so. Editing the
// address afterward clears the stale result.
export function wireAddressValidation({ inputId, buttonId, statusId }) {
  const input = byId(inputId);
  const button = byId(buttonId);
  const status = byId(statusId);

  function setStatus(text, cls) {
    status.textContent = text;
    status.className = `address-status ${cls || ""}`.trim();
  }

  input.addEventListener("input", () => setStatus("", ""));

  button.addEventListener("click", async () => {
    const address = input.value.trim();
    if (!address) {
      setStatus("Enter an address first.", "address-status-warn");
      return;
    }
    setStatus("Checking…", "");
    button.disabled = true;
    try {
      const matches = await lookupAddress(address);
      if (!matches.length) {
        setStatus("⚠ No match found for this address - double check it.", "address-status-warn");
      } else {
        const matched = matches[0].display_name;
        status.innerHTML = `✓ Matches: ${escapeHtml(matched)} <button type="button" class="link-btn" data-use-match>Use this</button>`;
        status.className = "address-status address-status-ok";
        status.querySelector("[data-use-match]").addEventListener("click", () => {
          input.value = matched;
          setStatus("✓ Address updated to the standardized match.", "address-status-ok");
        });
      }
    } catch (err) {
      console.error("Address validation failed", err);
      setStatus("Couldn't validate right now (check your connection).", "address-status-warn");
    } finally {
      button.disabled = false;
    }
  });
}
