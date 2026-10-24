export const DEFAULT_MAP_CENTER = [20.5937, 78.9629];
export const DEFAULT_MAP_ZOOM = 5;

function applyFit(map, points) {
  if (points.length === 1) map.setView(points[0], 13);
  else map.fitBounds(points, { padding: [24, 24] });
}

function toPoints(incidents) {
  return incidents.map((incident) => [Number(incident.latitude), Number(incident.longitude)]);
}

// Fits the map to incidents once (first time any exist). Later data refreshes never move the view;
// only an explicit reset() does.
export function createViewportController(map) {
  let fitted = false;
  return {
    sync(incidents) {
      if (fitted || incidents.length === 0) return false;
      fitted = true;
      applyFit(map, toPoints(incidents));
      return true;
    },
    reset(incidents) {
      fitted = true;
      if (incidents.length === 0) map.setView(DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM);
      else applyFit(map, toPoints(incidents));
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
