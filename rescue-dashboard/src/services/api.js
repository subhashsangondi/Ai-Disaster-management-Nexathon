const clientEnv = import.meta.env ?? {};
const API_BASE_URL = (clientEnv.VITE_API_BASE_URL || "http://localhost:4000").replace(/\/+$/, "");
const configuredTimeout = Number(clientEnv.VITE_API_TIMEOUT_MS);
const API_TIMEOUT_MS = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 65000;
const SESSION_KEY = "rescuegrid.dashboard.session";

export class ApiError extends Error {
  constructor(message, status = 0, errors = undefined) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errors = errors;
  }
}

function errorDetail(body) {
  if (!Array.isArray(body?.errors)) return "";
  return body.errors
    .map((error) => {
      const field = typeof error?.field === "string" ? error.field.replaceAll("_", " ") : "";
      const message = typeof error?.message === "string" ? error.message : "Invalid value";
      return field ? `${field}: ${message}` : message;
    })
    .join("; ");
}

export async function apiRequest(path, { method = "GET", token, body } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let response;

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      credentials: "omit",
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new ApiError("The RescueGrid API took too long to respond. Please try again.");
    }
    throw new ApiError("Could not reach the RescueGrid API. Confirm the backend is running.");
  } finally {
    clearTimeout(timeoutId);
  }

  let envelope;
  try {
    envelope = await response.json();
  } catch {
    throw new ApiError(`The API returned an unreadable response (HTTP ${response.status}).`, response.status);
  }

  if (!response.ok || envelope?.success !== true) {
    throw new ApiError(
      errorDetail(envelope) || envelope?.message || `Request failed (HTTP ${response.status}).`,
      response.status,
      envelope?.errors,
    );
  }

  return envelope;
}

export async function loginOperator(email, password) {
  const response = await apiRequest("/api/auth/login", {
    method: "POST",
    body: { email: email.trim(), password },
  });
  return response.data;
}

export async function listIncidents(token, filters = {}) {
  const query = new URLSearchParams({ page: "1", limit: "100" });
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  }
  const response = await apiRequest(`/api/incidents?${query}`, { token });
  return response.data;
}

export async function getIncident(token, incidentId) {
  const response = await apiRequest(`/api/incidents/${encodeURIComponent(incidentId)}`, { token });
  return response.data;
}

export async function analyzeIncident(token, incidentId) {
  const response = await apiRequest(`/api/incidents/${encodeURIComponent(incidentId)}/analyze`, {
    method: "POST",
    token,
  });
  return { ...response.data, message: response.message };
}

export async function getIncidentAnalysis(token, incidentId) {
  const response = await apiRequest(`/api/incidents/${encodeURIComponent(incidentId)}/analysis`, { token });
  return response.data;
}

export async function listTeams(token) {
  const response = await apiRequest("/api/teams", { token });
  return response.data.teams;
}

export async function assignTeam(token, incidentId, teamId) {
  const response = await apiRequest(`/api/incidents/${encodeURIComponent(incidentId)}/assign`, {
    method: "PATCH",
    token,
    body: { team_id: teamId },
  });
  return { ...response.data, message: response.message };
}

export async function updateIncidentStatus(token, incidentId, status) {
  const response = await apiRequest(`/api/incidents/${encodeURIComponent(incidentId)}/status`, {
    method: "PATCH",
    token,
    body: { status },
  });
  return { incident: response.data, message: response.message };
}

export async function getDashboardStats(token) {
  const response = await apiRequest("/api/dashboard/stats", { token });
  return response.data;
}

export async function getIncidentProgress(token, incidentId) {
  const response = await apiRequest(`/api/incidents/${encodeURIComponent(incidentId)}/progress`, { token });
  return response.data.events;
}

export async function getIncidentCompletion(token, incidentId) {
  const response = await apiRequest(`/api/incidents/${encodeURIComponent(incidentId)}/completion`, { token });
  return response.data;
}

export async function reviewCompletion(token, incidentId, decision, reason = "") {
  const response = await apiRequest(`/api/incidents/${encodeURIComponent(incidentId)}/completion/${decision}`, {
    method: "POST",
    token,
    ...(decision === "reject" ? { body: { reason } } : {}),
  });
  return { ...response.data, message: response.message };
}

export async function listResponderAssignments(token) {
  const response = await apiRequest("/api/responder/assignments", { token });
  return response.data.assignments;
}

export async function listResponderNotifications(token) {
  const response = await apiRequest("/api/responder/notifications", { token });
  return response.data.notifications;
}

export async function markResponderNotificationRead(token, notificationId) {
  const response = await apiRequest(`/api/responder/notifications/${encodeURIComponent(notificationId)}/read`, { method: "PATCH", token });
  return response.data;
}

export async function acknowledgeResponderAssignment(token, assignmentId) {
  const response = await apiRequest(`/api/responder/assignments/${encodeURIComponent(assignmentId)}/acknowledge`, { method: "POST", token });
  return { ...response.data, message: response.message };
}

export async function submitResponderProgress(token, assignmentId, progressStatus, notes) {
  const response = await apiRequest(`/api/responder/assignments/${encodeURIComponent(assignmentId)}/progress`, {
    method: "POST",
    token,
    body: { progress_status: progressStatus, ...(notes.trim() ? { notes: notes.trim() } : {}) },
  });
  return { ...response.data, message: response.message };
}

export async function submitResponderCompletion(token, assignmentId, summary, peopleAssisted) {
  const response = await apiRequest(`/api/responder/assignments/${encodeURIComponent(assignmentId)}/completion`, {
    method: "POST",
    token,
    body: {
      completion_summary: summary.trim(),
      people_assisted: peopleAssisted === "" ? null : Number(peopleAssisted),
    },
  });
  return { ...response.data, message: response.message };
}

export function readOperatorSession() {
  if (typeof sessionStorage === "undefined") return null;
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    if (!session?.token || !["operator", "admin", "responder"].includes(session?.user?.role)) return null;
    return session;
  } catch {
    return null;
  }
}

export function saveOperatorSession(session) {
  if (typeof sessionStorage !== "undefined") sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearOperatorSession() {
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(SESSION_KEY);
}

export const incidentPollMs = (() => {
  const value = Number(clientEnv.VITE_INCIDENT_POLL_MS);
  return Number.isFinite(value) && value >= 5000 ? value : 15000;
})();
