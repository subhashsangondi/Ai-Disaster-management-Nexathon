const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "http://localhost:5000").replace(/\/+$/, "");

export class IncidentApiError extends Error {
  constructor(message) {
    super(message);
    this.name = "IncidentApiError";
  }
}

function getIncidentId(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const id = data.id;
  if (typeof id === "number" && Number.isFinite(id)) return id;
  if (typeof id === "string" && id.trim()) return id.trim();
  return null;
}

export async function submitIncident(payload) {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}/api/incidents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new IncidentApiError("Could not reach the reporting server. Check that the backend is running and try again.");
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new IncidentApiError(
      response.ok
        ? "The server returned an unreadable response. Your report was not confirmed; please try again."
        : `The reporting server returned an error (HTTP ${response.status}). Please try again.`,
    );
  }

  if (!response.ok) {
    const detail = data && typeof data.message === "string" ? data.message.trim() : "";
    throw new IncidentApiError(detail || `The reporting server returned an error (HTTP ${response.status}). Please try again.`);
  }

  const id = getIncidentId(data);
  if (id === null) {
    throw new IncidentApiError("The server response did not include a valid incident ID. Your report was not confirmed; please try again.");
  }

  return {
    id,
    message: typeof data.message === "string" ? data.message.trim() : "",
    status: typeof data.status === "string" ? data.status.trim() : "",
    reportedAt:
      typeof data.reported_at === "string"
        ? data.reported_at
        : typeof data.created_at === "string"
          ? data.created_at
          : "",
  };
}
