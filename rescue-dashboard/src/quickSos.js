export const SEVERITY_LEVELS = Object.freeze(["critical", "high", "medium", "low", "unknown"]);

export const TRIAGE_EMERGENCY_TYPES = Object.freeze([
  "Fire",
  "Flood",
  "Medical Emergency",
  "Road Accident",
  "Trapped Person",
  "Earthquake",
  "Landslide",
  "Rescue Required",
  "Other",
]);

export function isQuickSos(incident) {
  return incident?.submission_mode === "quick_sos";
}

export function needsTriage(incident) {
  return incident?.triage_status === "needs_immediate_triage" && incident?.status !== "resolved";
}

// An operator's triage decision outranks the advisory AI urgency. Nothing is inferred from location.
export function severityFor(incident) {
  const assessed = incident?.assessed_severity;
  if (SEVERITY_LEVELS.includes(assessed)) return assessed;
  return incident?.latest_analysis?.urgency || "unknown";
}

export function incidentDescription(incident) {
  const text = String(incident?.description || "").trim();
  if (text) return text;
  return isQuickSos(incident) ? "Location-only Quick SOS. No description was provided." : "No description provided.";
}

export function canAnalyze(incident) {
  return Boolean(String(incident?.description || "").trim());
}

export function accuracyLabel(meters) {
  if (meters === null || meters === undefined || meters === "") return "Accuracy not reported";
  const value = Number(meters);
  if (!Number.isFinite(value) || value < 0) return "Accuracy not reported";
  return value >= 1000 ? `±${(value / 1000).toFixed(1)} km` : `±${Math.round(value)} m`;
}

export function isUnknownType(type) {
  return !type || String(type).trim().toLowerCase() === "unknown";
}
