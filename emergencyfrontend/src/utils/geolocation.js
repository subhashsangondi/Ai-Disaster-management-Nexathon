export const QUICK_SOS_GEOLOCATION_OPTIONS = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };
const MAX_ACCURACY_METERS = 100000;

export class LocationError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = "LocationError";
    this.reason = reason;
  }
}

const MESSAGES = {
  insecure: "Location only works over a secure (HTTPS) connection. Enter your location below instead.",
  unsupported: "This browser cannot share your location. Enter your location below instead.",
  denied: "Location permission was denied. Allow location in your browser settings, or enter your location below.",
  unavailable: "Your location is unavailable right now. Check that location services are on, or enter your location below.",
  timeout: "Finding your location took too long. Try again, or enter your location below.",
  invalid: "Your device returned an unusable location. Try again, or enter your location below.",
};

export function locationErrorFor(reason) {
  return new LocationError(reason, MESSAGES[reason] || MESSAGES.unavailable);
}

export function isUsableCoordinate(latitude, longitude) {
  return Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90
    && longitude >= -180 && longitude <= 180
    // 0,0 is what broken location providers report; it is never treated as a real position.
    && !(latitude === 0 && longitude === 0);
}

// Wraps getCurrentPosition in a promise and validates the result. Never invents coordinates.
export function requestCurrentLocation({
  geolocation = typeof navigator === "undefined" ? undefined : navigator.geolocation,
  isSecureContext = typeof window === "undefined" ? true : window.isSecureContext !== false,
} = {}) {
  if (!isSecureContext) return Promise.reject(locationErrorFor("insecure"));
  if (!geolocation?.getCurrentPosition) return Promise.reject(locationErrorFor("unsupported"));

  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      (position) => {
        const latitude = Number(position?.coords?.latitude);
        const longitude = Number(position?.coords?.longitude);
        if (!isUsableCoordinate(latitude, longitude)) {
          reject(locationErrorFor("invalid"));
          return;
        }
        const accuracy = Number(position.coords.accuracy);
        const capturedAt = new Date(Number.isFinite(position.timestamp) ? position.timestamp : Date.now());
        resolve({
          latitude,
          longitude,
          accuracy: Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= MAX_ACCURACY_METERS
            ? Math.round(accuracy * 10) / 10
            : null,
          capturedAt: Number.isNaN(capturedAt.getTime()) ? new Date().toISOString() : capturedAt.toISOString(),
        });
      },
      (error) => {
        const reason = error?.code === 1 ? "denied" : error?.code === 3 ? "timeout" : "unavailable";
        reject(locationErrorFor(reason));
      },
      QUICK_SOS_GEOLOCATION_OPTIONS,
    );
  });
}
