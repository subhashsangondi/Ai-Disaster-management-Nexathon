# RescueGrid AI — Emergency Reporting Frontend

A responsive React frontend for victims, witnesses, and volunteers to report an emergency. This project covers the public reporting module only; it does not include a backend or dispatch service.

## Prerequisites

- Node.js 20.19+ or 22.12+ (Node.js 24 is also supported)
- npm
- The RescueGrid backend for real report submissions

## Install and run

From the project folder:

```bash
npm install
npm run dev
```

Open the local URL printed by Vite, usually <http://localhost:5173>.

Create your local environment file from the example and configure the API address:

```powershell
Copy-Item .env.example .env
```

Set `VITE_API_BASE_URL` in `.env` to the backend origin, for example:

```env
VITE_API_BASE_URL=http://localhost:5000
```

Restart `npm run dev` after changing `.env`.

## Backend contract

The frontend submits a JSON `POST` request to `${VITE_API_BASE_URL}/api/incidents`. The request body uses these exact field names:

```json
{
  "category": "Flood",
  "description": "",
  "reporter_type": "Witness",
  "people_affected": 3,
  "people_injured": 1,
  "victim_phone": "+91 98765 43210",
  "volunteer_phone": "",
  "photos": [],
  "latitude": null,
  "longitude": null,
  "location_text": "User-entered location"
}
```

`description` is optional. `people_affected` and `people_injured` are optional integer counts; an unknown count is sent as `null`, and "10 or more" is sent as `10`. Coordinates are supplied only after the user presses **Use My Current Location** and the browser returns them. If the user chooses manual location instead, latitude and longitude are `null`. The frontend accepts a report as confirmed only when the response is successful and includes a non-empty string or finite numeric `id`.

At least one valid contact number is required: provide either `victim_phone` or `volunteer_phone`. Each field can otherwise be left blank. Phone numbers accept 7–15 digits with an optional country code. A reporter may attach up to three JPG, PNG, or WebP files, each up to 5 MB; `photos` is sent as an array of `{ "filename", "content_type", "data_url" }` objects. The backend must explicitly support and validate these additional JSON fields and image data before they can be saved or used, and allow a request size large enough for the encoded images.

For the status panel, the backend may return `status` and `reported_at` (or `created_at`):

```json
{
  "id": 123,
  "message": "Incident report received",
  "status": "assigned",
  "reported_at": "2026-10-23T10:00:00.000Z"
}
```

The status panel uses the server status for these stages: `received`/`submitted`, `assigned`/`team_assigned`/`dispatched`, `on_the_way`/`en_route`/`responding`/`in_progress`, and `resolved`. The frontend never claims a rescue team is assigned or travelling unless the server returns that status. It displays the status from the submission response; live updates after submission require the backend to provide a status lookup or push-update API. Without a server timestamp, the confirmation labels the submission time as the user's device time. The map links open Google Maps using the captured GPS coordinates and/or typed location.

To test a successful submission:

1. Start the backend and confirm it listens at the configured API base URL.
2. Ensure it implements `POST /api/incidents`, accepts JSON with the fields above, and allows browser requests from the Vite origin through CORS.
3. In the frontend, select a category and reporter type, optionally choose people counts, and provide a manual location or use GPS. Description is optional.
4. Submit and confirm that the success panel displays the actual `id` returned by the server.

The backend teammate should provide the running API URL, implement the endpoint and fields above (including the required victim-or-volunteer contact number and base64-encoded photo objects), return server status and timestamp when available, configure CORS for `http://localhost:5173`, and document any authentication or additional requirements.

## Test GPS

Geolocation is requested only when you press **Use My Current Location**. Localhost is treated as a secure context by modern browsers. Allow location permission in the browser prompt to test GPS success. To test denial, block location access for `localhost` in browser site settings, reload, and press the button; the form will explain how to re-enable permission. Manual location remains available if GPS is denied, unsupported, unavailable, or times out.

## Checks

```bash
npm test
npm run build
```

To run the production preview after building:

```bash
npm run preview
```

## Common issues

- **Could not reach the reporting server:** make sure the backend is running, `VITE_API_BASE_URL` has the right origin, and restart Vite after editing `.env`.
- **CORS error in the browser:** ask the backend teammate to allow the frontend origin (`http://localhost:5173`).
- **A response is not confirmed:** the endpoint must return a successful HTTP status and JSON containing a valid `id`.
- **Location permission denied:** allow location access for this site in browser/device settings, or use the manual location field.
- **GPS unavailable or timed out:** check device location services and retry, or submit with a manual location.

This demo form does not itself dispatch rescue services. In immediate danger, contact local emergency services directly.
