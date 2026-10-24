import { useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import {
  ApiError,
  analyzeIncident,
  assignTeam,
  clearOperatorSession,
  getDashboardStats,
  getIncident,
  getIncidentAnalysis,
  getIncidentDuplicates,
  getIncidentCompletion,
  getIncidentProgress,
  incidentPollMs,
  listIncidents,
  listTeams,
  listResponderAssignments,
  listResponderNotifications,
  loginOperator,
  acknowledgeResponderAssignment,
  markResponderNotificationRead,
  readOperatorSession,
  saveOperatorSession,
  submitResponderCompletion,
  submitResponderProgress,
  updateIncidentStatus,
  reviewCompletion,
  reviewIncidentDuplicate,
  createTeam,
  updateTeam,
  getTeamRecommendations,
} from "./services/api.js";
import {
  EMPTY_TEAM_DRAFT,
  canManageTeams,
  recommendationDistance,
  teamDraftPayload,
  teamToDraft,
  validateTeamDraft,
} from "./teamManagement.js";

const STATUS_LABELS = {
  pending: "Pending",
  assigned: "Assigned",
  in_progress: "In Progress",
  resolved: "Resolved",
};

const URGENCY_COLORS = {
  critical: "#dc2626",
  high: "#d97706",
  medium: "#2563eb",
  low: "#16a34a",
  unknown: "#64748b",
};

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status || "Unknown";
}

function urgencyFor(incident) {
  return incident.latest_analysis?.urgency || "unknown";
}

function hasCoordinates(incident) {
  const latitude = Number(incident.latitude);
  const longitude = Number(incident.longitude);
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

function apiMessage(error, fallback) {
  return error instanceof ApiError ? error.message : fallback;
}

function LoginScreen({ message, onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event) {
    event.preventDefault();
    if (isSubmitting) return;
    setError("");
    setIsSubmitting(true);
    try {
      const auth = await loginOperator(email, password);
      if (!["operator", "admin", "responder"].includes(auth?.user?.role)) {
        throw new ApiError("This account is not authorized to access rescue operations.", 403);
      }
      onLogin(auth);
    } catch (loginError) {
      setError(apiMessage(loginError, "Login failed. Please try again."));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="brand login-brand">
          <span className="brand-icon">R</span>
          <div>
            <h2>RescueGrid AI</h2>
            <p>Disaster Response</p>
          </div>
        </div>
        <p className="eyebrow">SECURE OPERATIONS ACCESS</p>
        <h1 id="login-title">Operations sign in</h1>
        <p className="login-copy">Use an authorized operator, administrator, or responder account.</p>
        {(message || error) && <div className={error ? "alert error" : "alert info"} role={error ? "alert" : "status"}>{error || message}</div>}
        <form onSubmit={handleSubmit} className="login-form">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
          <label htmlFor="password">Password</label>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          <button className="primary-button" type="submit" disabled={isSubmitting || !email || !password}>
            {isSubmitting ? "Signing in..." : "Sign in"}
          </button>
        </form>
        <p className="security-note">Credentials are sent only to the configured RescueGrid API. The JWT is kept in this browser tab session.</p>
      </section>
    </main>
  );
}

const NEXT_PROGRESS = {
  acknowledged: "en_route",
  en_route: "arrived",
  arrived: "rescue_in_progress",
};

function progressLabel(status) {
  return (status || "unknown").replaceAll("_", " ");
}

function ResponderDashboard({ session, onLogout }) {
  const [assignments, setAssignments] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [notes, setNotes] = useState({});
  const [completion, setCompletion] = useState({});

  const refresh = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setIsLoading(true);
    try {
      const [nextAssignments, nextNotifications] = await Promise.all([
        listResponderAssignments(session.token),
        listResponderNotifications(session.token),
      ]);
      setAssignments(nextAssignments);
      setNotifications(nextNotifications);
      setError("");
    } catch (refreshError) {
      if (refreshError instanceof ApiError && refreshError.status === 401) onLogout("Your session expired. Sign in again.");
      else setError(apiMessage(refreshError, "Could not load assigned missions."));
    } finally {
      setIsLoading(false);
    }
  }, [onLogout, session.token]);

  useEffect(() => {
    const initialId = window.setTimeout(() => refresh(), 0);
    const intervalId = window.setInterval(() => refresh({ quiet: true }), incidentPollMs);
    return () => { window.clearTimeout(initialId); window.clearInterval(intervalId); };
  }, [refresh]);

  async function run(assignmentId, operation) {
    setBusyId(assignmentId);
    setError("");
    setMessage("");
    try {
      const result = await operation();
      setMessage(result?.message || "Update saved.");
      await refresh({ quiet: true });
    } catch (actionError) {
      if (actionError instanceof ApiError && actionError.status === 401) onLogout("Your session expired. Sign in again.");
      else setError(apiMessage(actionError, "The update could not be saved."));
    } finally {
      setBusyId("");
    }
  }

  async function readNotification(notificationId) {
    try {
      await markResponderNotificationRead(session.token, notificationId);
      await refresh({ quiet: true });
    } catch (readError) {
      setError(apiMessage(readError, "Notification could not be marked read."));
    }
  }

  const unread = notifications.filter((notification) => !notification.read_at);
  if (isLoading) return <main className="loading-page"><div className="loading-spinner" /><h1>Loading assigned missions...</h1></main>;

  return (
    <main className="responder-page">
      <header className="responder-header">
        <div><p className="eyebrow">FIELD RESPONSE</p><h1>My rescue missions</h1><p>{session.user.name} · {unread.length} unread notification{unread.length === 1 ? "" : "s"}</p></div>
        <div className="responder-header-actions"><button className="secondary-button" type="button" onClick={() => refresh()}>Refresh</button><button className="text-button" type="button" onClick={() => onLogout("")}>Sign out</button></div>
      </header>
      {error && <div className="alert error" role="alert">{error}</div>}
      {message && <div className="alert success" role="status">{message}</div>}

      <section className="responder-section" aria-labelledby="notification-title">
        <div className="panel-heading"><div><h2 id="notification-title">Team notifications</h2><p>Notification receipt does not count as acknowledgment.</p></div><span className="incident-count">{unread.length} unread</span></div>
        {notifications.length === 0 ? <div className="empty-state">No assignment notifications.</div> : notifications.map((notification) => (
          <article className={`notification-card ${notification.read_at ? "" : "unread"}`} key={notification.id}>
            <div><strong>{notification.emergency_type} · {notification.urgency}</strong><p>{notification.location_text || "Location details are in the mission."}</p><small>Assigned {formatDate(notification.created_at)}</small></div>
            {!notification.read_at && <button className="secondary-button" type="button" onClick={() => readNotification(notification.id)}>Mark read</button>}
          </article>
        ))}
      </section>

      <section className="responder-section" aria-labelledby="missions-title">
        <div className="panel-heading"><div><h2 id="missions-title">Active missions</h2><p>Only assignments belonging to your team are shown.</p></div></div>
        {assignments.length === 0 ? <div className="empty-state">No active missions are assigned to your team.</div> : assignments.map((assignment) => {
          const next = NEXT_PROGRESS[assignment.progress_status];
          const draft = completion[assignment.id] || { summary: "", people: "" };
          return (
            <article className="mission-card" key={assignment.id}>
              <div className="mission-heading"><div><p className="eyebrow">{assignment.team_name}</p><h2>{assignment.emergency_type}</h2><p>{assignment.location_text || `${assignment.latitude}, ${assignment.longitude}`}</p></div><span className="status in-progress">{progressLabel(assignment.progress_status)}</span></div>
              <p className="mission-description">{assignment.description}</p>
              <div className="mission-actions">
                {assignment.progress_status === "assigned" && <button className="primary-button" disabled={busyId === assignment.id} type="button" onClick={() => run(assignment.id, () => acknowledgeResponderAssignment(session.token, assignment.id))}>{busyId === assignment.id ? "Saving..." : "Acknowledge assignment"}</button>}
                {next && <><label htmlFor={`notes-${assignment.id}`}>Optional field notes</label><textarea id={`notes-${assignment.id}`} rows="3" maxLength="2000" value={notes[assignment.id] || ""} onChange={(event) => setNotes((current) => ({ ...current, [assignment.id]: event.target.value }))} /><button className="primary-button" disabled={busyId === assignment.id} type="button" onClick={() => run(assignment.id, () => submitResponderProgress(session.token, assignment.id, next, notes[assignment.id] || ""))}>Report {progressLabel(next)}</button></>}
                {assignment.progress_status === "rescue_in_progress" && <><label htmlFor={`summary-${assignment.id}`}>Completion summary</label><textarea id={`summary-${assignment.id}`} rows="4" minLength="10" maxLength="5000" value={draft.summary} onChange={(event) => setCompletion((current) => ({ ...current, [assignment.id]: { ...draft, summary: event.target.value } }))} /><label htmlFor={`people-${assignment.id}`}>People assisted (optional)</label><input id={`people-${assignment.id}`} type="number" min="0" value={draft.people} onChange={(event) => setCompletion((current) => ({ ...current, [assignment.id]: { ...draft, people: event.target.value } }))} /><button className="primary-button" disabled={busyId === assignment.id || draft.summary.trim().length < 10} type="button" onClick={() => run(assignment.id, () => submitResponderCompletion(session.token, assignment.id, draft.summary, draft.people))}>Request completion review</button><p className="field-note">Submitting does not resolve the incident. An operator must verify and approve it.</p></>}
                {assignment.progress_status === "completion_requested" && <div className="alert info">Completion is awaiting operator review.</div>}
                {assignment.latest_completion?.review_status === "rejected" && <div className="alert error">Completion was rejected: {assignment.latest_completion.review_reason}</div>}
              </div>
              <div className="timeline"><h3>Progress timeline</h3>{(assignment.progress_history || []).length === 0 ? <p>No field updates yet.</p> : assignment.progress_history.map((event) => <div className="timeline-event" key={event.id}><span /><div><strong>{progressLabel(event.progress_status)}</strong><small>{formatDate(event.created_at)}</small>{event.notes && <p>{event.notes}</p>}</div></div>)}</div>
            </article>
          );
        })}
      </section>
    </main>
  );
}

function MapViewport({ incidents }) {
  const map = useMap();
  useEffect(() => {
    if (incidents.length === 1) {
      map.setView([Number(incidents[0].latitude), Number(incidents[0].longitude)], 13);
    } else if (incidents.length > 1) {
      map.fitBounds(incidents.map((incident) => [Number(incident.latitude), Number(incident.longitude)]), { padding: [24, 24] });
    }
  }, [incidents, map]);
  return null;
}

function IncidentMap({ incidents, onSelect }) {
  const mappedIncidents = useMemo(() => incidents.filter(hasCoordinates), [incidents]);
  return (
    <div className="map-wrap">
      <MapContainer center={[20.5937, 78.9629]} zoom={5} scrollWheelZoom className="map-placeholder">
        <TileLayer
          attribution='Imagery &copy; <a href="https://www.esri.com/">Esri</a> and its imagery providers'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          maxZoom={19}
        />
        <MapViewport incidents={mappedIncidents} />
        {mappedIncidents.map((incident) => {
          const urgency = urgencyFor(incident);
          return (
            <CircleMarker
              key={incident.id}
              center={[Number(incident.latitude), Number(incident.longitude)]}
              radius={8}
              pathOptions={{ color: "#ffffff", weight: 2, fillColor: URGENCY_COLORS[urgency], fillOpacity: 1 }}
              eventHandlers={{ click: () => onSelect(incident.id) }}
            >
              <Popup>
                <div className="incident-popup">
                  <strong>{incident.emergency_type}</strong>
                  <p>{incident.description}</p>
                  <p>Urgency: {urgency}</p>
                  <p>Status: {statusLabel(incident.status)}</p>
                  <button className="link-button" type="button" onClick={() => onSelect(incident.id)}>Open details</button>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
      {mappedIncidents.length === 0 && <p className="map-empty">No incidents with GPS coordinates are available.</p>}
    </div>
  );
}

function TeamMapViewport({ latitude, longitude }) {
  const map = useMap();
  useEffect(() => {
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) map.setView([latitude, longitude], 12);
  }, [latitude, longitude, map]);
  return null;
}

function TeamMapClickHandler({ onPick }) {
  useMapEvents({ click: (event) => onPick(event.latlng.lat, event.latlng.lng) });
  return null;
}

function TeamLocationPicker({ latitude, longitude, onPick }) {
  const validCoordinates = Number.isFinite(Number(latitude)) && latitude !== ""
    && Number.isFinite(Number(longitude)) && longitude !== "";
  const coordinates = validCoordinates ? [Number(latitude), Number(longitude)] : null;
  return (
    <div className="team-location-picker">
      <MapContainer center={coordinates || [20.5937, 78.9629]} zoom={coordinates ? 12 : 4} scrollWheelZoom className="team-map">
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <TeamMapClickHandler onPick={onPick} />
        {coordinates && <><TeamMapViewport latitude={coordinates[0]} longitude={coordinates[1]} /><CircleMarker center={coordinates} radius={8} pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#2563eb", fillOpacity: 1 }} /></>}
      </MapContainer>
      <p className="field-note">Click the map to set approximate base coordinates. Manual coordinate entry remains available.</p>
    </div>
  );
}

function TeamManagement({ session, teams, onSave }) {
  const isAdmin = canManageTeams(session.user.role);
  const [editingId, setEditingId] = useState("");
  const [draft, setDraft] = useState({ ...EMPTY_TEAM_DRAFT });
  const [errors, setErrors] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const editingTeam = teams.find((team) => team.id === editingId);
  const editingBusyTeam = editingTeam?.availability === "busy";

  function updateDraft(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function beginEdit(team) {
    setEditingId(team.id);
    setDraft(teamToDraft(team));
    setErrors({});
    setMessage("");
    setError("");
    window.setTimeout(() => document.getElementById("team-editor")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  function resetForm() {
    setEditingId("");
    setDraft({ ...EMPTY_TEAM_DRAFT });
    setErrors({});
  }

  async function submit(event) {
    event.preventDefault();
    const nextErrors = validateTeamDraft(draft, { editingBusyTeam });
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setError("Review the highlighted team fields.");
      return;
    }
    setIsSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await onSave(editingId, teamDraftPayload(draft, { editingBusyTeam }));
      setMessage(result.message || (editingId ? "Rescue team updated." : "Rescue team registered."));
      resetForm();
    } catch (saveError) {
      setError(apiMessage(saveError, "The rescue team could not be saved."));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section id="teams" className="panel teams-panel">
      <div className="panel-heading"><div><h2>{isAdmin ? "Manage Teams" : "Rescue Teams"}</h2><p>{isAdmin ? "Register and maintain dispatch-ready team information." : "Current team capability and availability data."}</p></div><span className="incident-count">{teams.length} teams</span></div>
      {message && <div className="alert success team-alert" role="status">{message}</div>}
      {error && <div className="alert error team-alert" role="alert">{error}</div>}
      {isAdmin && (
        <form id="team-editor" className="team-form" onSubmit={submit} noValidate>
          <div className="detail-section-heading"><div><p className="eyebrow">ADMIN ONLY</p><h3>{editingId ? `Edit ${editingTeam?.team_name || "team"}` : "Register rescue team"}</h3></div>{editingId && <button className="text-button" type="button" onClick={resetForm}>Cancel edit</button>}</div>
          <div className="team-form-grid">
            <label>Team name<input value={draft.team_name} maxLength="150" onChange={(event) => updateDraft("team_name", event.target.value)} />{errors.team_name && <small>{errors.team_name}</small>}</label>
            <label>Capabilities<input value={draft.capabilities} onChange={(event) => updateDraft("capabilities", event.target.value)} placeholder="Flood response, medical first aid" />{errors.capabilities && <small>{errors.capabilities}</small>}</label>
            <label>Base location name<input value={draft.base_location_name} maxLength="255" onChange={(event) => updateDraft("base_location_name", event.target.value)} />{errors.base_location_name && <small>{errors.base_location_name}</small>}</label>
            <label>Initial availability<select value={draft.availability} disabled={editingBusyTeam} onChange={(event) => updateDraft("availability", event.target.value)}>{editingBusyTeam && <option value="busy">Busy (assignment managed)</option>}<option value="available">Available</option><option value="offline">Offline</option></select>{errors.availability && <small>{errors.availability}</small>}</label>
            <label>Latitude<input type="number" min="-90" max="90" step="any" value={draft.latitude} onChange={(event) => updateDraft("latitude", event.target.value)} />{errors.latitude && <small>{errors.latitude}</small>}</label>
            <label>Longitude<input type="number" min="-180" max="180" step="any" value={draft.longitude} onChange={(event) => updateDraft("longitude", event.target.value)} />{errors.longitude && <small>{errors.longitude}</small>}</label>
            <label className="team-contact-field">Contact information (optional)<input value={draft.contact_info} maxLength="255" onChange={(event) => updateDraft("contact_info", event.target.value)} />{errors.contact_info && <small>{errors.contact_info}</small>}</label>
          </div>
          <TeamLocationPicker latitude={draft.latitude} longitude={draft.longitude} onPick={(latitude, longitude) => setDraft((current) => ({ ...current, latitude: latitude.toFixed(6), longitude: longitude.toFixed(6) }))} />
          <button className="primary-button" disabled={isSaving} type="submit">{isSaving ? "Saving..." : editingId ? "Save team changes" : "Register team"}</button>
          {editingBusyTeam && <p className="field-note">Availability is locked while this team has an active incident. Other team details can still be updated.</p>}
        </form>
      )}
      {teams.length === 0 ? <div className="empty-state">No rescue teams are configured.</div> : <div className="team-grid">{teams.map((team) => (
        <article className="team-card" key={team.id}>
          <div className="team-card-heading"><span className={`team-state ${team.availability}`} /><div><strong>{team.team_name}</strong><p>{team.availability}{team.active_assignment_count ? ` · ${team.active_assignment_count} active` : ""}</p></div></div>
          <div className="capability-badges">{team.capabilities?.length ? team.capabilities.map((capability) => <span key={capability}>{capability}</span>) : <span className="unknown-capability">Capabilities unknown</span>}</div>
          <p className="team-location">{team.base_location_name || "Base location unknown"}{team.latitude == null || team.longitude == null ? " · Coordinates unknown" : ` · ${team.latitude}, ${team.longitude}`}</p>
          {team.contact_info && <p className="team-contact">Contact: {team.contact_info}</p>}
          {isAdmin && <button className="secondary-button" type="button" onClick={() => beginEdit(team)}>Edit team</button>}
        </article>
      ))}</div>}
    </section>
  );
}

function AnalysisPanel({ incident, analysisResult, isAnalyzing, onAnalyze, onSelectIncident }) {
  const analysis = analysisResult?.analysis || incident.latest_analysis;
  const duplicates = analysisResult?.possible_duplicates || [];
  return (
    <section className="detail-section" aria-labelledby="analysis-title">
      <div className="detail-section-heading">
        <div>
          <p className="eyebrow">ADVISORY ONLY</p>
          <h3 id="analysis-title">Gemini analysis</h3>
        </div>
        <button className="secondary-button" type="button" onClick={onAnalyze} disabled={isAnalyzing}>
          {isAnalyzing ? "Analyzing..." : analysis ? "Run new analysis" : "Analyze incident"}
        </button>
      </div>
      {!analysis ? (
        <div className="empty-state compact">No AI analysis has been run. Review the report before requesting advisory triage.</div>
      ) : (
        <>
          <div className="analysis-grid">
            <div><span>Classification</span><strong>{analysis.disaster_type}</strong></div>
            <div><span>Urgency</span><strong className={`urgency ${analysis.urgency}`}>{analysis.urgency}</strong></div>
            <div><span>Victim count</span><strong>{analysis.victim_count ?? "Not stated"}</strong></div>
            <div><span>Human review</span><strong>{analysis.requires_review ? "Required" : "Required by policy"}</strong></div>
          </div>
          <h4>Summary</h4>
          <p>{analysis.summary}</p>
          <h4>Reasoning</h4>
          <p>{analysis.reasoning}</p>
          <div className="human-review"><span>REVIEW</span><p>AI output is advisory. A coordinator must verify the report and recommendation before assigning a team.</p></div>
        </>
      )}
      {analysisResult && (
        <div className="duplicates">
          <h4>Potential duplicate incidents</h4>
          {duplicates.length === 0 ? <p>None detected in the configured time and distance window.</p> : (
            <ul>{duplicates.map((duplicate) => <li key={duplicate.incident_id}><button type="button" className="link-button" onClick={() => onSelectIncident(duplicate.incident_id)}>{duplicate.incident_id}</button> — score {Math.round(duplicate.similarity_score * 100)}%{duplicate.distance_km == null ? "" : `, ${duplicate.distance_km} km away`}</li>)}</ul>
          )}
        </div>
      )}
    </section>
  );
}

function DuplicateCandidateCard({ incident, candidate, isLinked, busyAction, onReview, onSelectIncident }) {
  const candidateHasAssignment = Boolean(candidate.assigned_team_id);
  const incidentHasAssignment = Boolean(incident.assigned_team_id);
  const bothAssigned = candidateHasAssignment && incidentHasAssignment;
  const [primaryId, setPrimaryId] = useState(candidateHasAssignment && !incidentHasAssignment ? candidate.incident_id : incident.id);
  const [reason, setReason] = useState("");
  const [conflictAcknowledged, setConflictAcknowledged] = useState(false);

  return (
    <article className="duplicate-card">
      <div className="duplicate-card-heading">
        <div>
          <button type="button" className="link-button" onClick={() => onSelectIncident(candidate.incident_id)}>{candidate.incident_id}</button>
          <strong>{candidate.emergency_type}</strong>
        </div>
        <span className="incident-count">{Math.round(candidate.similarity_score * 100)}% match</span>
      </div>
      <p>{candidate.description}</p>
      <div className="duplicate-meta"><span>Status: {statusLabel(candidate.status)}</span><span>{candidate.distance_km == null ? "Distance unavailable" : `${candidate.distance_km} km away`}</span><span>{candidateHasAssignment ? "Assigned" : "Unassigned"}</span></div>
      {candidate.review_decision && <div className={`alert ${candidate.review_decision === "confirmed" ? "success" : "info"}`}>Latest operator review: {candidate.review_decision}{candidate.review_reason ? ` — ${candidate.review_reason}` : ""}</div>}
      {isLinked ? <div className="alert success">This incident pair is already linked.</div> : (
        <div className="duplicate-review-controls">
          <label htmlFor={`primary-${candidate.incident_id}`}>Primary incident if confirmed</label>
          <select id={`primary-${candidate.incident_id}`} value={primaryId} onChange={(event) => setPrimaryId(event.target.value)}>
            <option value={incident.id}>Current incident: {incident.id}</option>
            <option value={candidate.incident_id}>Candidate: {candidate.incident_id}</option>
          </select>
          <label htmlFor={`duplicate-reason-${candidate.incident_id}`}>Operator review note</label>
          <textarea id={`duplicate-reason-${candidate.incident_id}`} rows="2" maxLength="2000" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why these reports are or are not the same event" />
          {bothAssigned && <label className="review-check"><input type="checkbox" checked={conflictAcknowledged} onChange={(event) => setConflictAcknowledged(event.target.checked)} /> Both incidents already have assignments. Preserve both assignments and flag this conflict for explicit operator handling.</label>}
          <div className="duplicate-actions">
            <button className="primary-button" type="button" disabled={Boolean(busyAction) || (bothAssigned && !conflictAcknowledged)} onClick={() => onReview(candidate.incident_id, { decision: "confirmed", primary_incident_id: primaryId, ...(reason.trim().length >= 5 ? { reason: reason.trim() } : {}), assignment_conflict_acknowledged: conflictAcknowledged })}>Confirm and link</button>
            <button className="secondary-button" type="button" disabled={Boolean(busyAction) || reason.trim().length < 5} onClick={() => onReview(candidate.incident_id, { decision: "rejected", reason: reason.trim(), assignment_conflict_acknowledged: false })}>Reject match</button>
          </div>
        </div>
      )}
    </article>
  );
}

function DuplicateReviewPanel({ incident, duplicateData, busyAction, onReview, onSelectIncident }) {
  const links = duplicateData?.links || [];
  const candidates = duplicateData?.candidates || [];
  const linkedIncidentIds = new Set(links.flatMap((link) => [link.primary_incident_id, link.duplicate_incident_id]));
  const isLinkedDuplicate = duplicateData?.role === "duplicate";
  return (
    <section className="detail-section" aria-labelledby="duplicate-review-title">
      <div className="detail-section-heading"><div><p className="eyebrow">OPERATOR REVIEW REQUIRED</p><h3 id="duplicate-review-title">Duplicate incident review</h3></div></div>
      <div className="human-review"><span>REVIEW</span><p>Similarity and distance are advisory. Reports remain separate unless an operator confirms and links them.</p></div>
      {links.length > 0 && <div className="linked-incidents"><h4>Linked incidents</h4>{links.map((link) => {
        const currentIsPrimary = link.primary_incident_id === incident.id;
        const relatedId = currentIsPrimary ? link.duplicate_incident_id : link.primary_incident_id;
        const relatedStatus = currentIsPrimary ? link.duplicate_status : link.primary_status;
        return <article className="linked-incident" key={link.id}><div><strong>{currentIsPrimary ? "Linked duplicate" : "Primary incident"}</strong><button type="button" className="link-button" onClick={() => onSelectIncident(relatedId)}>{relatedId}</button><small>Status: {statusLabel(relatedStatus)} · Linked {formatDate(link.linked_at)}</small>{link.assignment_conflict_acknowledged && <small>Dual assignments preserved after explicit operator acknowledgment.</small>}</div><span className={`status ${link.resolution_verified_at ? "resolved" : "assigned"}`}>{link.resolution_verified_at ? "Verified resolved" : "Linked"}</span></article>;
      })}</div>}
      {isLinkedDuplicate && <div className="alert info">This report is handled through its primary incident. A new rescue assignment cannot be created here.</div>}
      {candidates.length === 0 ? <div className="empty-state compact">No stored AI duplicate candidates are available for operator review.</div> : <div className="duplicate-list">{candidates.map((candidate) => <DuplicateCandidateCard key={candidate.incident_id} incident={incident} candidate={candidate} isLinked={linkedIncidentIds.has(candidate.incident_id) && linkedIncidentIds.has(incident.id)} busyAction={busyAction} onReview={onReview} onSelectIncident={onSelectIncident} />)}</div>}
    </section>
  );
}

function RecommendedTeams({ recommendationData, selectedTeamId, onSelectTeam }) {
  const recommendations = recommendationData?.recommendations || [];
  return (
    <section className="detail-section" aria-labelledby="recommendations-title">
      <div className="detail-section-heading"><div><p className="eyebrow">ADVISORY · OPERATOR DECIDES</p><h3 id="recommendations-title">Recommended Rescue Teams</h3></div></div>
      <p>{recommendationData?.message || "Recommendation data is unavailable."}</p>
      {recommendations.length > 0 && <div className="recommendation-list">{recommendations.map((team) => (
        <article className={`recommendation-card ${selectedTeamId === team.team_id ? "selected" : ""}`} key={team.team_id}>
          <div className="recommendation-rank">#{team.rank}</div>
          <div className="recommendation-content"><div className="recommendation-heading"><strong>{team.team_name}</strong><span className={`team-state ${team.availability}`} /></div><div className="capability-badges">{team.capabilities?.map((capability) => <span key={capability}>{capability}</span>)}</div><p>{recommendationDistance(team)}</p><small>{team.explanation}</small></div>
          <button className="secondary-button" type="button" onClick={() => onSelectTeam(team.team_id)}>{selectedTeamId === team.team_id ? "Selected" : "Select"}</button>
        </article>
      ))}</div>}
      <p className="field-note">Distances use a straight-line Haversine calculation, not road distance or ETA. Recommendations never dispatch automatically.</p>
    </section>
  );
}

function IncidentDetail({ incident, teams, analysisResult, duplicateData, recommendationData, progressEvents, completionData, busyAction, actionError, successMessage, onAnalyze, onAssign, onStatus, onReviewCompletion, onReviewDuplicate, onSelectIncident }) {
  const [teamId, setTeamId] = useState("");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const availableTeams = teams.filter((team) => team.availability === "available");
  const nextStatus = incident.status === "assigned" ? "in_progress" : null;
  const latestCompletion = completionData?.reports?.[0];
  const isLinkedDuplicate = duplicateData?.role === "duplicate";

  return (
    <section className="panel detail-panel" id={`incident-${incident.id}`} aria-labelledby="detail-title">
      <div className="panel-heading detail-heading">
        <div>
          <p className="eyebrow">INCIDENT {incident.id}</p>
          <h2 id="detail-title">{incident.emergency_type}</h2>
          <p>Reported {formatDate(incident.created_at)}</p>
        </div>
        <span className={`status ${incident.status.replaceAll("_", "-")}`}>{statusLabel(incident.status)}</span>
      </div>
      {actionError && <div className="alert error" role="alert">{actionError}</div>}
      {successMessage && <div className="alert success" role="status">{successMessage}</div>}
      <div className="detail-grid">
        <div><span>Description</span><p>{incident.description}</p></div>
        <div><span>Location</span><p>{incident.location_text || "No written location"}</p>{hasCoordinates(incident) && <small>{incident.latitude}, {incident.longitude}</small>}</div>
        <div><span>Assigned team</span><p>{incident.assigned_team?.team_name || "Not assigned"}</p></div>
        <div><span>Last updated</span><p>{formatDate(incident.updated_at)}</p></div>
        {incident.assignment && <div><span>Assignment notification</span><p>{incident.assignment.notification_acknowledged_at ? `Acknowledged ${formatDate(incident.assignment.notification_acknowledged_at)}` : incident.assignment.notification_read_at ? `Read ${formatDate(incident.assignment.notification_read_at)}` : "Unread by team"}</p></div>}
        {incident.assignment && <div><span>Field progress</span><p>{progressLabel(incident.assignment.progress_status)}</p></div>}
      </div>

      <AnalysisPanel incident={incident} analysisResult={analysisResult} isAnalyzing={busyAction === "analyze"} onAnalyze={onAnalyze} onSelectIncident={onSelectIncident} />

      <DuplicateReviewPanel incident={incident} duplicateData={duplicateData} busyAction={busyAction} onReview={onReviewDuplicate} onSelectIncident={onSelectIncident} />

      <RecommendedTeams recommendationData={recommendationData} selectedTeamId={teamId} onSelectTeam={setTeamId} />

      <section className="detail-section" aria-labelledby="response-title">
        <div className="detail-section-heading"><div><p className="eyebrow">HUMAN DECISION</p><h3 id="response-title">Response management</h3></div></div>
        {incident.status === "pending" && !isLinkedDuplicate && (
          <div className="assignment-controls">
            <label className="review-check"><input type="checkbox" checked={reviewConfirmed} onChange={(event) => setReviewConfirmed(event.target.checked)} /> I reviewed the incident report and any AI recommendation.</label>
            <label htmlFor="team-select">Available rescue team</label>
            <select id="team-select" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
              <option value="">Select a team</option>
              {availableTeams.map((team) => <option key={team.id} value={team.id}>{team.team_name}</option>)}
            </select>
            {availableTeams.length === 0 && <p className="field-note">No rescue teams are currently available.</p>}
            <button className="primary-button" type="button" disabled={!reviewConfirmed || !teamId || Boolean(busyAction)} onClick={() => onAssign(teamId)}>{busyAction === "assign" ? "Assigning..." : "Assign selected team"}</button>
          </div>
        )}
        {nextStatus && (
          <div className="status-controls">
            <p>The backend permits the next transition to <strong>{statusLabel(nextStatus)}</strong>.</p>
            <button className="primary-button" type="button" disabled={Boolean(busyAction)} onClick={() => onStatus(nextStatus)}>{busyAction === "status" ? "Updating..." : `Mark ${statusLabel(nextStatus)}`}</button>
          </div>
        )}
        {incident.status === "resolved" && <div className="empty-state compact">This incident is resolved. Its assigned team has been released by the backend.</div>}
      </section>

      <section className="detail-section" aria-labelledby="progress-title">
        <div className="detail-section-heading"><div><p className="eyebrow">FIELD HISTORY</p><h3 id="progress-title">Progress timeline</h3></div></div>
        {progressEvents.length === 0 ? <div className="empty-state compact">The assigned team has not submitted progress yet.</div> : <div className="timeline">{progressEvents.map((event) => <div className="timeline-event" key={event.id}><span /><div><strong>{progressLabel(event.progress_status)}</strong><small>{formatDate(event.created_at)} · {event.reported_by_name}</small>{event.notes && <p>{event.notes}</p>}</div></div>)}</div>}
      </section>

      <section className="detail-section" aria-labelledby="completion-title">
        <div className="detail-section-heading"><div><p className="eyebrow">OPERATOR VERIFICATION</p><h3 id="completion-title">Completion report</h3></div></div>
        {!latestCompletion ? <div className="empty-state compact">No completion report has been submitted.</div> : <div className="completion-review"><div className="detail-grid"><div><span>Submitted by</span><p>{latestCompletion.submitted_by_name}</p></div><div><span>People assisted</span><p>{latestCompletion.people_assisted ?? "Not stated"}</p></div><div><span>Review status</span><p>{latestCompletion.review_status}</p></div><div><span>Submitted</span><p>{formatDate(latestCompletion.submitted_at)}</p></div></div><h4>Completion summary</h4><p>{latestCompletion.completion_summary}</p>{latestCompletion.reason && <div className="alert error">Rejection reason: {latestCompletion.reason}</div>}{latestCompletion.review_status === "pending" && <div className="review-actions"><button className="primary-button" type="button" disabled={Boolean(busyAction)} onClick={() => onReviewCompletion("approve")}>Approve and resolve</button><label htmlFor="rejection-reason">Reason required to reject</label><textarea id="rejection-reason" rows="3" maxLength="2000" value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} /><button className="secondary-button" type="button" disabled={Boolean(busyAction) || rejectionReason.trim().length < 5} onClick={() => onReviewCompletion("reject", rejectionReason)}>Reject completion</button></div>}<p className="field-note">Evidence photos are not supported in this version; the completion summary is the reviewable evidence.</p></div>}
      </section>
    </section>
  );
}

function Dashboard({ session, onLogout }) {
  const [incidents, setIncidents] = useState([]);
  const [teams, setTeams] = useState([]);
  const [stats, setStats] = useState(null);
  const [selectedId, setSelectedId] = useState("");
  const [selectedIncident, setSelectedIncident] = useState(null);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [duplicateData, setDuplicateData] = useState({ role: "independent", candidates: [], links: [] });
  const [recommendationData, setRecommendationData] = useState({ assignment_allowed: false, recommendations: [], message: "Select an incident to view recommendations." });
  const [progressEvents, setProgressEvents] = useState([]);
  const [completionData, setCompletionData] = useState({ reports: [], evidence_photos_supported: false });
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [pageError, setPageError] = useState("");
  const [actionError, setActionError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);

  const handleError = useCallback((error, fallback) => {
    if (error instanceof ApiError && error.status === 401) {
      onLogout("Your session expired. Sign in again.");
      return true;
    }
    setPageError(apiMessage(error, fallback));
    return false;
  }, [onLogout]);

  const refreshDashboard = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setIsRefreshing(true);
    try {
      const [incidentData, teamData, statsData] = await Promise.all([
        listIncidents(session.token),
        listTeams(session.token),
        getDashboardStats(session.token),
      ]);
      setIncidents(incidentData.incidents);
      setTeams(teamData);
      setStats(statsData);
      setLastUpdated(new Date());
      setPageError("");
      setSelectedId((current) => current || incidentData.incidents[0]?.id || "");
    } catch (error) {
      handleError(error, "Could not load rescue operations data.");
    } finally {
      setIsInitialLoading(false);
      setIsRefreshing(false);
    }
  }, [handleError, session.token]);

  useEffect(() => {
    const initialRefreshId = window.setTimeout(() => refreshDashboard(), 0);
    const intervalId = window.setInterval(() => refreshDashboard({ quiet: true }), incidentPollMs);
    return () => {
      window.clearTimeout(initialRefreshId);
      window.clearInterval(intervalId);
    };
  }, [refreshDashboard]);

  const loadSelectedIncident = useCallback(async (incidentId) => {
    if (!incidentId) {
      setSelectedIncident(null);
      return;
    }
    setIsDetailLoading(true);
    setActionError("");
    try {
      const [incident, nextProgressEvents, nextCompletionData, nextDuplicateData, nextRecommendationData] = await Promise.all([
        getIncident(session.token, incidentId),
        getIncidentProgress(session.token, incidentId),
        getIncidentCompletion(session.token, incidentId),
        getIncidentDuplicates(session.token, incidentId),
        getTeamRecommendations(session.token, incidentId),
      ]);
      setSelectedIncident(incident);
      setProgressEvents(nextProgressEvents);
      setCompletionData(nextCompletionData);
      setDuplicateData(nextDuplicateData);
      setRecommendationData(nextRecommendationData);
      setAnalysisResult(null);
      if (incident.latest_analysis) {
        const analysis = await getIncidentAnalysis(session.token, incidentId);
        setAnalysisResult({ analysis, possible_duplicates: [] });
      }
    } catch (error) {
      if (!handleError(error, "Could not load incident details.")) setActionError(apiMessage(error, "Could not load incident details."));
    } finally {
      setIsDetailLoading(false);
    }
  }, [handleError, session.token]);

  useEffect(() => {
    const loadId = window.setTimeout(() => loadSelectedIncident(selectedId), 0);
    return () => window.clearTimeout(loadId);
  }, [loadSelectedIncident, selectedId]);

  function selectIncident(incidentId) {
    setActionError("");
    setSuccessMessage("");
    setSelectedId(incidentId);
    window.setTimeout(() => document.getElementById(`incident-${incidentId}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  async function runAction(action, operation, successFallback) {
    setBusyAction(action);
    setActionError("");
    setSuccessMessage("");
    try {
      const result = await operation();
      setSuccessMessage(result?.message || successFallback);
      await refreshDashboard({ quiet: true });
      await loadSelectedIncident(selectedId);
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) handleError(error, "The operation failed.");
      else setActionError(apiMessage(error, "The operation failed."));
      return null;
    } finally {
      setBusyAction("");
    }
  }

  async function handleAnalyze() {
    const result = await runAction("analyze", () => analyzeIncident(session.token, selectedId), "Advisory analysis completed.");
    if (result) setAnalysisResult(result);
  }

  async function handleAssign(teamId) {
    await runAction("assign", () => assignTeam(session.token, selectedId, teamId), "Rescue team assigned.");
  }

  async function handleStatus(status) {
    await runAction("status", () => updateIncidentStatus(session.token, selectedId, status), "Incident status updated.");
  }

  async function handleReviewCompletion(decision, reason = "") {
    await runAction(`completion-${decision}`, () => reviewCompletion(session.token, selectedId, decision, reason), decision === "approve" ? "Completion approved." : "Completion rejected.");
  }

  async function handleReviewDuplicate(duplicateIncidentId, review) {
    await runAction("duplicate-review", () => reviewIncidentDuplicate(session.token, selectedId, duplicateIncidentId, review), review.decision === "confirmed" ? "Duplicate incidents linked." : "Potential duplicate rejected.");
  }

  async function handleSaveTeam(teamId, payload) {
    try {
      const result = teamId
        ? await updateTeam(session.token, teamId, payload)
        : await createTeam(session.token, payload);
      await refreshDashboard({ quiet: true });
      if (selectedId) await loadSelectedIncident(selectedId);
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) handleError(error, "The team update failed.");
      throw error;
    }
  }

  const summary = [
    { label: "Total Incidents", value: stats?.total_incidents ?? 0, caption: "Stored reports" },
    { label: "Critical Cases", value: stats?.critical_recommendations ?? 0, caption: "AI recommendations" },
    { label: "In Progress", value: stats?.in_progress ?? 0, caption: "Active responses" },
    { label: "Available Teams", value: stats?.available_teams ?? 0, caption: "Ready to assign" },
  ];
  const total = Math.max(stats?.total_incidents || 0, 1);
  const responseCounts = ["pending", "assigned", "in_progress", "resolved"];

  if (isInitialLoading) return <main className="loading-page"><div className="loading-spinner" /><h1>Loading RescueGrid operations...</h1><p>Connecting to incidents, teams, and response data.</p></main>;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><span className="brand-icon">R</span><div><h2>RescueGrid AI</h2><p>Disaster Response</p></div></div>
        <nav className="navigation"><a className="nav-link active" href="#overview">Dashboard</a><a className="nav-link" href="#incidents">Incidents</a><a className="nav-link" href="#map">Rescue Map</a><a className="nav-link" href="#teams">Rescue Teams</a></nav>
        <div className="sidebar-note"><span className="status-dot" /><div><strong>Live API connected</strong><p>Refreshes every {Math.round(incidentPollMs / 1000)} seconds</p></div></div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div><p className="eyebrow">EMERGENCY OPERATIONS</p><h1>Rescue Dashboard</h1><p className="subtitle">Monitor incidents and coordinate rescue operations.</p></div>
          <div className="operator-actions"><div><strong>{session.user.name}</strong><small>{session.user.role}</small></div><button className="secondary-button" type="button" onClick={() => refreshDashboard()} disabled={isRefreshing}>{isRefreshing ? "Refreshing..." : "Refresh"}</button><button className="text-button" type="button" onClick={() => onLogout("")}>Sign out</button></div>
        </header>
        {pageError && <div className="alert error page-alert" role="alert">{pageError} <button type="button" className="link-button" onClick={() => refreshDashboard()}>Retry</button></div>}
        <p className="refresh-note" aria-live="polite">{lastUpdated ? `Last refreshed ${lastUpdated.toLocaleTimeString()}` : "Waiting for first refresh"}</p>

        <section id="overview" className="summary-grid">
          {summary.map((item) => <article className="summary-card" key={item.label}><div className="summary-top"><span>{item.label}</span></div><strong className="summary-value">{item.value}</strong><span className="summary-caption">{item.caption}</span></article>)}
        </section>

        <section className="content-grid">
          <article id="map" className="panel map-panel"><div className="panel-heading"><div><h2>Incident Map</h2><p>Real GPS coordinates from public SOS reports</p></div><span className="coming-soon">LIVE MAP</span></div><IncidentMap incidents={incidents} onSelect={selectIncident} /><div className="map-legend">{Object.entries(URGENCY_COLORS).map(([urgency, color]) => <span key={urgency}><i className="legend-dot" style={{ background: color }} /> {urgency}</span>)}</div></article>
          <article className="panel response-panel"><div className="panel-heading"><div><h2>Response Overview</h2><p>Live incident status summary</p></div></div>{responseCounts.map((status) => <div className="response-item" key={status}><div><span>{statusLabel(status)}</span><strong>{stats?.[status] ?? 0}</strong></div><div className="progress-track"><span className={`progress-fill ${status.replaceAll("_", "-")}-fill`} style={{ width: `${Math.round(((stats?.[status] || 0) / total) * 100)}%` }} /></div></div>)}<div className="human-review"><span>INFO</span><p>AI recommendations support decisions. Coordinators retain final control.</p></div></article>
        </section>

        <section id="incidents" className="panel incidents-panel">
          <div className="panel-heading"><div><h2>Recent Incidents</h2><p>Automatically refreshed from PostgreSQL through the API.</p></div><span className="incident-count">{incidents.length} shown</span></div>
          {incidents.length === 0 ? <div className="empty-state">No incidents have been reported.</div> : <div className="incident-list">{incidents.map((incident) => { const urgency = urgencyFor(incident); return <article className={`incident-row ${selectedId === incident.id ? "selected" : ""}`} key={incident.id}><button type="button" className="incident-select" onClick={() => selectIncident(incident.id)}><span className="incident-symbol">!</span><span className="incident-details"><span className="incident-title-line"><strong>{incident.emergency_type}</strong><span className={`urgency ${urgency}`}>{urgency}</span>{incident.duplicate_role === "duplicate" && <span className="linked-badge">Linked duplicate</span>}{incident.duplicate_role === "primary" && <span className="linked-badge">Primary · {incident.linked_incident_count} linked</span>}</span><span className="incident-description">{incident.description}</span><span className="incident-location">{incident.location_text || (hasCoordinates(incident) ? `${incident.latitude}, ${incident.longitude}` : "Location unavailable")}</span></span><span className={`status ${incident.linked_resolution_verified_at ? "resolved" : incident.status.replaceAll("_", "-")}`}>{incident.linked_resolution_verified_at ? "Verified Resolved" : statusLabel(incident.status)}</span></button></article>; })}</div>}
        </section>

        {isDetailLoading && <section className="panel detail-panel"><div className="empty-state">Loading incident details...</div></section>}
        {!isDetailLoading && selectedIncident && <IncidentDetail key={selectedIncident.id} incident={selectedIncident} teams={teams} analysisResult={analysisResult} duplicateData={duplicateData} recommendationData={recommendationData} progressEvents={progressEvents} completionData={completionData} busyAction={busyAction} actionError={actionError} successMessage={successMessage} onAnalyze={handleAnalyze} onAssign={handleAssign} onStatus={handleStatus} onReviewCompletion={handleReviewCompletion} onReviewDuplicate={handleReviewDuplicate} onSelectIncident={selectIncident} />}

        <TeamManagement session={session} teams={teams} onSave={handleSaveTeam} />
        <footer className="footer"><span>RescueGrid AI — Rescue Coordination Platform</span><span>Live backend data · Human review required</span></footer>
      </main>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(readOperatorSession);
  const [authMessage, setAuthMessage] = useState("");

  const handleLogin = useCallback((auth) => {
    const nextSession = { token: auth.token, user: auth.user };
    saveOperatorSession(nextSession);
    setSession(nextSession);
    setAuthMessage("");
  }, []);

  const handleLogout = useCallback((message = "") => {
    clearOperatorSession();
    setSession(null);
    setAuthMessage(message);
  }, []);

  if (!session) return <LoginScreen message={authMessage} onLogin={handleLogin} />;
  return session.user.role === "responder"
    ? <ResponderDashboard session={session} onLogout={handleLogout} />
    : <Dashboard session={session} onLogout={handleLogout} />;
}
