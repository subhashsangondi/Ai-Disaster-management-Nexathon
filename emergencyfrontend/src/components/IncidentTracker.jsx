import { useEffect, useState } from "react";
import { AlertCircle, Clock3, LoaderCircle, Search, ShieldCheck } from "lucide-react";
import { trackIncident } from "../services/incidents.js";

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function IncidentTracker({ initialToken = "", onVerifiedIncident }) {
  const [token, setToken] = useState(initialToken);
  const [incident, setIncident] = useState(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => setToken(initialToken), [initialToken]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (isLoading) return;
    setIsLoading(true);
    setError("");
    setIncident(null);
    try {
      const verifiedIncident = await trackIncident(token);
      setIncident(verifiedIncident);
      onVerifiedIncident?.(verifiedIncident);
    } catch (trackingError) {
      setError(trackingError instanceof Error ? trackingError.message : "Status could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8" aria-labelledby="tracking-title">
      <div className="mb-5 flex items-start gap-3 border-b border-slate-100 pb-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><ShieldCheck aria-hidden="true" size={21} /></span>
        <div><h2 id="tracking-title" className="text-xl font-bold text-slate-900">Secure incident tracking</h2><p className="mt-1 text-sm leading-6 text-slate-600">Use the private token shown after your SOS was accepted. An incident ID by itself cannot be used.</p></div>
      </div>
      <form onSubmit={handleSubmit}>
        <label htmlFor="tracking-token" className="mb-1.5 block text-sm font-medium text-slate-800">Tracking token</label>
        <textarea id="tracking-token" rows="3" value={token} onChange={(event) => setToken(event.target.value)} className="form-control resize-y font-mono" autoComplete="off" spellCheck="false" required />
        <button type="submit" disabled={isLoading || !token.trim()} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#102238] px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">{isLoading ? <LoaderCircle className="animate-spin" size={18} /> : <Search size={18} />}{isLoading ? "Checking status..." : "Check incident status"}</button>
      </form>
      {error && <div role="alert" className="mt-5 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><AlertCircle className="mt-0.5 shrink-0" size={18} /><p>{error}</p></div>}
      {incident && <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 p-5" aria-live="polite"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-emerald-800">{incident.emergency_type}</p><h3 className="mt-1 text-lg font-bold capitalize text-slate-900">{incident.status.replaceAll("_", " ")}</h3></div><span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-emerald-800">Verified status</span></div><p className="mt-4 break-all font-mono text-xs text-slate-600">Reference: {incident.incident_reference}</p><div className="mt-4 space-y-2">{incident.progress_messages.map((message) => <p key={message} className="text-sm leading-6 text-slate-700">{message}</p>)}</div><p className="mt-4 flex items-center gap-1.5 text-xs text-slate-500"><Clock3 size={14} /> Last updated {formatDate(incident.last_updated_at)}</p></div>}
    </section>
  );
}
