const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://localhost:4000").replace(/\/+$/, "");
const configuredTimeout = Number(import.meta.env.VITE_API_TIMEOUT_MS);
const API_TIMEOUT_MS = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 10000;

export class IncidentApiError extends Error {
  constructor(message) {
    super(message);
    this.name = "IncidentApiError";
  }
}

function validationMessage(body) {
  if (!Array.isArray(body?.errors) || body.errors.length === 0) return "";
  return body.errors
    .map((error) => {
      const field = typeof error?.field === "string" ? error.field.replaceAll("_", " ") : "";
      const message = typeof error?.message === "string" ? error.message : "Invalid value";
      return field ? `${field}: ${message}` : message;
    })
    .join("; ");
}

export async function submitIncident(payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let response;

  try {
    response = await fetch(`${API_BASE_URL}/api/sos`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "omit",
      signal: controller.signal,
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new IncidentApiError("The reporting server took too long to respond. Your report was not confirmed; please try again.");
    }
    throw new IncidentApiError("Could not reach the reporting server. Check that the backend is running and try again.");
  } finally {
    clearTimeout(timeoutId);
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new IncidentApiError(
      response.ok
        ? "The server returned an unreadable response. Your report was not confirmed; please try again."
        : `The reporting server returned an error (HTTP ${response.status}). Please try again.`,
    );
  }

  if (!response.ok || body?.success !== true) {
    const detail = validationMessage(body);
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    throw new IncidentApiError(detail || message || `The reporting server returned an error (HTTP ${response.status}). Please try again.`);
  }

  const incidentId = body?.data?.incident_id;
  if ((typeof incidentId !== "string" || !incidentId.trim()) && !(typeof incidentId === "number" && Number.isFinite(incidentId))) {
    throw new IncidentApiError("The server response did not include a valid incident ID. Your report was not confirmed; please try again.");
  }

  return {
    id: typeof incidentId === "string" ? incidentId.trim() : incidentId,
    message: typeof body.message === "string" ? body.message.trim() : "",
    status: typeof body.data.status === "string" ? body.data.status.trim() : "",
    submissionMode: body.data.submission_mode === "quick_sos" ? "quick_sos" : "detailed",
    analysisStatus: typeof body.data.analysis_status === "string" ? body.data.analysis_status.trim() : "",
    notice: typeof body.data.notice === "string" ? body.data.notice.trim() : "",
    trackingToken: typeof body.data.tracking_token === "string" ? body.data.tracking_token.trim() : "",
  };
}

export async function trackIncident(trackingToken) {
  const token = trackingToken.trim();
  if (!token) throw new IncidentApiError("Enter the tracking token provided when you submitted the report.");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${API_BASE_URL}/api/public/incidents/track`, {
      method: "GET",
      headers: { Accept: "application/json", "X-Incident-Tracking-Token": token },
      credentials: "omit",
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new IncidentApiError("The tracking service took too long to respond. Please try again.");
    throw new IncidentApiError("Could not reach the tracking service. Check your connection and try again.");
  } finally {
    clearTimeout(timeoutId);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new IncidentApiError(`The tracking service returned an unreadable response (HTTP ${response.status}).`);
  }
  if (!response.ok || body?.success !== true) {
    throw new IncidentApiError(body?.message || `Tracking failed (HTTP ${response.status}).`);
  }
  return body.data;
}

// Adds optional details to a Quick SOS that is already saved. Only the tracking-token holder can call it.
export async function addQuickSosDetails(trackingToken, details) {
  const token = String(trackingToken || "").trim();
  if (!token) throw new IncidentApiError("This SOS has no tracking token, so details cannot be added.");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${API_BASE_URL}/api/public/incidents/track/details`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-Incident-Tracking-Token": token },
      credentials: "omit",
      signal: controller.signal,
      body: JSON.stringify(details),
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new IncidentApiError("The server took too long to respond. Your SOS is still saved; try adding details again.");
    throw new IncidentApiError("Could not reach the server. Your SOS is still saved; try adding details again.");
  } finally {
    clearTimeout(timeoutId);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new IncidentApiError(`The server returned an unreadable response (HTTP ${response.status}).`);
  }
  if (!response.ok || body?.success !== true) {
    const detail = validationMessage(body);
    throw new IncidentApiError(detail || body?.message || `Details could not be added (HTTP ${response.status}).`);
  }
  return body.data;
}
