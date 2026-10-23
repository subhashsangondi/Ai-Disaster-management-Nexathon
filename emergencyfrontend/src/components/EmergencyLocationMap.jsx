import { useEffect } from "react";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";

const DEFAULT_MAP_CENTER = [20.5937, 78.9629];
const INCIDENT_MAP_ZOOM = 13;

const SATELLITE_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

function hasValidCoordinates(latitude, longitude) {
  return (
    latitude !== null &&
    latitude !== undefined &&
    longitude !== null &&
    longitude !== undefined &&
    latitude !== "" &&
    longitude !== "" &&
    Number.isFinite(Number(latitude)) &&
    Number.isFinite(Number(longitude)) &&
    Number(latitude) >= -90 &&
    Number(latitude) <= 90 &&
    Number(longitude) >= -180 &&
    Number(longitude) <= 180
  );
}

function MapViewport({ latitude, longitude, hasCoordinates }) {
  const map = useMap();

  useEffect(() => {
    if (hasCoordinates) {
      map.setView([Number(latitude), Number(longitude)], INCIDENT_MAP_ZOOM, { animate: true });
    }
  }, [latitude, longitude, hasCoordinates, map]);

  return null;
}

function MapClickHandler({ onSelectLocation }) {
  useMapEvents({
    click(event) {
      if (typeof onSelectLocation === "function") {
        onSelectLocation(event.latlng.lat, event.latlng.lng);
      }
    },
  });

  return null;
}

export default function EmergencyLocationMap({
  latitude,
  longitude,
  onSelectLocation,
}) {
  const hasCoordinates = hasValidCoordinates(latitude, longitude);

  const selectedLatitude = hasCoordinates ? Number(latitude) : null;
  const selectedLongitude = hasCoordinates ? Number(longitude) : null;

  const center = hasCoordinates
    ? [selectedLatitude, selectedLongitude]
    : DEFAULT_MAP_CENTER;

  return (
    <section className="emergency-map-section">
      <div className="emergency-map-heading">
        <div>
          <h3>Select Emergency Location</h3>
          <p>Click anywhere on the satellite map to select the incident location.</p>
        </div>

        <span className="emergency-map-badge">LIVE MAP</span>
      </div>

      <div className="emergency-map-wrapper">
        <MapContainer
          center={center}
          zoom={hasCoordinates ? INCIDENT_MAP_ZOOM : 5}
          minZoom={3}
          maxZoom={19}
          zoomControl={true}
          scrollWheelZoom={true}
          doubleClickZoom={true}
          touchZoom={true}
          dragging={true}
          keyboard={true}
          className="emergency-location-map"
        >
          <TileLayer
            attribution='Imagery &copy; <a href="https://www.esri.com/">Esri</a> and its imagery providers'
            url={SATELLITE_TILES}
            maxZoom={19}
          />

          <MapViewport
            latitude={selectedLatitude}
            longitude={selectedLongitude}
            hasCoordinates={hasCoordinates}
          />

          <MapClickHandler onSelectLocation={onSelectLocation} />

          {hasCoordinates && (
            <CircleMarker
              center={[selectedLatitude, selectedLongitude]}
              radius={9}
              pathOptions={{
                color: "#ffffff",
                weight: 3,
                fillColor: "#dc2626",
                fillOpacity: 1,
              }}
            >
              <Popup>
                <div className="emergency-location-popup">
                  <strong>Selected incident location</strong>
                  <p>
                    Latitude: {selectedLatitude.toFixed(6)}
                  </p>
                  <p>
                    Longitude: {selectedLongitude.toFixed(6)}
                  </p>
                </div>
              </Popup>
            </CircleMarker>
          )}
        </MapContainer>
      </div>

      {hasCoordinates ? (
        <div className="emergency-map-coordinates">
          <span className="emergency-map-status-dot" />
          <span>
            Selected coordinates: {selectedLatitude.toFixed(6)},{" "}
            {selectedLongitude.toFixed(6)}
          </span>
        </div>
      ) : (
        <p className="emergency-map-hint">
          No location selected. Click on the map to pin the emergency.
        </p>
      )}
    </section>
  );
}