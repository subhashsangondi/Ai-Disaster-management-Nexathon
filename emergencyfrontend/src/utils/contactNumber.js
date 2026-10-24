// Mirrors the backend rule: separators are ignored, then 6-15 digits with an optional leading "+".
// Works for Indian (+91 98765 43210) and international numbers without forcing a country code.
const SEPARATORS = /[\s().-]/g;

export function normalizeContactNumber(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.replace(SEPARATORS, "");
}

export function contactNumberError(value) {
  const normalized = normalizeContactNumber(value);
  if (!normalized) return "";
  if (!/^\+?[0-9]{6,15}$/.test(normalized)) {
    return "Enter a valid phone number, for example +91 98765 43210. Leave it empty if you prefer.";
  }
  return "";
}
