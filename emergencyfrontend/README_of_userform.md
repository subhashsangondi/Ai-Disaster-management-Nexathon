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
  "description": "Water is entering a residential building.",
  "latitude": null,
  "longitude": null,
  "location_text": "Oak Street near the library"
}
```

`emergency_type` must contain 2–100 characters and `description` 10–5000 characters. A complete, valid coordinate pair or a non-empty manual location is required. Manual location is limited to 500 characters.

The API responds with the standard RescueGrid envelope:

```json
{
  "success": true,
  "message": "Emergency report received by RescueGrid AI",
  "data": {
    "incident_id": "30000000-0000-4000-8000-000000000001",
    "status": "pending",
    "analysis_status": "pending",
    "notice": "This report is stored in RescueGrid AI and is not confirmation of delivery to official emergency services."
  }
}
```

The success screen appears as soon as the backend has stored the incident. Gemini analysis is not part of this request.

## Geolocation

Geolocation is requested only when the user presses **Use My Current Location**. Permission denial, unavailability, timeouts, and unsupported browsers leave the manual-location field available. Localhost is treated as a secure context by modern browsers.

## Unsupported public features

The current backend SOS schema does not accept photos, phone numbers, reporter roles, or victim counts, so the public form does not collect or fabricate persistence for them. The backend also has no victim-accessible incident-status lookup endpoint; authenticated operators can view and manage incidents through `/api/incidents`.

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
