import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  ApiError,
  analyzeIncident,
  apiRequest,
  assignTeam,
  getIncident,
  getIncidentAnalysis,
  listIncidents,
  listTeams,
  loginOperator,
  updateIncidentStatus,
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
