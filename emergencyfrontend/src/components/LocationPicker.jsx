import { useState } from "react";
import { ExternalLink, LoaderCircle, MapPin } from "lucide-react";
import EmergencyLocationMap from "./EmergencyLocationMap.jsx";
import { getMapLinks } from "../utils/maps.js";

function geolocationErrorMessage(error) {
  if (error.code === 1) {
    return "Location permission was denied. Allow location access in your browser or device settings, or enter a location manually.";
  }
  if (error.code === 2) {
    return "Your position is unavailable right now. Check your device location settings or enter a location manually.";
  }
  if (error.code === 3) {
    return "Getting your location took too long. Try again or enter a location manually.";
  }
  return "We could not get your location. Enter a location manually or try again.";
}

export default function LocationPicker({ values, onChange, error }) {
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [coordinateSource, setCoordinateSource] = useState("");

  function getCurrentLocation() {
    setLocationError("");
    if (!navigator.geolocation) {
      setLocationError("This browser does not support location access. Enter a location manually.");
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        onChange("latitude", coords.latitude);
        onChange("longitude", coords.longitude);
        setCoordinateSource("gps");
        setLocationError("");
        setIsLocating(false);
      },
      (geoError) => {
        setLocationError(geolocationErrorMessage(geoError));
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  const hasCoordinates = values.latitude !== null && values.longitude !== null;
  const mapLinks = getMapLinks(values);

  function selectMapLocation(latitude, longitude) {
    onChange("latitude", latitude);
    onChange("longitude", longitude);
    setCoordinateSource("map");
    setLocationError("");
  }

  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 block text-sm font-medium text-slate-800">Location <span className="text-red-600">*</span></legend>
      <p className="mb-3 text-xs leading-5 text-slate-500">Use GPS, or zoom and tap the satellite map to place the incident pin. You can also enter a landmark.</p>
      <button type="button" onClick={getCurrentLocation} disabled={isLocating} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#102238] disabled:cursor-wait disabled:opacity-70">
        {isLocating ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : <MapPin aria-hidden="true" size={16} />}
        {isLocating ? "Getting your location..." : hasCoordinates ? "Refresh current location" : "Use My Current Location"}
      </button>

      {hasCoordinates && (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-900" role="status">
          <p className="font-medium">{coordinateSource === "gps" ? "Current device location" : "Incident pin selected on map"}</p>
          <p className="mt-1 break-all font-mono text-xs">Latitude: {values.latitude.toFixed(6)}, Longitude: {values.longitude.toFixed(6)}</p>
          <p className="mt-1 text-xs text-emerald-800">
            {coordinateSource === "gps"
              ? "GPS accuracy depends on your device and browser."
              : "Pin accuracy depends on map zoom and where you tapped. Zoom in and tap again to adjust."}
          </p>
        </div>
      )}

      {(locationError || error) && <p className="field-error" role={locationError ? "alert" : undefined}>{locationError || error}</p>}

      <div className="mt-4">
        <EmergencyLocationMap
          latitude={values.latitude}
          longitude={values.longitude}
          onSelectLocation={selectMapLocation}
        />
        <p className="mt-2 text-xs leading-5 text-slate-500">
          {hasCoordinates
            ? "Tap another point on the map to move the incident pin."
            : "Zoom in and tap the map to set the incident pin. The initial map view is not your location."}
        </p>
      </div>

      <div className="mt-4">
        <label htmlFor="location_text" className="mb-1.5 block text-sm font-medium text-slate-800">Manual location</label>
        <input id="location_text" type="text" value={values.location_text} onChange={(event) => onChange("location_text", event.target.value)} maxLength="500" placeholder="Address, landmark, neighborhood, or directions" aria-invalid={Boolean(error)} aria-describedby={error ? "location-error" : "location-hint"} className="form-control" />
        <p id={error ? "location-error" : "location-hint"} className={error ? "field-error" : "mt-1.5 text-xs text-slate-500"}>
          {error || "At least one location method is required."}
        </p>
      </div>
      {mapLinks.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {mapLinks.map((link) => (
            <a
              key={link.label}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-[#173b5e] transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#102238]"
            >
              <ExternalLink aria-hidden="true" size={15} />
              {link.label}
            </a>
          ))}
        </div>
      )}
    </fieldset>
  );
}
