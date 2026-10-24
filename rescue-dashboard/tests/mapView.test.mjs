import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, bindMapResize, createViewportController, incidentCoordinates, mapMarkers } from "../src/mapView.js";
import { needsTriage } from "../src/quickSos.js";

function fakeMap() {
  const calls = [];
  const listeners = new Map();
  return {
    calls,
    listeners,
    setView: (...args) => calls.push(["setView", ...args]),
    fitBounds: (...args) => calls.push(["fitBounds", ...args]),
    invalidateSize: () => calls.push(["invalidateSize"]),
    on: (name, fn) => listeners.set(name, fn),
    off: (name, fn) => { if (listeners.get(name) === fn) listeners.delete(name); },
  };
}
const inc = (lat, lng) => ({ latitude: String(lat), longitude: String(lng) });

test("initial fit happens once for first incidents", () => {
  const map = fakeMap();
  const c = createViewportController(map);
  assert.equal(c.sync([]), false);
  assert.equal(c.sync([inc(1, 2), inc(3, 4)]), true);
  assert.deepEqual(map.calls, [["fitBounds", [[1, 2], [3, 4]], { padding: [24, 24] }]]);
});

test("single incident centers at zoom 13", () => {
  const map = fakeMap();
  createViewportController(map).sync([inc(5, 6)]);
  assert.deepEqual(map.calls, [["setView", [5, 6], 13]]);
});

test("polling rerenders with new arrays and marker changes do not move the view", () => {
  const map = fakeMap();
  const c = createViewportController(map);
  c.sync([inc(1, 2)]);
  map.calls.length = 0;
  c.sync([inc(1, 2)]);
  c.sync([inc(1, 2), inc(9, 9)]);
  c.sync([]);
  assert.deepEqual(map.calls, []);
});

test("selecting an incident (no sync input change) does not move the view", () => {
  const map = fakeMap();
  const c = createViewportController(map);
  c.sync([inc(1, 2), inc(3, 4)]);
  map.calls.length = 0;
  c.sync([inc(1, 2), inc(3, 4)]);
  assert.equal(map.calls.length, 0);
});

test("reset restores fit, or default view when empty, and stops later auto-fit", () => {
  const map = fakeMap();
  const c = createViewportController(map);
  c.reset([]);
  assert.deepEqual(map.calls, [["setView", DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM]]);
  map.calls.length = 0;
  c.sync([inc(1, 2)]);
  assert.equal(map.calls.length, 0);
  c.reset([inc(1, 2), inc(3, 4)]);
  assert.equal(map.calls[0][0], "fitBounds");
});

test("resize binding invalidates size and cleans up listeners", () => {
  const map = fakeMap();
  let scheduled;
  const cancelled = [];
  const unbind = bindMapResize(map, (fn) => { scheduled = fn; return 7; }, (id) => cancelled.push(id));
  scheduled();
  assert.deepEqual(map.calls, [["invalidateSize"]]);
  assert.ok(map.listeners.has("resize"));
  unbind();
  assert.equal(map.listeners.size, 0);
  assert.deepEqual(cancelled, [7]);
});

// Shaped like a real Quick SOS row from GET /api/incidents (no AI analysis, unknown type, awaiting triage).
const quickSos = (overrides = {}) => ({
  id: "qs-1",
  submission_mode: "quick_sos",
  emergency_type: "Unknown",
  description: null,
  status: "pending",
  triage_status: "needs_immediate_triage",
  latest_analysis: null,
  latitude: 13.25359,
  longitude: 74.78431,
  created_at: "2026-10-24T04:26:26.105Z",
  ...overrides,
});
const detailed = (id, created_at, overrides = {}) => ({
  id,
  submission_mode: "detailed",
  emergency_type: "Fire",
  status: "resolved",
  triage_status: "not_required",
  latitude: 13.25359,
  longitude: 74.78431,
  created_at,
  ...overrides,
});

test("Quick SOS with valid coordinates, Unknown type, awaiting triage and no analysis gets a marker", () => {
  const markers = mapMarkers([quickSos()]);
  assert.equal(markers.length, 1);
  assert.equal(markers[0].incident.id, "qs-1");
  assert.deepEqual(markers[0].position, [13.25359, 74.78431]);
  assert.equal(needsTriage(markers[0].incident), true);
});

test("numeric-string coordinates are parsed into numbers", () => {
  assert.deepEqual(incidentCoordinates({ latitude: " 13.25359 ", longitude: "74.78431" }), [13.25359, 74.78431]);
  assert.deepEqual(mapMarkers([quickSos({ latitude: "-33.86", longitude: "151.2" })])[0].position, [-33.86, 151.2]);
});

test("missing, blank, invalid or out-of-range coordinates produce no marker", () => {
  const bad = [
    { latitude: null, longitude: null },
    { latitude: undefined, longitude: 74.7 },
    { latitude: "", longitude: "" },
    { latitude: "   ", longitude: "74.7" },
    { latitude: "abc", longitude: "74.7" },
    { latitude: Number.NaN, longitude: 74.7 },
    { latitude: 91, longitude: 74.7 },
    { latitude: 13, longitude: -181 },
    { latitude: 0, longitude: 0 },
    { latitude: "0", longitude: "0" },
    {},
  ];
  for (const coords of bad) assert.equal(incidentCoordinates(coords), null, JSON.stringify(coords));
  assert.equal(mapMarkers(bad.map((coords, i) => quickSos({ id: `bad-${i}`, latitude: coords.latitude, longitude: coords.longitude }))).length, 0);
});

test("markers are drawn oldest first so a new SOS is not hidden under older co-located reports", () => {
  // The API lists newest first; the Quick SOS shares its exact location with older reports.
  const incidents = [
    quickSos(),
    detailed("eq", "2026-10-24T01:57:04.626Z", { status: "assigned" }),
    detailed("fire", "2026-10-23T19:31:45.324Z"),
  ];
  const markers = mapMarkers(incidents);
  assert.deepEqual(markers.map((m) => m.incident.id), ["fire", "eq", "qs-1"]);
  assert.deepEqual(markers.map((m) => m.colocated), [2, 2, 2]);
});

test("detailed report markers still render alongside Quick SOS markers", () => {
  const markers = mapMarkers([quickSos(), detailed("far", "2026-10-23T00:00:00Z", { latitude: 12.97, longitude: 77.59 })]);
  assert.equal(markers.length, 2);
  assert.equal(markers.find((m) => m.incident.id === "far").colocated, 0);
});

test("an incident with null coordinates does not pull the initial fit to 0,0", () => {
  const map = fakeMap();
  createViewportController(map).sync([quickSos(), detailed("no-gps", "2026-10-23T00:00:00Z", { latitude: null, longitude: null })]);
  assert.deepEqual(map.calls, [["setView", [13.25359, 74.78431], 13]]);
});

test("no fit happens while only unplottable incidents exist, and a later poll fits once", () => {
  const map = fakeMap();
  const c = createViewportController(map);
  assert.equal(c.sync([quickSos({ latitude: null, longitude: null })]), false);
  assert.deepEqual(map.calls, []);
  assert.equal(c.sync([quickSos()]), true);
  map.calls.length = 0;
  c.sync([quickSos(), quickSos({ id: "qs-2", latitude: 20, longitude: 80 })]);
  assert.deepEqual(map.calls, []);
});

test("polling with a new Quick SOS after the user has panned does not reset the viewport", () => {
  const map = fakeMap();
  const c = createViewportController(map);
  c.sync([detailed("fire", "2026-10-23T19:31:45.324Z")]);
  map.calls.length = 0;
  for (let poll = 0; poll < 5; poll += 1) c.sync([quickSos(), detailed("fire", "2026-10-23T19:31:45.324Z")]);
  assert.deepEqual(map.calls, []);
});
