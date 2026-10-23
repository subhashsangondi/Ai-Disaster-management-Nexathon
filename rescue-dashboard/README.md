# RescueGrid AI — Rescue Dashboard

Operator/admin React dashboard connected to the RescueGrid Express API and PostgreSQL data.

## Configure

```powershell
Copy-Item .env.example .env
npm install
```

```env
VITE_API_BASE_URL=http://localhost:4000
VITE_API_TIMEOUT_MS=65000
VITE_INCIDENT_POLL_MS=15000
```

The API timeout is longer than the configured Gemini timeout so analysis requests can finish cleanly. Polling values below five seconds fall back to 15 seconds.

## Run

```powershell
npm run dev
```

The dashboard runs at <http://localhost:3000>. The backend `CORS_ORIGINS` must include that origin. The current local backend configuration allows both the dashboard at port 3000 and victim frontend at port 5173.

## Authentication and API behavior

- Sign-in calls `POST /api/auth/login`.
- Only operator/admin users are accepted by the UI and backend.
- The JWT is stored in `sessionStorage`, sent as a Bearer token, and removed on sign-out or HTTP 401.
- Incidents, teams, and dashboard statistics refresh every 15 seconds by default.
- Assignments require an explicit operator-review checkbox and an available team.
- Status transitions follow backend rules: assignment performs `pending → assigned`, then operators may set `assigned → in_progress → resolved`.
- Gemini results are labeled advisory and always require human review.

## Checks

```powershell
npm test
npm run lint
npm run build
```

## Backend limitations reflected by the UI

- Stored duplicate matches are returned by `POST /api/incidents/:id/analyze`, but the backend has no later duplicate-results retrieval endpoint. They remain visible for the current analysis result only.
- Incidents with only a manual location appear in the list and details but cannot be placed on the Leaflet map.
- Map imagery requires network access to Esri tile servers; incident data itself still loads if tiles are unavailable.
