import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Clock3, ExternalLink, LoaderCircle, MapPin, Send } from "lucide-react";
import { IncidentApiError, submitIncident } from "../services/incidents.js";
import { createPendingSOS, createSOSId, deliverPendingSOS, SOSDeviceOfflineError, sosReceivedEvent } from "../services/offlineSos.js";
import { getMapLinks } from "../utils/maps.js";
import { MAX_DESCRIPTION_LENGTH, validateIncident } from "../utils/validation.js";
import LocationPicker from "./LocationPicker.jsx";

const initialValues = {
  category: "",
  description: "",
  latitude: null,
  longitude: null,
  location_text: "",
};

const categories = [
  "Medical Emergency",
  "Fire",
  "Flood",
  "Earthquake",
  "Trapped Person",
  "Road Accident",
  "Rescue Required",
  "Other",
];

function formatReportedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function EmergencyReportForm({ onProgressChange }) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [requestError, setRequestError] = useState("");
  const [deviceReportedAt, setDeviceReportedAt] = useState("");
  const [pendingReport, setPendingReport] = useState(null);
  const submissionLock = useRef(false);
  const pendingReportRef = useRef(null);

  useEffect(() => {
    function handleReceived(event) {
      if (event.detail?.id !== pendingReportRef.current?.id) return;
      setResult(event.detail.response);
      setPendingReport(null);
      setDeviceReportedAt(new Date().toISOString());
      onProgressChange?.({ ...event.detail.response, reportedAt: new Date().toISOString() });
      pendingReportRef.current = null;
    }

    window.addEventListener(sosReceivedEvent, handleReceived);
    return () => window.removeEventListener(sosReceivedEvent, handleReceived);
  }, [onProgressChange]);

  function updateValue(name, value) {
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({ ...current, [name]: undefined, location: undefined }));
    setRequestError("");
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submissionLock.current) return;

    const validationErrors = validateIncident(values);
    setErrors(validationErrors);
    setRequestError("");
    if (Object.keys(validationErrors).length > 0) return;

    const coordinatesAreValid =
      Number.isFinite(values.latitude) &&
      values.latitude >= -90 &&
      values.latitude <= 90 &&
      Number.isFinite(values.longitude) &&
      values.longitude >= -180 &&
      values.longitude <= 180;
    const payload = {
      emergency_type: values.category.trim(),
      description: values.description.trim(),
      latitude: coordinatesAreValid ? values.latitude : null,
      longitude: coordinatesAreValid ? values.longitude : null,
      location_text: values.location_text.trim() || null,
    };

    submissionLock.current = true;
    setIsSubmitting(true);
    onProgressChange?.({ phase: "submitting" });
    const submittedAt = new Date().toISOString();
    let report = pendingReportRef.current;
    const samePayload = report && JSON.stringify(report.payload) === JSON.stringify(payload);
    if (!samePayload) report = null;

    try {
      if (!report) {
        try {
          report = await createPendingSOS(payload);
          report.stored = true;
        } catch (storageError) {
          report = { id: createSOSId(), payload, stored: false };
          if (navigator.onLine === false) {
            throw new Error(`${storageError.message} The SOS has not reached the rescue server and could not be saved on this device.`);
          }
        }
        pendingReportRef.current = report;
      }

      const response = report.stored
        ? await deliverPendingSOS(report)
        : await submitIncident(report.payload, report.id);
      setDeviceReportedAt(submittedAt);
      setResult(response);
      setPendingReport(null);
      pendingReportRef.current = null;
      onProgressChange?.({ ...response, reportedAt: submittedAt });
    } catch (error) {
      if (report?.stored) {
        const needsAttention = error instanceof IncidentApiError
          && error.status >= 400 && error.status < 500 && error.status !== 429;
        const deliveryUnknown = !(error instanceof SOSDeviceOfflineError);
        const queuedReport = {
          ...report,
          status: needsAttention ? "needs-attention" : "pending",
          deliveryUnknown,
        };
        pendingReportRef.current = queuedReport;
        setPendingReport(queuedReport);
        onProgressChange?.({ phase: "waiting", reportId: report.id });
        setRequestError(needsAttention
          ? `The server did not accept this report: ${error.message}`
          : !deliveryUnknown
            ? "This SOS is saved on this device and has not been sent to the rescue server. It will retry when connectivity returns."
            : "This SOS is saved on this device. The server has not confirmed whether it received the report; it will retry safely with the same ID.");
      } else {
        onProgressChange?.({ phase: "error" });
        setRequestError(`The rescue server has not confirmed receipt and this browser could not save the SOS locally. Keep this page open and retry. ${error instanceof Error ? error.message : "The report could not be submitted."}`);
      }
    } finally {
      submissionLock.current = false;
      setIsSubmitting(false);
    }
  }

  async function retryPendingReport() {
    if (!pendingReport || submissionLock.current) return;
    submissionLock.current = true;
    setIsSubmitting(true);
    setRequestError("");
    try {
      const response = pendingReport.stored
        ? await deliverPendingSOS(pendingReport)
        : await submitIncident(pendingReport.payload, pendingReport.id);
      setDeviceReportedAt(new Date().toISOString());
      setResult(response);
      setPendingReport(null);
      pendingReportRef.current = null;
      onProgressChange?.({ ...response, reportedAt: new Date().toISOString() });
    } catch (error) {
      setRequestError(pendingReport.stored
        ? "This SOS is still saved on this device. The rescue server has not confirmed receipt. Try again when connectivity is available."
        : error instanceof Error ? error.message : "The report could not be submitted. Please try again.");
    } finally {
      submissionLock.current = false;
      setIsSubmitting(false);
    }
  }

  function resetForm() {
    setValues(initialValues);
    setErrors({});
    setResult(null);
    setRequestError("");
    setDeviceReportedAt("");
    setPendingReport(null);
    pendingReportRef.current = null;
    onProgressChange?.(null);
  }

  if (result) {
    const status = result.status || "pending";
    const mapLinks = getMapLinks(values);

    return (
      <section className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm sm:p-8" aria-live="polite" aria-labelledby="success-title">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
              <CheckCircle2 aria-hidden="true" size={25} />
            </span>
            <h2 id="success-title" className="text-xl font-bold text-slate-900">Received by server</h2>
            <p className="mt-1 text-sm text-slate-600">{result.message || "Your report was saved by RescueGrid AI."}</p>
          </div>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-semibold capitalize text-emerald-800">
            {status.replaceAll("_", " ").replaceAll("-", " ")}
          </span>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Incident ID</p>
            <p className="mt-1 break-all font-mono text-base font-semibold text-slate-900">{result.id}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><Clock3 aria-hidden="true" size={14} /> Reported at</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">{formatReportedAt(deviceReportedAt)}</p>
            <p className="mt-1 text-xs text-slate-500">Your device time</p>
          </div>
        </div>

        {mapLinks.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            {mapLinks.map((link) => (
              <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-[#173b5e] hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#102238]">
                <MapPin aria-hidden="true" size={16} />
                {link.label}
                <ExternalLink aria-hidden="true" size={14} />
              </a>
            ))}
          </div>
        )}

        <p className="mt-4 text-xs leading-5 text-slate-500">{result.notice || "This confirmation does not mean a rescue team has been dispatched. If you are in immediate danger, contact local emergency services."}</p>
        <button type="button" onClick={resetForm} className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-[#102238] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1a3655] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#102238]">
          Submit Another Report
        </button>
      </section>
    );
  }

  if (pendingReport) {
    return (
      <section className="rounded-2xl border border-amber-200 bg-white p-5 shadow-sm sm:p-8" aria-live="polite" aria-labelledby="pending-title">
        <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-amber-50 text-amber-800">
          <Clock3 aria-hidden="true" size={24} />
        </span>
        <h2 id="pending-title" className="text-xl font-bold text-slate-900">Saved on this device</h2>
        <p className="mt-2 text-sm leading-6 text-slate-700">
          {pendingReport.status === "needs-attention"
            ? pendingReport.deliveryUnknown
              ? "The server receipt could not be verified. This SOS remains saved here and needs attention."
              : "The rescue server did not accept this SOS. It remains saved here and needs attention."
            : isSubmitting
              ? "Trying to send this SOS..."
              : pendingReport.deliveryUnknown
                ? "Waiting to confirm receipt. The server has not confirmed whether it received this SOS."
                : "Waiting to send. This SOS has not been sent to the rescue server."}
        </p>
        {requestError && <p className="mt-3 text-sm text-red-700" role="alert">{requestError}</p>}
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" onClick={retryPendingReport} disabled={isSubmitting} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#102238] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-70">
            {isSubmitting ? <LoaderCircle aria-hidden="true" className="animate-spin" size={17} /> : <Send aria-hidden="true" size={16} />}
            {isSubmitting ? "Sending..." : "Try sending again"}
          </button>
          <button type="button" onClick={resetForm} disabled={isSubmitting} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 disabled:opacity-70">
            Report another emergency
          </button>
        </div>
      </section>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
      <div className="mb-5 border-b border-slate-100 pb-4">
        <h2 className="text-lg font-semibold text-slate-900">Quick emergency report</h2>
        <p className="mt-1 text-sm text-slate-500">Tell responders what happened and where help is needed.</p>
      </div>

      <div className="space-y-5">
        <div>
          <label htmlFor="category" className="mb-1.5 block text-sm font-medium text-slate-800">What kind of emergency? <span className="text-red-600">*</span></label>
          <select id="category" value={values.category} onChange={(event) => updateValue("category", event.target.value)} aria-invalid={Boolean(errors.category)} aria-describedby={errors.category ? "category-error" : undefined} className="form-control">
            <option value="">Choose emergency type</option>
            {categories.map((category) => <option key={category} value={category}>{category}</option>)}
          </select>
          {errors.category && <p id="category-error" className="field-error">{errors.category}</p>}
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <label htmlFor="description" className="block text-sm font-medium text-slate-800">Emergency details <span className="text-red-600">*</span></label>
            <span className="text-xs text-slate-500">{values.description.length}/{MAX_DESCRIPTION_LENGTH}</span>
          </div>
          <textarea id="description" rows="4" maxLength={MAX_DESCRIPTION_LENGTH} value={values.description} onChange={(event) => updateValue("description", event.target.value)} placeholder="Describe what happened, immediate dangers, and who needs help." aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? "description-error" : "description-hint"} className="form-control resize-y" />
          {errors.description ? <p id="description-error" className="field-error">{errors.description}</p> : <p id="description-hint" className="mt-1.5 text-xs text-slate-500">At least 10 characters. Include only details that help responders.</p>}
        </div>

        <LocationPicker values={values} onChange={updateValue} error={errors.location} />

        {requestError && (
          <div role="alert" className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            <AlertCircle aria-hidden="true" className="mt-0.5 shrink-0" size={18} />
            <p>{requestError}</p>
          </div>
        )}

        <button type="submit" disabled={isSubmitting} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#cf3f32] px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#b83228] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#cf3f32] disabled:cursor-not-allowed disabled:opacity-70">
          {isSubmitting ? <LoaderCircle aria-hidden="true" className="animate-spin" size={18} /> : <Send aria-hidden="true" size={17} />}
          {isSubmitting ? "Sending report..." : "Send Emergency Report"}
        </button>
        <p className="text-center text-xs text-slate-500">Your report is not a replacement for calling local emergency services.</p>
      </div>
    </form>
  );
}
