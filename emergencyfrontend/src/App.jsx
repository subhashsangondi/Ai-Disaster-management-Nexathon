import { useState } from "react";
import { Activity, ArrowUpRight, CheckCircle2, Clock3, ShieldCheck, Users } from "lucide-react";
import EmergencyReportForm from "./components/EmergencyReportForm.jsx";

const responseStages = [
  { label: "Report submitted", values: ["submitted", "received", "pending", "open"] },
  { label: "Rescue team assigned", values: ["assigned", "team_assigned", "dispatched"] },
  { label: "Rescue team on the way", values: ["en_route", "on_the_way", "responding", "in_progress"] },
  { label: "Incident resolved", values: ["resolved", "closed", "complete", "completed"] },
];

function normalizeStatus(status) {
  return (status || "").toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
}

function getReportedStage(status) {
  const normalized = normalizeStatus(status);
  if (!normalized) return 0;
  const stageIndex = responseStages.findIndex((stage, index) =>
    index > 0 && stage.values.includes(normalized),
  );
  return Math.max(stageIndex, 0);
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
  const isConfirmed = incidentProgress?.id !== undefined;
  const reportedStage = isConfirmed ? getReportedStage(incidentProgress.status) : -1;
  const reportedAt = incidentProgress?.reportedAt || "";
  const confirmedStatusLabel = isConfirmed
    ? responseStages[reportedStage].label
    : "";

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
                  <ol className="mt-5 space-y-4" aria-label="Rescue response progress">
                    {responseStages.map((stage, index) => {
                      const isComplete = index <= reportedStage;
                      const isCurrent = index === reportedStage;
                      return (
                        <li key={stage.label} className="flex items-center gap-3">
                          <span className={`flex size-6 shrink-0 items-center justify-center rounded-full border text-xs ${isComplete ? "border-emerald-300 bg-emerald-400 text-[#102238]" : "border-white/20 text-slate-500"}`}>
                            {isComplete ? <CheckCircle2 aria-hidden="true" size={15} /> : index + 1}
                          </span>
                          <span className={`text-sm ${isCurrent ? "font-semibold text-white" : isComplete ? "text-emerald-200" : "text-slate-400"}`}>
                            {stage.label}
                            {isCurrent && <span className="sr-only"> (current status)</span>}
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                  <p className="mt-5 border-t border-white/10 pt-4 text-xs leading-5 text-slate-400">
                    Response progress is based on the latest status returned by the server.
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
                    Team assignment and travel updates appear only when confirmed by the response service.
                  </div>
                </>
              )}
            </div>

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
