export const DEFAULT_MAP_CENTER = [20.5937, 78.9629];
export const DEFAULT_MAP_ZOOM = 5;

function applyFit(map, points) {
  if (points.length === 1) map.setView(points[0], 13);
  else map.fitBounds(points, { padding: [24, 24] });
}

function parseCoordinate(value) {
  // Number(null) and Number("") are 0, so blank values must be rejected before converting.
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

// Returns [latitude, longitude] for a plottable incident, or null. Accepts numeric strings.
export function incidentCoordinates(incident) {
  const latitude = parseCoordinate(incident?.latitude);
  const longitude = parseCoordinate(incident?.longitude);
  if (latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  // 0,0 is what broken location providers report; it is never drawn as a real position.
  if (latitude === 0 && longitude === 0) return null;
  return [latitude, longitude];
}

function timeOf(incident) {
  const time = Date.parse(incident?.created_at);
  return Number.isFinite(time) ? time : 0;
}

// Plottable incidents in draw order: oldest first, so newer reports are drawn on top of older
// ones at the same spot. Emergency type, status and analysis never exclude an incident.
export function mapMarkers(incidents) {
  const markers = [];
  for (const incident of incidents || []) {
    const position = incidentCoordinates(incident);
    if (position) markers.push({ incident, position, key: position.map((value) => value.toFixed(5)).join(",") });
  }
  const perLocation = new Map();
  for (const marker of markers) perLocation.set(marker.key, (perLocation.get(marker.key) || 0) + 1);
  return markers
    .map((marker) => ({ incident: marker.incident, position: marker.position, colocated: perLocation.get(marker.key) - 1 }))
    .sort((a, b) => timeOf(a.incident) - timeOf(b.incident));
}

function toPoints(incidents) {
  return incidents.map(incidentCoordinates).filter(Boolean);
}

// Fits the map to incidents once (first time any exist). Later data refreshes never move the view;
// only an explicit reset() does.
export function createViewportController(map) {
  let fitted = false;
  return {
    sync(incidents) {
      if (fitted) return false;
      const points = toPoints(incidents);
      if (points.length === 0) return false;
      fitted = true;
      applyFit(map, points);
      return true;
    },
    reset(incidents) {
      fitted = true;
      const points = toPoints(incidents);
      if (points.length === 0) map.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
      else applyFit(map, points);
    },
  };
}

export function bindMapResize(map, schedule = (fn) => setTimeout(fn, 0), cancel = clearTimeout) {
  const id = schedule(() => map.invalidateSize());
  const onResize = () => map.invalidateSize();
  map.on("resize", onResize);
  return () => {
    cancel(id);
    map.off("resize", onResize);
  };
}
