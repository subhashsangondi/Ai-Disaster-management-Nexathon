import { useEffect, useState } from "react";
import { Activity, ArrowUpRight, CheckCircle2, Clock3, ShieldCheck } from "lucide-react";
import EmergencyReportForm from "./components/EmergencyReportForm.jsx";
import { listPendingSOS, retryPendingSOS, sosQueueChangedEvent, sosReceivedEvent } from "./services/offlineSos.js";

const RETRY_BASE_DELAY_MS = 5000;

function normalizeStatus(status) {
  return (status || "").toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
}

function formatReportedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function App() {
  const [incidentProgress, setIncidentProgress] = useState(null);
  const [pendingSOSCount, setPendingSOSCount] = useState(0);
  const [attentionSOSCount, setAttentionSOSCount] = useState(0);
  const [unknownAttentionCount, setUnknownAttentionCount] = useState(0);
  const isConfirmed = incidentProgress?.id !== undefined;
  const reportedAt = incidentProgress?.reportedAt || "";
  const confirmedStatusLabel = isConfirmed
    ? normalizeStatus(incidentProgress.status || "pending").replaceAll("_", " ")
    : "";

  useEffect(() => {
    let isMounted = true;
    let retryTimer;

    async function refreshQueue({ retry = false, force = false } = {}) {
      try {
        if (retry && navigator.onLine !== false) await retryPendingSOS({ force });
        const reports = await listPendingSOS();
        if (isMounted) {
          setPendingSOSCount(reports.length);
          setAttentionSOSCount(reports.filter((report) => report.status === "needs-attention").length);
          setUnknownAttentionCount(reports.filter((report) => report.status === "needs-attention" && report.deliveryUnknown).length);
        }
        window.clearTimeout(retryTimer);
        const retryableReports = reports.filter((report) => report.status === "pending");
        if (isMounted && retryableReports.length > 0 && navigator.onLine !== false) {
          const nextRetryAt = Math.min(...retryableReports.map((report) => (
            report.nextAttemptAt ? Date.parse(report.nextAttemptAt) : Date.now() + RETRY_BASE_DELAY_MS
          )));
          retryTimer = window.setTimeout(
            () => { void refreshQueue({ retry: true }); },
            Math.max(1000, nextRetryAt - Date.now()),
          );
        }
      } catch {
        window.clearTimeout(retryTimer);
        if (isMounted) {
          setPendingSOSCount(0);
          setAttentionSOSCount(0);
          setUnknownAttentionCount(0);
        }
      }
    }

    const handleOnline = () => { void refreshQueue({ retry: true, force: true }); };
    const handleQueueChange = () => { void refreshQueue(); };
    const handleReceived = (event) => {
      if (!event.detail?.response) return;
      setIncidentProgress({ ...event.detail.response, reportedAt: new Date().toISOString() });
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener(sosQueueChangedEvent, handleQueueChange);
    window.addEventListener(sosReceivedEvent, handleReceived);
    void refreshQueue({ retry: true });

    return () => {
      isMounted = false;
      window.clearTimeout(retryTimer);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener(sosQueueChangedEvent, handleQueueChange);
      window.removeEventListener(sosReceivedEvent, handleReceived);
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#f4f6f8] text-slate-900">
      <header className="border-b border-white/10 bg-[#0b1727] text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8">
          <a href="#main" className="flex items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-300">
            <span className="flex size-10 items-center justify-center rounded-xl bg-orange-500 text-white shadow-lg shadow-orange-950/30">
              <Activity aria-hidden="true" size={23} strokeWidth={2.5} />
            </span>
            <span className="leading-tight">
              <span className="block text-lg font-bold tracking-tight">RescueGrid <span className="text-orange-400">AI</span></span>
              <span className="mt-0.5 block text-xs text-slate-400">Community emergency response</span>
            </span>
          </a>
          <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 sm:flex">
            <span className="size-2 rounded-full bg-emerald-400" />
            Public reporting portal
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-7xl px-5 pb-14 pt-8 sm:px-8 sm:pt-12">
        <div className="mb-8 flex flex-wrap items-center gap-2 text-sm text-slate-500" aria-label="Breadcrumb">
          <span>RescueGrid AI</span>
          <span aria-hidden="true">/</span>
          <span className="font-medium text-slate-700">Emergency report</span>
        </div>

        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12">
          <section aria-labelledby="page-title">
            <div className="mb-6">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-orange-800">
                <span className="size-1.5 rounded-full bg-orange-500" />
                Community help starts here
              </div>
              <h1 id="page-title" className="text-3xl font-bold tracking-tight text-[#101d2e] sm:text-4xl">
                Report an Emergency
              </h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
                Choose the emergency and location first. Add details only if you have time.
              </p>
            </div>
            <EmergencyReportForm onProgressChange={setIncidentProgress} />
          </section>

          <aside className="space-y-5 lg:sticky lg:top-6 lg:pt-2">
            <div className="rounded-2xl bg-[#102238] p-6 text-white shadow-sm">
              <div className="flex items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-orange-300">
                  {isConfirmed ? <CheckCircle2 aria-hidden="true" size={21} /> : <ShieldCheck aria-hidden="true" size={21} />}
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Incident status</p>
                  <h2 className="mt-0.5 text-lg font-semibold">
                    {isConfirmed ? confirmedStatusLabel : incidentProgress?.phase === "submitting" ? "Sending report..." : "Ready when you are"}
                  </h2>
                </div>
              </div>
              {isConfirmed ? (
                <>
                  <div className="mt-5 rounded-xl border border-white/10 bg-white/5 p-3.5">
                    <p className="text-xs text-slate-400">Incident ID</p>
                    <p className="mt-1 break-all font-mono text-sm font-semibold">{incidentProgress.id}</p>
                    {reportedAt && (
                      <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-300">
                        <Clock3 aria-hidden="true" size={13} />
                        {formatReportedAt(reportedAt)}
                      </p>
                    )}
                  </div>
                  <p className="mt-5 border-t border-white/10 pt-4 text-xs leading-5 text-slate-400">
                    The public portal confirms receipt only. Live status tracking is not available through the public API.
                  </p>
                </>
              ) : (
                <>
                  <p className="mt-3 text-sm leading-6 text-slate-300">
                    {incidentProgress?.phase === "submitting"
                      ? "Waiting for the reporting service to confirm your report."
                      : incidentProgress?.phase === "error"
                        ? "The server has not confirmed this report yet. You can try again."
                        : "After you send your report, its confirmed status and response progress will appear here."}
                  </p>
                  <div className="mt-5 flex items-start gap-2 border-t border-white/10 pt-4 text-xs leading-5 text-slate-400">
                    <ArrowUpRight aria-hidden="true" className="mt-0.5 shrink-0 text-orange-300" size={15} />
                    Rescue-team assignment and later status updates are available only to authenticated operators.
                  </div>
                </>
              )}
            </div>

            {pendingSOSCount > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950" role="status">
                <p className="font-semibold">{pendingSOSCount} SOS {pendingSOSCount === 1 ? "saved" : "reports saved"} on this device</p>
                <p className="mt-1 leading-5">
                  {attentionSOSCount > 0
                    ? `${attentionSOSCount} report${attentionSOSCount === 1 ? " needs" : "s need"} attention; ${unknownAttentionCount > 0 ? "receipt could not be verified for some." : "the server rejected them."}`
                    : "Waiting to send or confirm. The rescue server has not confirmed receipt."}
                </p>
              </div>
            )}

            <div className="rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="text-sm font-semibold text-slate-900">For your safety</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                If you are in immediate danger, move to a safe place if possible and contact your local emergency services directly.
              </p>
            </div>
          </aside>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-5 py-6 text-xs leading-5 text-slate-500 sm:px-8 md:flex-row md:items-center md:justify-between">
          <p>RescueGrid AI · Community emergency reporting</p>
          <p>This demo form does not itself dispatch rescue services.</p>
        </div>
      </footer>
    </div>
  );
}
