# RescueGrid AI Backend

Node.js/Express and PostgreSQL API for the RescueGrid AI hackathon MVP. It accepts public SOS reports, gives authorized rescue coordinators an incident dashboard, manages team assignments, and stores advisory Gemini analyses.

This MVP is not a certified emergency dispatch system. Submitting an SOS stores it in RescueGrid AI; it does not confirm delivery to police, fire, ambulance, or another official emergency service.

## Prerequisites

- Node.js 22 LTS or newer (`node --version`)
- npm
- PostgreSQL 15 or newer
- A Google Gemini API key only if AI analysis will be exercised

## 1. Install dependencies

From this `backend` directory:

```bash
npm install
```

## 2. Create and configure PostgreSQL

Create an empty local database using PostgreSQL tools or pgAdmin:

```bash
createdb rescuegrid
```

Copy `.env.example` to `.env`, then replace placeholder values. At minimum, configure a working `DATABASE_URL` and a random `JWT_SECRET` containing at least 32 characters.

```bash
cp .env.example .env
```

Windows PowerShell equivalent:

```powershell
Copy-Item .env.example .env
```

Important settings:

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port; defaults to `4000` |
| `DATABASE_URL` | PostgreSQL connection string |
| `DATABASE_SSL` | Set `true` for a hosted database that requires TLS |
| `JWT_SECRET` | Private signing secret, at least 32 characters |
| `CORS_ORIGINS` | Comma-separated victim/dashboard origins |
| `GEMINI_API_KEY` | Gemini key; never commit this value |
| `GEMINI_MODEL` | Supported model ID; default `gemini-2.5-flash` |
| `GEMINI_TIMEOUT_MS` | Maximum analysis wait; default 15 seconds |

`.env` and generated dependencies are ignored by Git.

## 3. Apply schema and demo data

With `psql` on your path:

```bash
psql "$DATABASE_URL" -f db/schema.sql
psql "$DATABASE_URL" -f db/seed.sql
```

PowerShell example using the URL from your `.env`:

```powershell
psql "postgresql://postgres:postgres@localhost:5432/rescuegrid" -f db/schema.sql
psql "postgresql://postgres:postgres@localhost:5432/rescuegrid" -f db/seed.sql
```

The scripts are rerunnable for the hackathon workflow. The seed contains simulated incidents and fictional teams only.

Local-only credentials:

- `operator@rescuegrid.local` / `OperatorDemo123!`
- `admin@rescuegrid.local` / `AdminDemo123!`

Remove or replace them before any non-demo deployment.

## 4. Run the API

Development with automatic restart:

```bash
npm run dev
```

Normal start:

```bash
npm start
```

Base URL: `http://localhost:4000/api`

Check health:

```bash
curl http://localhost:4000/api/health
```

A `503` health response with `application: "up"` means the process is running but PostgreSQL is not connected.

## 5. Run tests

```bash
npm test
```

Tests use mocked PostgreSQL-facing methods and an injected mock Gemini client. They do not call Gemini or a live emergency system. To rerun while editing:

```bash
npm run test:watch
```

Basic syntax check:

```bash
npm run check
```

## Postman walkthrough

1. Create an environment with `baseUrl` set to `http://localhost:4000/api`.
2. `POST {{baseUrl}}/auth/login` using the demo operator credentials.
3. Save `data.token` as `operatorToken`.
4. Add `Authorization: Bearer {{operatorToken}}` for protected calls.
5. Submit a public `POST {{baseUrl}}/sos` without authorization.
6. Retrieve it using `GET {{baseUrl}}/incidents`.
7. List teams with `GET {{baseUrl}}/teams?availability=available`.
8. Assign a team with `PATCH {{baseUrl}}/incidents/:id/assign`.
9. Progress it with `PATCH {{baseUrl}}/incidents/:id/status`.
10. If Gemini is configured, run `POST {{baseUrl}}/incidents/:id/analyze`.

See [API_CONTRACT.md](./API_CONTRACT.md) for request bodies, responses, access requirements, status transitions, and errors.

## React integration

Add every frontend development/production origin to `CORS_ORIGINS`; do not use a wildcard with credentials. The victim frontend can call `POST /api/sos` directly. The coordinator dashboard should first call `POST /api/auth/login`, keep the returned JWT in its chosen client-side session strategy, and send it as a Bearer token to all incident, team, analysis, and dashboard endpoints.

Example public request:

```javascript
const response = await fetch('http://localhost:4000/api/sos', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(report),
});

const result = await response.json();
if (!response.ok) throw new Error(result.message);
```

Example protected request:

```javascript
const response = await fetch('http://localhost:4000/api/incidents?page=1&limit=20', {
  headers: { Authorization: `Bearer ${token}` },
});
```

## Architecture

- `src/app.js`: Express composition and middleware
- `src/controllers`: HTTP orchestration
- `src/services`: Gemini, duplicate matching, and assignment transactions
- `src/repositories`: parameterized PostgreSQL access
- `src/validators`: Zod request and AI schemas
- `db`: schema and simulated demo seed
- `tests`: repeatable API/service tests with mocks

The AI boundary is intentionally narrow: `analyzeIncident(incident)` returns validated structured data. The AI team can refine `src/services/aiService.js` without changing route/controller contracts.

## Operational notes

- AI analysis is explicit and never blocks initial SOS persistence.
- Duplicate detection uses Haversine distance, time/category weighting, and deterministic text similarity. It only flags candidates; it never merges or deletes reports.
- Assignments use row locks and a transaction to prevent double assignment.
- Only `assigned → in_progress → resolved` status transitions are allowed; assignment itself uses the dedicated endpoint.
- Resolving an incident makes its assigned team available again.
- Passwords are hashed with bcrypt and public registration always creates the `public` role.
- Logs and responses never include secrets or database credentials.
