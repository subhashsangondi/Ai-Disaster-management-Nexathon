import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { triageIncident } from "../src/services/api.js";
import { createViewportController } from "../src/mapView.js";
import {
  SEVERITY_LEVELS,
  accuracyLabel,
  canAnalyze,
  incidentDescription,
  isQuickSos,
  isUnknownType,
  needsTriage,
  severityFor,
} from "../src/quickSos.js";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

const quickSos = {
  id: "qs-1",
  submission_mode: "quick_sos",
  triage_status: "needs_immediate_triage",
  status: "pending",
  emergency_type: "Unknown",
  description: null,
  latitude: "12.871",
  longitude: "74.842",
  location_accuracy_meters: 15,
  contact_number: "+919876543210",
  latest_analysis: null,
};

test("identifies Quick SOS incidents that need immediate triage", () => {
  assert.equal(isQuickSos(quickSos), true);
  assert.equal(needsTriage(quickSos), true);
  assert.equal(needsTriage({ ...quickSos, triage_status: "assessed" }), false);
  assert.equal(needsTriage({ ...quickSos, status: "resolved" }), false);
  assert.equal(isQuickSos({ submission_mode: "detailed" }), false);
  assert.equal(isQuickSos({}), false, "legacy incidents without the field are detailed reports");
});

test("unknown severity is never upgraded just because the report is a Quick SOS", () => {
  assert.equal(severityFor(quickSos), "unknown");
  assert.equal(severityFor({ ...quickSos, assessed_severity: "high" }), "high");
  assert.equal(severityFor({ latest_analysis: { urgency: "medium" } }), "medium");
  assert.equal(severityFor({ assessed_severity: "low", latest_analysis: { urgency: "critical" } }), "low", "operator triage outranks AI advice");
  assert.equal(severityFor({ assessed_severity: "bogus" }), "unknown");
  assert.deepEqual([...SEVERITY_LEVELS], ["critical", "high", "medium", "low", "unknown"]);
});

test("location-only reports render a placeholder description and cannot be AI-analyzed", () => {
  assert.equal(incidentDescription(quickSos), "Location-only Quick SOS. No description was provided.");
  assert.equal(incidentDescription({ description: "Water rising fast." }), "Water rising fast.");
  assert.equal(canAnalyze(quickSos), false);
  assert.equal(canAnalyze({ description: "Water rising fast." }), true);
  assert.ok(!incidentDescription(quickSos).includes(quickSos.contact_number), "contact number never leaks into map or list text");
  assert.equal(isUnknownType("Unknown"), true);
  assert.equal(isUnknownType("Fire"), false);
});

test("location accuracy labels are readable and tolerate missing values", () => {
  assert.equal(accuracyLabel(15), "±15 m");
  assert.equal(accuracyLabel(2500), "±2.5 km");
  assert.equal(accuracyLabel(null), "Accuracy not reported");
  assert.equal(accuracyLabel("abc"), "Accuracy not reported");
});

test("triage uses the protected operator endpoint with only type and severity", async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => ({ success: true, message: "Incident triage recorded", data: { triage_status: "assessed" } }) };
  };
  const result = await triageIncident("jwt", "qs-1", { emergency_type: "Fire", severity: "high", contact_number: "ignored" });
  assert.equal(request.url, "http://localhost:4000/api/incidents/qs-1/triage");
  assert.equal(request.options.method, "PATCH");
  assert.equal(request.options.headers.Authorization, "Bearer jwt");
  assert.deepEqual(JSON.parse(request.options.body), { emergency_type: "Fire", severity: "high" });
  assert.equal(result.message, "Incident triage recorded");
});

test("Quick SOS markers join the map without resetting the operator's view during polling", () => {
  const calls = [];
  const map = {
    setView: (...args) => calls.push(["setView", ...args]),
    fitBounds: (...args) => calls.push(["fitBounds", ...args]),
  };
  const controller = createViewportController(map);
  const detailed = { latitude: "12.9", longitude: "74.8" };
  controller.sync([detailed]);
  calls.length = 0;
  controller.sync([detailed, quickSos]);
  controller.sync([detailed, { ...quickSos, triage_status: "assessed", assessed_severity: "high" }]);
  assert.deepEqual(calls, []);
  controller.reset([detailed, quickSos]);
  assert.deepEqual(calls[0], ["fitBounds", [[12.9, 74.8], [12.871, 74.842]], { padding: [24, 24] }]);
});
