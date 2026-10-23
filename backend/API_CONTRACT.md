# RescueGrid AI API Contract

This contract targets the hackathon MVP. It does **not** represent an official emergency-service dispatch channel. AI urgency is advisory and all operational decisions remain with human coordinators.

## Base URL and conventions

- Local base URL: `http://localhost:4000/api`
- Request and response content type: `application/json`
- Protected endpoints require `Authorization: Bearer <jwt>`.
- Operator endpoints accept roles `operator` and `admin` only.
- Timestamps are ISO 8601 values returned by PostgreSQL.

Successful response:

```json
{
  "success": true,
  "message": "Operation successful",
  "data": {}
}
```

Error response:

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    { "field": "description", "message": "Too small: expected string to have >=10 characters" }
  ]
}
```

Status codes are `200`, `201`, `400`, `401`, `403`, `404`, `409`, `429`, `500`, and `503` as appropriate.

## Authentication

### `POST /auth/register` — public, rate limited

Request:

```json
{
  "name": "Demo User",
  "email": "demo@example.com",
  "password": "ExamplePassword123"
}
```

Returns `201` with a public-role user and JWT. A `role` field is rejected; public registration can never create an operator or admin.

### `POST /auth/login` — public, rate limited

```json
{
  "email": "operator@rescuegrid.local",
  "password": "OperatorDemo123!"
}
```

Returns:

```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "token": "signed-jwt",
    "user": {
      "id": "10000000-0000-4000-8000-000000000001",
      "name": "Demo Operator",
      "email": "operator@rescuegrid.local",
      "role": "operator"
    }
  }
}
```

### `GET /auth/me` — authenticated

Returns the current user's `id`, `name`, `email`, `role`, and `created_at`.

## SOS reporting

### `POST /sos` — public, rate limited

Authentication is optional. If a valid public JWT is supplied, its user ID is stored as `reporter_id`.

```json
{
  "emergency_type": "landslide",
  "description": "Three people trapped under debris. One person unconscious.",
  "latitude": 12.9141,
  "longitude": 74.856,
  "location_text": "Near the village bridge"
}
```

`description` must contain at least 10 characters. Supply both valid coordinates or a nonempty `location_text`. Coordinates may be JSON numbers or numeric strings.

Returns `201` only after persistence:

```json
{
  "success": true,
  "message": "Emergency report received by RescueGrid AI",
  "data": {
    "incident_id": "generated-uuid",
    "status": "pending",
    "analysis_status": "pending",
    "notice": "This report is stored in RescueGrid AI and is not confirmation of delivery to official emergency services."
  }
}
```

Gemini is not called during SOS submission.

## Incidents — operator/admin

### `GET /incidents`

Optional query parameters:

- `status`: `pending`, `assigned`, `in_progress`, or `resolved`
- `urgency`: `critical`, `high`, `medium`, `low`, or `unknown`
- `emergency_type`: exact case-insensitive category
- `page`: positive integer; default `1`
- `limit`: `1`–`100`; default `20`

Returns `{ incidents, pagination }`. Each incident has `latest_analysis`, or `null` before analysis.

### `GET /incidents/:id`

Returns the complete incident, latest analysis, and assigned team. Returns `404` for an unknown UUID.

### `POST /incidents/:id/analyze`

Calls the configured Gemini model, validates structured output, stores it, runs deterministic duplicate detection, and returns:

```json
{
  "success": true,
  "message": "Advisory AI analysis completed; human review remains required",
  "data": {
    "analysis": {
      "disaster_type": "landslide",
      "urgency": "critical",
      "victim_count": 3,
      "summary": "Three people are reportedly trapped under debris.",
      "reasoning": "The report explicitly mentions trapped and unconscious people.",
      "requires_review": true
    },
    "possible_duplicates": []
  }
}
```

Returns `503` if Gemini is unconfigured, unavailable, times out, or returns invalid structured output. Existing SOS data is unaffected.

### `GET /incidents/:id/analysis`

Returns the most recent stored analysis, or `404` if no analysis exists.

### `PATCH /incidents/:id/assign`

```json
{ "team_id": "20000000-0000-4000-8000-000000000001" }
```

The incident and team are locked in a transaction. Only a `pending`, unassigned incident can receive an `available` team. The operation records an assignment, marks the incident `assigned`, and marks the team `busy`. Conflicts return `409`.

### `PATCH /incidents/:id/status`

```json
{ "status": "in_progress" }
```

Allowed transitions are `assigned → in_progress → resolved`. Assignment is performed only through the assignment endpoint. Resolving an incident releases its team to `available`; invalid transitions return `409`.

## Rescue teams — operator/admin

### `GET /teams`

Returns all teams. Optionally filter with `?availability=available`, `busy`, or `offline`.

## Dashboard — operator/admin

### `GET /dashboard/stats`

Returns live database counts:

```json
{
  "success": true,
  "message": "Operation successful",
  "data": {
    "total_incidents": 25,
    "pending": 10,
    "assigned": 5,
    "in_progress": 7,
    "resolved": 3,
    "critical_recommendations": 4,
    "available_teams": 6
  }
}
```

## Health

### `GET /health` — public

Returns `200` when the application and PostgreSQL are reachable. Returns `503` with `application: "up"` and `database.connected: false` when the app is running but PostgreSQL is unavailable. Credentials are never included.

## Local demo credentials

These are inserted by `db/seed.sql` and are for local development only:

- Operator: `operator@rescuegrid.local` / `OperatorDemo123!`
- Admin: `admin@rescuegrid.local` / `AdminDemo123!`

Do not use these credentials in a deployed environment.
