import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle, MapPin, Phone, RotateCcw, Siren } from "lucide-react";
import { addQuickSosDetails, submitIncident } from "../services/incidents.js";
import { contactNumberError, normalizeContactNumber } from "../utils/contactNumber.js";
import { requestCurrentLocation } from "../utils/geolocation.js";
import SosStatusCard from "./SosStatusCard.jsx";

export const QUICK_SOS_TYPES = [
  { value: "Fire", label: "Fire" },
  { value: "Flood", label: "Flood" },
  { value: "Medical", label: "Medical" },
  { value: "Accident", label: "Accident" },
  { value: "Trapped", label: "Trapped" },
  { value: "Other", label: "Other / Not sure" },
];

function quickSosPayload(location) {
  return {
    submission_mode: "quick_sos",
    latitude: location.latitude,
    longitude: location.longitude,
    location_accuracy_meters: location.accuracy,
    location_captured_at: location.capturedAt,
  };
}

function EmergencyCallNotice() {
  return (
    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
      <p>
        <strong>Hackathon demo.</strong> RescueGrid AI is not connected to official emergency services. In a real emergency in India, call 112.
      </p>
      <a href="tel:112" className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg border border-amber-300 bg-white px-4 py-2 font-semibold text-amber-900 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700">
        <Phone aria-hidden="true" size={17} />
        Call 112 (India emergency number)
      </a>
    </div>
  );
}

function QuickSosDetails({ trackingToken }) {
  const [selectedType, setSelectedType] = useState("");
  const [contact, setContact] = useState("");
  const [contactError, setContactError] = useState("");
  const [savedContact, setSavedContact] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);

  async function save(details) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await addQuickSosDetails(trackingToken, details);
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Details could not be added. Your SOS is still saved.");
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function chooseType(type) {
    if (await save({ emergency_type: type })) setSelectedType(type);
  }

  async function saveContact(event) {
    event.preventDefault();
    const problem = contactNumberError(contact) || (normalizeContactNumber(contact) ? "" : "Enter a phone number to save it.");
    setContactError(problem);
    if (problem) return;
    if (await save({ contact_number: normalizeContactNumber(contact) })) setSavedContact(true);
  }

  return (
    <div className="mt-5 border-t border-slate-100 pt-5">
      <h3 className="text-base font-semibold text-slate-900">Help responders (optional)</h3>
      <p className="mt-1 text-sm text-slate-600">Your SOS is already saved. Add details only if it is safe to do so.</p>

      <fieldset className="mt-4" disabled={busy}>
        <legend className="mb-2 text-sm font-medium text-slate-800">What kind of emergency?</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {QUICK_SOS_TYPES.map((type) => (
            <button
              key={type.value}
              type="button"
              aria-pressed={selectedType === type.value}
              onClick={() => chooseType(type.value)}
              className={`min-h-14 rounded-xl border px-3 py-3 text-base font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#102238] disabled:opacity-60 ${selectedType === type.value ? "border-[#102238] bg-[#102238] text-white" : "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"}`}
            >
              {type.label}
            </button>
          ))}
        </div>
        {selectedType && <p role="status" className="mt-2 text-sm font-medium text-emerald-700">Added emergency type: {selectedType}. An operator will still confirm it.</p>}
      </fieldset>

      <form className="mt-5" onSubmit={saveContact} noValidate>
        <label htmlFor="quick-sos-contact" className="mb-1.5 block text-sm font-medium text-slate-800">Contact number (optional)</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="quick-sos-contact"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={32}
            value={contact}
            disabled={busy || savedContact}
            onChange={(event) => { setContact(event.target.value); setContactError(""); }}
            placeholder="+91 98765 43210"
            aria-invalid={Boolean(contactError)}
            aria-describedby={contactError ? "quick-sos-contact-error" : "quick-sos-contact-hint"}
            className="form-control"
          />
          <button type="submit" disabled={busy || savedContact} className="min-h-11 shrink-0 rounded-lg bg-[#102238] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
            {savedContact ? "Saved" : "Save number"}
          </button>
        </div>
        {contactError
          ? <p id="quick-sos-contact-error" className="field-error">{contactError}</p>
          : <p id="quick-sos-contact-hint" className="mt-1.5 text-xs text-slate-500">Only verified operators can see it. It is never shown on public tracking.</p>}
        {savedContact && <p role="status" className="mt-2 text-sm font-medium text-emerald-700">Contact number added to your SOS.</p>}
      </form>

      {error && (
        <div role="alert" className="mt-4 flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <AlertCircle aria-hidden="true" className="mt-0.5 shrink-0" size={18} />
          <p>{error}</p>
        </div>
      )}
    </div>
  );
}

export default function QuickSos({ onProgressChange }) {
  const [phase, setPhase] = useState("idle");
  const [error, setError] = useState("");
  const [failedPayload, setFailedPayload] = useState(null);
  const [manualLocation, setManualLocation] = useState("");
  const [manualError, setManualError] = useState("");
  const [result, setResult] = useState(null);
  const lock = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const busy = phase === "locating" || phase === "submitting";

  async function send(payload) {
    setPhase("submitting");
    setError("");
    onProgressChange?.({ phase: "submitting" });
    const submittedAt = new Date().toISOString();
    try {
      const response = await submitIncident(payload);
      if (!mounted.current) return;
      setResult({ ...response, reportedAt: submittedAt });
      setFailedPayload(null);
      setPhase("sent");
      onProgressChange?.({ ...response, reportedAt: submittedAt });
    } catch (submitError) {
      if (!mounted.current) return;
      setFailedPayload(payload);
      setError(submitError instanceof Error ? submitError.message : "Your SOS was not confirmed. Please try again.");
      setPhase("submit_failed");
      onProgressChange?.({ phase: "error" });
    }
  }

  async function startQuickSos() {
    if (lock.current) return;
    lock.current = true;
    setPhase("locating");
    setError("");
    try {
      let location;
      try {
        location = await requestCurrentLocation();
      } catch (locationError) {
        if (!mounted.current) return;
        setError(locationError instanceof Error ? locationError.message : "Your location could not be found.");
        setPhase("location_failed");
        return;
      }
      if (!mounted.current) return;
      await send(quickSosPayload(location));
    } finally {
      lock.current = false;
    }
  }

  async function runLocked(action) {
    if (lock.current) return;
    lock.current = true;
    try {
      await action();
    } finally {
      lock.current = false;
    }
  }

  function sendManualLocation(event) {
    event.preventDefault();
    const location = manualLocation.trim();
    if (!location) {
      setManualError("Enter an address, landmark, or directions.");
      return;
    }
    setManualError("");
    runLocked(() => send({ submission_mode: "quick_sos", location_text: location }));
  }

  function startOver() {
    setPhase("idle");
    setResult(null);
    setError("");
    setFailedPayload(null);
    setManualLocation("");
    onProgressChange?.(null);
  }

  if (phase === "sent" && result) {
    return (
      <section className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm sm:p-8" aria-labelledby="quick-sos-success">
        <div role="status" aria-live="polite">
          <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
            <CheckCircle2 aria-hidden="true" size={25} />
          </span>
          <h2 id="quick-sos-success" className="text-xl font-bold text-slate-900">SOS received</h2>
          <p className="mt-1 text-sm text-slate-600">Your location was saved. An operator will review it.</p>
        </div>
        <SosStatusCard incident={{ ...result, submissionMode: "quick_sos" }} />
        {result.trackingToken && <QuickSosDetails trackingToken={result.trackingToken} />}
        <EmergencyCallNotice />
        <button type="button" onClick={startOver} className="mt-5 text-sm font-semibold text-[#173b5e] underline underline-offset-4">
          Report a different emergency
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border-2 border-red-200 bg-white p-5 shadow-sm sm:p-8" aria-labelledby="quick-sos-title">
      <h2 id="quick-sos-title" className="text-lg font-bold text-slate-900">Quick SOS — Send My Location</h2>
      <p id="quick-sos-hint" className="mt-1 text-sm text-slate-600">Share your location and request help. No typing required.</p>

      <button
        type="button"
        onClick={startQuickSos}
        disabled={busy}
        aria-describedby="quick-sos-hint"
        aria-busy={busy}
        className="mt-5 flex min-h-24 w-full items-center justify-center gap-3 rounded-2xl bg-[#cf3f32] px-6 py-6 text-2xl font-extrabold tracking-wide text-white shadow-lg shadow-red-900/20 transition hover:bg-[#b83228] focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-[#cf3f32] disabled:cursor-wait disabled:opacity-80"
      >
        {busy ? <LoaderCircle aria-hidden="true" className="animate-spin" size={30} /> : <Siren aria-hidden="true" size={30} />}
        {phase === "locating" ? "Finding your location..." : phase === "submitting" ? "Sending SOS..." : "SEND QUICK SOS"}
      </button>

      <div aria-live="polite" className="sr-only">
        {phase === "locating" ? "Finding your location." : phase === "submitting" ? "Sending your SOS." : ""}
      </div>

      {phase === "submit_failed" && (
        <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="flex gap-2"><AlertCircle aria-hidden="true" className="mt-0.5 shrink-0" size={18} /> <span><strong>SOS not sent.</strong> {error}</span></p>
          {failedPayload && (
            <button type="button" onClick={() => runLocked(() => send(failedPayload))} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#cf3f32] px-4 py-2 font-semibold text-white">
              <RotateCcw aria-hidden="true" size={16} /> Retry sending SOS
            </button>
          )}
        </div>
      )}

      {phase === "location_failed" && (
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
          <p role="alert" className="flex gap-2 text-sm text-red-800"><AlertCircle aria-hidden="true" className="mt-0.5 shrink-0" size={18} /> <span><strong>SOS not sent yet.</strong> {error}</span></p>
          <form className="mt-4" onSubmit={sendManualLocation} noValidate>
            <label htmlFor="quick-sos-location" className="mb-1.5 block text-sm font-medium text-slate-800">Where are you?</label>
            <input
              id="quick-sos-location"
              type="text"
              maxLength={500}
              value={manualLocation}
              onChange={(event) => { setManualLocation(event.target.value); setManualError(""); }}
              placeholder="Address, landmark, or directions"
              aria-invalid={Boolean(manualError)}
              aria-describedby={manualError ? "quick-sos-location-error" : undefined}
              className="form-control"
            />
            {manualError && <p id="quick-sos-location-error" className="field-error">{manualError}</p>}
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <button type="submit" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#cf3f32] px-4 py-2 text-sm font-semibold text-white">
                <MapPin aria-hidden="true" size={16} /> Send SOS with this location
              </button>
              <button type="button" onClick={startQuickSos} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700">
                <RotateCcw aria-hidden="true" size={16} /> Try my location again
              </button>
            </div>
          </form>
        </div>
      )}

      <EmergencyCallNotice />
    </section>
  );
}
