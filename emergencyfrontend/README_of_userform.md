# RescueGrid AI — Emergency Reporting Frontend

Victim-facing React/Vite application for submitting public SOS reports to the RescueGrid AI backend. It does not require or send an operator JWT.

## Prerequisites

- Node.js 20.19+ or 22.12+
- npm
- RescueGrid backend running locally

## Configure and run

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

The default Vite URL is <http://localhost:5173>. Environment variables:

```env
VITE_API_BASE_URL=http://localhost:4000
VITE_API_TIMEOUT_MS=10000
```

Restart Vite after changing environment variables.

## Backend contract

The frontend sends an unauthenticated JSON request to `POST ${VITE_API_BASE_URL}/api/sos`:

```json
{
  "emergency_type": "Flood",
  "description": null,
  "reporter_type": "witness",
  "people_affected": 3,
  "people_injured": 1,
  "victim_phone": null,
  "volunteer_phone": "+91 98765 43210",
  "latitude": null,
  "longitude": null,
  "location_text": "Oak Street near the library"
}
```

`emergency_type` must contain 2–100 characters. `description` is optional; if entered, it must be 10–5000 characters. `reporter_type` is required (`victim`, `witness`, `volunteer`, or `other`). People counts are optional, and `10` represents ten or more. At least one valid 7–15 digit phone number is required in either `victim_phone` or `volunteer_phone`. A complete, valid coordinate pair or a non-empty manual location is required. Manual location is limited to 500 characters.

The API responds with the standard RescueGrid envelope:

```json
{
  "success": true,
  "message": "Emergency report received by RescueGrid AI",
  "data": {
    "incident_id": "30000000-0000-4000-8000-000000000001",
    "status": "pending",
    "created_at": "2026-10-24T00:00:00.000Z",
    "analysis_status": "pending",
    "notice": "This report is stored in RescueGrid AI and is not confirmation of delivery to official emergency services."
  }
}
```

The success screen appears as soon as the backend has stored the incident. Gemini analysis is not part of this request.

## Geolocation

Geolocation is requested only when the user presses **Use My Current Location**. Permission denial, unavailability, timeouts, and unsupported browsers leave the manual-location field available. Localhost is treated as a secure context by modern browsers.

## Incident map

The location picker uses Leaflet and the same Esri satellite imagery tile layer as `rescue-dashboard`. When a location is selected, the map centers at zoom level 13, matching the dashboard's single-incident view. Press **Use My Current Location** to center the map and place the marker at the coordinates returned by the browser. You can also zoom and tap the map to set or move the incident marker; the selected latitude and longitude are then submitted in the SOS request.

The initial map view is only an unpinned India overview, not a reported location. A typed address is not geocoded automatically, so use GPS or select the precise point on the map when coordinates are needed. GPS accuracy depends on the device and browser; manual pin accuracy depends on map zoom and where you tap. Use the map attribution and imagery as supplied by Esri and its imagery providers.

The right-side progress indicator reflects the status returned by the SOS response (`pending`, `assigned`, `in_progress`, or `resolved`) and does not claim team assignment without confirmation from the backend. The public API does not provide ongoing status lookup; the shown status is the latest status returned when the report was submitted.

## Dedicated SOS page

The emergency reporting page has a prominent, centered square **SOS** button below the **Report an Emergency** heading and above the separate **Quick emergency report** card. It opens `/sos`. The dedicated page requests browser location on entry, uses the same satellite map for GPS or manually tapped coordinates, and supports an optional local voice recording with playback and removal. The existing backend accepts JSON coordinates at `POST /api/sos` but does not accept or store audio. To avoid silently discarding a recording, the page requires it to be removed before sending a location-only SOS. The server response must confirm an incident ID before the page shows success.

The backend's SOS route allows anonymous submissions and optionally accepts a valid bearer token. This frontend currently has no login/token management and sends the public request without a token. Adding authenticated SOS submissions requires integrating the app with a frontend login/token provider.

## Checks

```bash
npm test
npm run build
```

## Common issues

- **Could not reach the reporting server:** confirm the backend is running and `VITE_API_BASE_URL` is correct.
- **CORS error:** the backend must allow the Vite origin, normally `http://localhost:5173`.
- **Request timed out:** increase `VITE_API_TIMEOUT_MS` only if the backend is known to be slow.
- **Location permission denied:** use the manual-location field or allow browser location access and retry.

This portal does not itself dispatch official emergency services. In immediate danger, contact local emergency services directly.
