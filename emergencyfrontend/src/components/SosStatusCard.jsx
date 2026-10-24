import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Clock3, Copy, Eye, EyeOff, LoaderCircle, RefreshCw, ShieldCheck } from "lucide-react";
import { trackIncident } from "../services/incidents.js";

// Labels for the public statuses returned by the backend. Unknown values are shown as received.
const STATUS_LABELS = {
  pending: "Received",
  assigned: "Rescue team assigned",
  in_progress: "Response in progress",
  resolved: "Resolved",
};
const TEAM_ASSIGNED_STATUSES = new Set(["assigned", "in_progress"]);

function normalizeStatus(status) {
  return String(status || "").trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
}

function statusLabel(status) {
  return STATUS_LABELS[status] || status.replaceAll("_", " ") || "Received";
}

function formatDate(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function maskToken(token) {
  return `•••• ${token.slice(-4)}`;
}

function PrivateToken({ token }) {
  const [visible, setVisible] = useState(true);
  const [copyState, setCopyState] = useState("");

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(token);
      setCopyState("copied");
    } catch {
      setVisible(true);
      setCopyState("failed");
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-blue-800">
        <ShieldCheck aria-hidden="true" size={14} /> Private tracking token
      </p>
      <p className="mt-2 break-all font-mono text-sm font-semibold text-slate-900" data-testid="tracking-token-value">
        {visible ? token : maskToken(token)}
      </p>
      <p className="mt-2 text-xs leading-5 text-slate-700">
        Keep this token private, like a password. It is the only way to check this SOS later; the incident reference alone cannot be used. It is not saved on this device.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={copy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#102238] px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#102238]">
          <Copy aria-hidden="true" size={16} /> Copy token
        </button>
        <button type="button" onClick={() => setVisible((current) => !current)} aria-pressed={!visible} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#102238]">
          {visible ? <EyeOff aria-hidden="true" size={16} /> : <Eye aria-hidden="true" size={16} />}
          {visible ? "I saved it — hide token" : "Show token"}
        </button>
      </div>
      <p role="status" className="mt-2 text-xs font-medium text-slate-700">
        {copyState === "copied" ? "Token copied. Paste it somewhere private." : copyState === "failed" ? "Copying is not available here. Select the token above and copy it manually." : ""}
      </p>
    </div>
  );
}

// The single post-submission status view. Status updates come only from the token-verified
// tracking endpoint; nothing here infers team assignment or progress.
export default function SosStatusCard({ incident }) {
  const { id, trackingToken = "", submissionMode = "detailed", reportedAt = "" } = incident;
  const [verified, setVerified] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    if (!trackingToken || lock.current) return;
    lock.current = true;
    setLoading(true);
    setError("");
    try {
      const result = await trackIncident(trackingToken);
      if (!mounted.current) return;
      // Never show another incident's status in this card.
      if (String(result?.incident_reference) !== String(id)) throw new Error("The status returned did not match this SOS. Please try again.");
      setVerified(result);
    } catch (refreshError) {
      if (!mounted.current) return;
      setError(refreshError instanceof Error ? refreshError.message : "Status could not be loaded. Please try again.");
    } finally {
      lock.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [id, trackingToken]);

  useEffect(() => {
    mounted.current = true;
    refresh();
    return () => { mounted.current = false; };
  }, [refresh]);

  const status = normalizeStatus(verified?.status || incident.status || "pending");
  const mode = verified?.submission_mode || submissionMode;
  const awaitingTriage = mode === "quick_sos" && status === "pending";
  const teamAssigned = Boolean(verified) && TEAM_ASSIGNED_STATUSES.has(status);
  const messages = Array.isArray(verified?.progress_messages) ? verified.progress_messages : [];
  const latestMessage = messages[messages.length - 1] || "";

  return (
    <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4 sm:p-5" aria-labelledby={`sos-status-title-${id}`} aria-busy={loading}>
      <h3 id={`sos-status-title-${id}`} className="text-lg font-bold text-slate-900">Your SOS Status</h3>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-slate-50 p-3 sm:col-span-2">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current status</dt>
          <dd className="mt-1 text-base font-bold text-slate-900" aria-live="polite">{statusLabel(status)}</dd>
          {awaitingTriage && <dd className="mt-1 text-sm font-medium text-amber-800">Awaiting operator triage</dd>}
          {teamAssigned
            ? <dd className="mt-1 flex items-center gap-1.5 text-sm font-medium text-emerald-700"><CheckCircle2 aria-hidden="true" size={15} /> A rescue team has been assigned.</dd>
            : status === "pending" && <dd className="mt-1 text-sm text-slate-600">No rescue team has been assigned yet.</dd>}
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Incident reference</dt>
          <dd className="mt-1 break-all font-mono text-sm font-semibold text-slate-900">{id}</dd>
        </div>
        <div className="rounded-lg bg-slate-50 p-3">
          <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><Clock3 aria-hidden="true" size={13} /> Submitted</dt>
          <dd className="mt-1 text-sm font-semibold text-slate-900">{formatDate(verified?.submitted_at || reportedAt)}</dd>
        </div>
      </dl>

      {trackingToken ? (
        <>
          <div className="mt-4 rounded-lg border border-slate-200 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Latest verified update</p>
            {latestMessage
              ? <>
                <p className="mt-1 text-sm leading-6 text-slate-800">{latestMessage}</p>
                <p className="mt-1 text-xs text-slate-500">Updated {formatDate(verified.last_updated_at)}</p>
              </>
              : <p className="mt-1 text-sm text-slate-600">{loading ? "Checking for updates..." : "No verified update loaded yet."}</p>}
          </div>

          {error && (
            <div role="alert" className="mt-3 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <AlertCircle aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
              <p>Status could not be refreshed. {error} Your SOS is still saved.</p>
            </div>
          )}

          <button type="button" onClick={refresh} disabled={loading} className="mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-base font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#102238] disabled:cursor-wait disabled:opacity-70">
            {loading ? <LoaderCircle aria-hidden="true" className="animate-spin" size={18} /> : <RefreshCw aria-hidden="true" size={18} />}
            {loading ? "Refreshing status..." : "Refresh Status"}
          </button>

          <PrivateToken token={trackingToken} />
        </>
      ) : (
        <p className="mt-4 text-sm text-slate-600">No private tracking token was issued for this report, so status updates cannot be shown here.</p>
      )}
    </section>
  );
}
