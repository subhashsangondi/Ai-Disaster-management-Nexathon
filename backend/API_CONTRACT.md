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

`contact_number` is optional on every report. Spaces, hyphens, dots, and parentheses are removed; the
result must be 6–15 digits with an optional leading `+` (for example `+91 98765 43210` is stored as
`+919876543210`). Empty strings are stored as `null`. Validation errors never echo the submitted number.
Contact numbers are returned only by the operator/admin incident endpoints, never by public tracking,
and are never sent to Gemini or Groq.

#### Quick SOS (location-only)

```json
{
  "submission_mode": "quick_sos",
  "latitude": 12.871,
  "longitude": 74.842,
  "location_accuracy_meters": 15,
  "location_captured_at": "2026-10-24T09:00:00.000Z"
}
```

A Quick SOS needs no `emergency_type` or `description` (they are rejected if sent). It requires valid
coordinates or, as a manual fallback, a nonempty `location_text`. `location_accuracy_meters` (0–100000),
`location_captured_at` (ISO 8601), and `contact_number` are optional. The incident is stored with
`emergency_type: "Unknown"`, no description, no severity, and `triage_status: "needs_immediate_triage"`.
Severity is never inferred from location, no AI analysis runs, and no team is assigned automatically.
The response includes `submission_mode: "quick_sos"`, `analysis_status: "not_applicable"`, and
`triage_status`. Detailed reports return `submission_mode: "detailed"` and `triage_status: "not_required"`.

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

## Public tracking

### `GET /public/incidents/track` — public, rate limited

Send the private token in the `X-Incident-Tracking-Token` header. Returns only `incident_reference`,
`emergency_type`, `submission_mode`, `status`, `submitted_at`, `last_updated_at`, and
`progress_messages`. Contact numbers, coordinates, descriptions, and operator fields are never returned.

### `PATCH /public/incidents/track/details` — public, rate limited, tracking token required

Lets the person holding a Quick SOS tracking token add optional details after the SOS is saved:

```json
{ "emergency_type": "Fire", "contact_number": "+91 98765 43210" }
```

`emergency_type` must be one of `Fire`, `Flood`, `Medical`, `Accident`, `Trapped`, or `Other`; at least
one field is required and no other fields are accepted. The victim's type is applied only while the
incident still awaits operator triage, so it never overrides an operator assessment. Detailed reports and
resolved incidents return `404`. The response contains `incident_reference`, `emergency_type`,
`contact_number_provided` (a boolean, not the number), and `awaiting_operator_triage`. The audit log
records only which fields were supplied.

## Incidents — operator/admin

### `GET /incidents`

Optional query parameters:

- `status`: `pending`, `assigned`, `in_progress`, or `resolved`
- `urgency`: `critical`, `high`, `medium`, `low`, or `unknown`
- `emergency_type`: exact case-insensitive category
- `page`: positive integer; default `1`
- `limit`: `1`–`100`; default `20`

Returns `{ incidents, pagination }`. Each incident has `latest_analysis`, or `null` before analysis.
Incidents also include `submission_mode`, `triage_status`, `assessed_severity`, `triaged_at`,
`location_accuracy_meters`, `location_captured_at`, and the optional `contact_number`.

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
    "possible_duplicates": [],
    "provider_metadata": {
      "provider": "gemini",
      "model": "gemini-2.5-flash",
      "fallback_used": false
    }
  }
}
```

Gemini is attempted first. Groq is attempted once when Gemini is unavailable, rate limited, times out,
or returns invalid structured output. `provider_metadata` contains only safe provider/model information.
Returns `503` with a manual-review message if neither provider returns valid structured analysis. Existing
SOS data is unaffected. A location-only Quick SOS with no description returns `422`
(`ANALYSIS_REQUIRES_DESCRIPTION`) without calling any provider; use operator triage instead.

### `GET /incidents/:id/analysis`

Returns the most recent stored analysis, or `404` if no analysis exists.

### `GET /incidents/:id/team-recommendations`

Returns deterministic, advisory recommendations for a pending, assignable incident. Only currently
available teams with complete profiles and an explicitly mapped standardized capability match are
included. Capability match count and the reported incident type take priority; comparable matches are
ordered by straight-line Haversine distance, with named deterministic tie-breaking. Missing incident
coordinates are reported as `distance_km: null`; team profiles with missing coordinates are incomplete
and excluded. Distance is never presented as travel distance or ETA. Confirmed linked duplicates and
incidents that cannot accept an assignment return `assignment_allowed: false` and no recommendations.

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

### `PATCH /incidents/:id/triage`

```json
{ "emergency_type": "Fire", "severity": "high" }
```

Records an operator assessment: sets the emergency type, `assessed_severity` (`critical`, `high`,
`medium`, `low`, or `unknown`), `triage_status: "assessed"`, `triaged_by`, and `triaged_at`, and writes an
`incident_triaged` audit event. It does not assign a team or change the incident status.

## Rescue teams — operator/admin

### `GET /teams`

Returns all teams, including `primary_category`, stored `capabilities`, `normalized_capabilities`,
`legacy_capabilities`, base location, coordinates, availability, optional contact information, active
assignment count, `profile_complete`, and `profile_issues`. Optionally filter with
`?availability=available`, `busy`, or `offline`. Legacy teams may have null fields and are returned as
incomplete without modifying their stored data.

### `GET /teams/:id`

Returns one rescue team with the same authenticated operator/admin projection.

### `POST /teams` â€” admin only

Registers a team. Required fields are `team_name`, a supported `primary_category`, a non-empty array of
standardized capability identifiers, `base_location_name`, valid `latitude` and `longitude`, and initial
`availability` (`available`, `busy`, or `offline`). `contact_info` is optional. Registration never creates
a responder account. Supported identifiers are defined in `src/domain/teamProfile.js`.

### `PATCH /teams/:id` â€” admin only

Updates one or more team fields. Coordinates must be supplied as a pair. A team with an active incident
cannot have availability changed manually. Known legacy capability labels are normalized when an admin
explicitly saves them. Unknown legacy values may be retained or removed, but new unknown values are
rejected.

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
    "needs_triage": 2,
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
