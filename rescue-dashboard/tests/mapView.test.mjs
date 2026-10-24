import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, bindMapResize, createViewportController } from "../src/mapView.js";

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
