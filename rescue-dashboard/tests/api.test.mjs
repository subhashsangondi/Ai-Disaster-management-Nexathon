import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  ApiError,
  analyzeIncident,
  apiRequest,
  assignTeam,
  getIncident,
  getIncidentAnalysis,
  getIncidentCompletion,
  getIncidentProgress,
  getIncidentDuplicates,
  listIncidents,
  listTeams,
  listResponderAssignments,
  listResponderNotifications,
  loginOperator,
  updateIncidentStatus,
  acknowledgeResponderAssignment,
  submitResponderProgress,
  submitResponderCompletion,
  reviewCompletion,
  reviewIncidentDuplicate,
  createTeam,
  updateTeam,
  getTeamRecommendations,
} from "../src/services/api.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("login sends the exact credentials without a bearer token", async () => {
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return response({ success: true, message: "Login successful", data: { token: "jwt", user: { role: "operator" } } });
  };

  const auth = await loginOperator(" operator@example.com ", "secret");
  assert.equal(auth.token, "jwt");
  assert.equal(request.url, "http://localhost:4000/api/auth/login");
  assert.deepEqual(JSON.parse(request.options.body), { email: "operator@example.com", password: "secret" });
  assert.equal(request.options.headers.Authorization, undefined);
  assert.equal(request.options.credentials, "omit");
});

test("protected reads attach the JWT and parse backend data envelopes", async () => {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.includes("/analysis")) return response({ success: true, data: { urgency: "high" } });
    if (url.endsWith("/api/teams")) return response({ success: true, data: { teams: [{ id: "team-1" }] } });
    if (url.includes("/api/incidents?")) return response({ success: true, data: { incidents: [{ id: "incident-1" }], pagination: { total: 1 } } });
    return response({ success: true, data: { id: "incident-1", status: "pending" } });
  };

  assert.equal((await listIncidents("jwt")).incidents[0].id, "incident-1");
  assert.equal((await getIncident("jwt", "incident-1")).status, "pending");
  assert.equal((await getIncidentAnalysis("jwt", "incident-1")).urgency, "high");
  assert.equal((await listTeams("jwt"))[0].id, "team-1");
  for (const request of requests) assert.equal(request.options.headers.Authorization, "Bearer jwt");
});

test("analysis, assignment, and status mutations use backend-defined payloads", async () => {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/analyze")) return response({ success: true, message: "Analyzed", data: { analysis: { urgency: "critical" }, possible_duplicates: [] } });
    if (url.endsWith("/assign")) return response({ success: true, message: "Assigned", data: { assignment: {}, team: {} } });
    return response({ success: true, message: "Updated", data: { id: "incident-1", status: "in_progress" } });
  };

  assert.equal((await analyzeIncident("jwt", "incident-1")).analysis.urgency, "critical");
  await assignTeam("jwt", "incident-1", "team-1");
  await updateIncidentStatus("jwt", "incident-1", "in_progress");

  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.body, undefined);
  assert.deepEqual(JSON.parse(requests[1].options.body), { team_id: "team-1" });
  assert.deepEqual(JSON.parse(requests[2].options.body), { status: "in_progress" });
});

test("authorization errors retain the HTTP status for session expiry handling", async () => {
  globalThis.fetch = async () => response({ success: false, message: "Invalid or expired token" }, 401);
  await assert.rejects(
    () => apiRequest("/api/incidents", { token: "expired" }),
    (error) => error instanceof ApiError && error.status === 401 && /expired token/.test(error.message),
  );
});

test("network failures produce a meaningful API error", async () => {
  globalThis.fetch = async () => { throw new TypeError("offline"); };
  await assert.rejects(() => listIncidents("jwt"), /Could not reach the RescueGrid API/);
});

test("responder mission operations use role-scoped endpoints and exact payloads", async () => {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/assignments")) return response({ success: true, data: { assignments: [{ id: "assignment-1" }] } });
    if (url.endsWith("/notifications")) return response({ success: true, data: { notifications: [{ id: "notification-1" }] } });
    return response({ success: true, message: "Saved", data: {} });
  };
  assert.equal((await listResponderAssignments("jwt"))[0].id, "assignment-1");
  assert.equal((await listResponderNotifications("jwt"))[0].id, "notification-1");
  await acknowledgeResponderAssignment("jwt", "assignment-1");
  await submitResponderProgress("jwt", "assignment-1", "en_route", "Leaving base");
  await submitResponderCompletion("jwt", "assignment-1", "Three people assisted safely.", "3");
  assert.equal(requests[2].options.body, undefined);
  assert.deepEqual(JSON.parse(requests[3].options.body), { progress_status: "en_route", notes: "Leaving base" });
  assert.deepEqual(JSON.parse(requests[4].options.body), { completion_summary: "Three people assisted safely.", people_assisted: 3 });
  for (const item of requests) assert.equal(item.options.headers.Authorization, "Bearer jwt");
});

test("operator response review APIs parse histories and enforce rejection reasons in payload", async () => {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/progress")) return response({ success: true, data: { events: [{ progress_status: "arrived" }] } });
    if (url.endsWith("/completion")) return response({ success: true, data: { reports: [{ review_status: "pending" }], evidence_photos_supported: false } });
    return response({ success: true, message: "Reviewed", data: { decision: "rejected" } });
  };
  assert.equal((await getIncidentProgress("jwt", "incident-1"))[0].progress_status, "arrived");
  assert.equal((await getIncidentCompletion("jwt", "incident-1")).reports[0].review_status, "pending");
  await reviewCompletion("jwt", "incident-1", "reject", "Summary needs more detail");
  assert.deepEqual(JSON.parse(requests[2].options.body), { reason: "Summary needs more detail" });
});

test("operator duplicate review APIs load links and send explicit review decisions", async () => {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    if (options.method === "GET") return response({ success: true, data: { role: "independent", candidates: [{ incident_id: "incident-2" }], links: [] } });
    return response({ success: true, message: "Duplicate incidents linked after operator review", data: { link: { duplicate_incident_id: "incident-2" } } });
  };

  const duplicates = await getIncidentDuplicates("jwt", "incident-1");
  assert.equal(duplicates.candidates[0].incident_id, "incident-2");
  await reviewIncidentDuplicate("jwt", "incident-1", "incident-2", {
    decision: "confirmed",
    primary_incident_id: "incident-1",
    assignment_conflict_acknowledged: true,
  });

  assert.equal(requests[0].url, "http://localhost:4000/api/incidents/incident-1/duplicates");
  assert.equal(requests[1].options.method, "POST");
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    decision: "confirmed",
    primary_incident_id: "incident-1",
    assignment_conflict_acknowledged: true,
  });
  assert.equal(requests[1].options.headers.Authorization, "Bearer jwt");
});

test("team management uses authenticated admin endpoints and exact payloads", async () => {
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return response({ success: true, message: "Saved", data: { id: "team-1", team_name: "Flood Unit" } });
  };
  const team = {
    team_name: "Flood Unit",
    capabilities: ["Flood response"],
    base_location_name: "Harbor",
    latitude: 12.9,
    longitude: 77.5,
    availability: "available",
    contact_info: null,
  };
  await createTeam("admin-jwt", team);
  await updateTeam("admin-jwt", "team-1", { ...team, availability: "offline" });
  assert.equal(requests[0].url, "http://localhost:4000/api/teams");
  assert.equal(requests[0].options.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].options.body), team);
  assert.equal(requests[1].url, "http://localhost:4000/api/teams/team-1");
  assert.equal(requests[1].options.method, "PATCH");
  assert.equal(requests[1].options.headers.Authorization, "Bearer admin-jwt");
});

test("recommendations use the protected incident endpoint and preserve explanations", async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "http://localhost:4000/api/incidents/incident-1/team-recommendations");
    assert.equal(options.headers.Authorization, "Bearer jwt");
    return response({ success: true, data: { recommendations: [{ team_id: "team-1", rank: 1, explanation: "Flood response matches." }] } });
  };
  const result = await getTeamRecommendations("jwt", "incident-1");
  assert.equal(result.recommendations[0].rank, 1);
  assert.match(result.recommendations[0].explanation, /matches/);
});
