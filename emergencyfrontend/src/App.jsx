import { useState } from "react";
import { Activity, ArrowUpRight, ShieldCheck } from "lucide-react";
import EmergencyReportForm from "./components/EmergencyReportForm.jsx";
import IncidentTracker from "./components/IncidentTracker.jsx";
import QuickSos from "./components/QuickSos.jsx";

export default function App() {
  const [incidentProgress, setIncidentProgress] = useState(null);
  const [view, setView] = useState("report");
  // Once a report is confirmed, its status lives only in the "Your SOS Status" card of the form that sent it.
  const isConfirmed = incidentProgress?.id !== undefined;
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
          <span className="font-medium text-slate-700">{view === "report" ? "Emergency report" : "Track incident"}</span>
        </div>

        <div className="mb-7 inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm" aria-label="Public portal sections">
          <button type="button" aria-pressed={view === "report"} onClick={() => setView("report")} className={`min-h-11 rounded-lg px-4 py-2 text-sm font-semibold ${view === "report" ? "bg-[#102238] text-white" : "text-slate-600 hover:bg-slate-50"}`}>Report emergency</button>
          <button type="button" aria-pressed={view === "track"} onClick={() => setView("track")} className={`min-h-11 rounded-lg px-4 py-2 text-sm font-semibold ${view === "track" ? "bg-[#102238] text-white" : "text-slate-600 hover:bg-slate-50"}`}>Track incident</button>
        </div>

        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-12">
          <section aria-labelledby="page-title">
            <div className="mb-6">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-orange-800">
                <span className="size-1.5 rounded-full bg-orange-500" />
                Community help starts here
              </div>
              <h1 id="page-title" className="text-3xl font-bold tracking-tight text-[#101d2e] sm:text-4xl">{view === "report" ? "Report an Emergency" : "Track Your Incident"}</h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
                {view === "report" ? "Send a Quick SOS with just your location, or add details in a full report if you have time." : "Status access requires the private token issued when your report was submitted."}
              </p>
            </div>
            {/* Both views stay mounted so switching tabs never discards a just-issued tracking token. */}
            <div className="space-y-6" hidden={view !== "report"}>
              <QuickSos onProgressChange={setIncidentProgress} />
              <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500" aria-hidden="true">
                <span className="h-px flex-1 bg-slate-200" /> or send a detailed report <span className="h-px flex-1 bg-slate-200" />
              </div>
              <EmergencyReportForm onProgressChange={setIncidentProgress} />
            </div>
            <div hidden={view !== "track"}>
              <IncidentTracker />
            </div>
          </section>

          <aside className="space-y-5 lg:sticky lg:top-6 lg:pt-2">
            {!isConfirmed && (
              <div className="rounded-2xl bg-[#102238] p-6 text-white shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/10 text-orange-300">
                    <ShieldCheck aria-hidden="true" size={21} />
                  </span>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Before you report</p>
                    <h2 className="mt-0.5 text-lg font-semibold">
                      {incidentProgress?.phase === "submitting" ? "Sending report..." : "Ready when you are"}
                    </h2>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-6 text-slate-300">
                  {incidentProgress?.phase === "submitting"
                    ? "Waiting for the reporting service to confirm your report."
                    : incidentProgress?.phase === "error"
                      ? "The server has not confirmed this report yet. You can try again."
                      : "After you send your report, its status and private tracking token will appear with your confirmation."}
                </p>
                <div className="mt-5 flex items-start gap-2 border-t border-white/10 pt-4 text-xs leading-5 text-slate-400">
                  <ArrowUpRight aria-hidden="true" className="mt-0.5 shrink-0 text-orange-300" size={15} />
                  Rescue-team assignment is managed by authenticated operators. Victims can view safe status updates with a private tracking token.
                </div>
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
          <p>Hackathon demo: not connected to official emergency services. In India, call <a href="tel:112" className="font-semibold underline">112</a> in a real emergency.</p>
        </div>
      </footer>
    </div>
  );
}
