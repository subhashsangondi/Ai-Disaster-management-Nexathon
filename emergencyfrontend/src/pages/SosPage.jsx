import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  LoaderCircle,
  MapPin,
  Mic,
  MicOff,
  Play,
  Trash2,
} from "lucide-react";
import { Link } from "react-router-dom";
import EmergencyLocationMap from "../components/EmergencyLocationMap.jsx";
import { submitIncident } from "../services/incidents.js";

const GEOLOCATION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 0,
};

function geolocationErrorMessage(error) {
  if (error?.code === 1) {
    return "Location permission was denied. Allow location access in your browser settings, or tap the map to choose a location.";
  }
  if (error?.code === 2) {
    return "Your current location is unavailable. Check your device location settings, or tap the map to choose a location.";
  }
  if (error?.code === 3) {
    return "Location detection timed out. Try again or tap the map to choose a location.";
  }
  return "Could not detect your location. Try again or tap the map to choose a location.";
}

function validCoordinates(location) {
  return Boolean(
    location
    && Number.isFinite(location.latitude)
    && location.latitude >= -90
    && location.latitude <= 90
    && Number.isFinite(location.longitude)
    && location.longitude >= -180
    && location.longitude <= 180,
  );
}

export default function SosPage() {
  const [location, setLocation] = useState(null);
  const [isLocating, setIsLocating] = useState(true);
  const [locationError, setLocationError] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [requestError, setRequestError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const locationWasManuallySelected = useRef(false);
  const isMounted = useRef(true);
  const submissionLock = useRef(false);
  const mediaRecorder = useRef(null);
  const mediaStream = useRef(null);
  const recordedChunks = useRef([]);
  const audioUrlRef = useRef("");
  const audioElement = useRef(null);

  function detectLocation() {
    locationWasManuallySelected.current = false;
    setIsLocating(true);
    setLocationError("");

    if (!navigator.geolocation?.getCurrentPosition) {
      setIsLocating(false);
      setLocationError("This browser does not support location detection. Tap the map to choose the emergency location.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (!isMounted.current || locationWasManuallySelected.current) return;
        const nextLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          source: "gps",
        };
        if (!validCoordinates(nextLocation)) {
          setIsLocating(false);
          setLocationError("The browser returned invalid coordinates. Tap the map to choose the emergency location.");
          return;
        }
        setLocation(nextLocation);
        setLocationError("");
        setIsLocating(false);
      },
      (error) => {
        if (!isMounted.current || locationWasManuallySelected.current) return;
        setIsLocating(false);
        setLocationError(geolocationErrorMessage(error));
      },
      GEOLOCATION_OPTIONS,
    );
  }

  useEffect(() => {
    isMounted.current = true;
    detectLocation();
    return () => {
      isMounted.current = false;
      const recorder = mediaRecorder.current;
      if (recorder?.state === "recording") recorder.stop();
      mediaStream.current?.getTracks().forEach((track) => track.stop());
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    };
  }, []);

  function selectMapLocation(latitude, longitude) {
    locationWasManuallySelected.current = true;
    setLocation({ latitude, longitude, source: "map" });
    setLocationError("");
    setIsLocating(false);
  }

  async function startRecording() {
    setVoiceError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof window.MediaRecorder !== "function") {
      setVoiceError("Voice recording is not supported by this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!isMounted.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      mediaStream.current = stream;
      recordedChunks.current = [];
      const supportedTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
      const mimeType = supportedTypes.find((type) => window.MediaRecorder.isTypeSupported?.(type));
      const recorder = new window.MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorder.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data?.size > 0) recordedChunks.current.push(event.data);
      };
      recorder.onstop = () => {
        mediaStream.current?.getTracks().forEach((track) => track.stop());
        mediaStream.current = null;
        if (!isMounted.current) return;
        if (recordedChunks.current.length > 0) {
          const audio = new Blob(recordedChunks.current, {
            type: recorder.mimeType || "audio/webm",
          });
          if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
          const nextAudioUrl = URL.createObjectURL(audio);
          audioUrlRef.current = nextAudioUrl;
          setAudioUrl(nextAudioUrl);
        }
        setIsRecording(false);
      };
      recorder.start();
      setIsRecording(true);
    } catch (error) {
      mediaStream.current?.getTracks().forEach((track) => track.stop());
      mediaStream.current = null;
      if (!isMounted.current) return;
      if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") {
        setVoiceError("Microphone permission was denied. Allow microphone access in browser settings and try again.");
      } else if (error?.name === "NotFoundError") {
        setVoiceError("No microphone was found on this device.");
      } else {
        setVoiceError("Could not start recording. Check microphone access and try again.");
      }
    }
  }

  function stopRecording() {
    if (mediaRecorder.current?.state === "recording") {
      mediaRecorder.current.stop();
      mediaStream.current?.getTracks().forEach((track) => track.stop());
    }
  }

  function removeRecording() {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = "";
    setAudioUrl("");
    setVoiceError("");
  }

  async function playRecording() {
    try {
      await audioElement.current?.play();
    } catch {
      setVoiceError("Could not play the recording in this browser. Use the audio player's controls to retry.");
    }
  }

  async function sendSos(event) {
    event.preventDefault();
    if (submissionLock.current) return;
    setRequestError("");

    if (!validCoordinates(location)) {
      setRequestError("Choose a valid emergency location on the map before sending SOS.");
      return;
    }
    if (isRecording) {
      setRequestError("Stop the recording before sending SOS.");
      return;
    }
    if (audioUrl) {
      setRequestError("The current reporting server cannot accept voice-note uploads. Remove the recording to send your location-only SOS; the audio has not been uploaded.");
      return;
    }

    submissionLock.current = true;
    setIsSubmitting(true);
    try {
      const response = await submitIncident({
        emergency_type: "SOS",
        description: "SOS emergency reported; no additional details provided.",
        latitude: location.latitude,
        longitude: location.longitude,
        location_text: null,
      });
      setResult(response);
    } catch (error) {
      setRequestError(error instanceof Error
        ? error.message
        : "The SOS could not be confirmed by the reporting server. Please try again.");
    } finally {
      submissionLock.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f4f6f8] text-slate-900">
      <header className="border-b border-white/10 bg-[#0b1727] text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-5 sm:px-8">
          <Link to="/" className="flex items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-300">
            <span className="flex size-10 items-center justify-center rounded-xl bg-orange-500 text-white">
              <Activity aria-hidden="true" size={23} strokeWidth={2.5} />
            </span>
            <span className="text-lg font-bold tracking-tight">RescueGrid <span className="text-orange-400">AI</span></span>
          </Link>
          <span className="hidden items-center gap-2 rounded-full border border-red-300/30 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200 sm:flex">
            <span className="size-2 rounded-full bg-red-400" />
            Emergency SOS
          </span>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-5xl px-5 pb-12 pt-7 sm:px-8 sm:pt-10">
        <Link to="/" className="mb-6 inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#102238]">
          <ArrowLeft aria-hidden="true" size={17} />
          Back to emergency report
        </Link>

        <section className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-5 sm:p-6">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-red-700">Fast emergency alert</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[#101d2e] sm:text-4xl">Send an SOS</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-700">
            We’ll try to detect your location as soon as this page opens. Check the map marker and tap the map to correct it before sending.
          </p>
        </section>

        {result ? (
          <section className="rounded-2xl border border-emerald-200 bg-white p-6 shadow-sm sm:p-8" aria-live="polite">
            <span className="flex size-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
              <CheckCircle2 aria-hidden="true" size={27} />
            </span>
            <h2 className="mt-4 text-xl font-bold text-slate-900">SOS report received</h2>
            <p className="mt-1 text-sm text-slate-600">{result.message || "The reporting server confirmed receipt of your SOS."}</p>
            <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Incident ID</p>
              <p className="mt-1 break-all font-mono font-semibold text-slate-900">{result.id}</p>
              {result.status && <p className="mt-2 text-sm capitalize text-slate-600">Status: {result.status.replaceAll("_", " ")}</p>}
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-500">
              This confirmation does not mean a rescue team has been dispatched. Contact local emergency services directly if you are in immediate danger.
            </p>
            <Link to="/" className="mt-6 inline-flex min-h-11 items-center justify-center rounded-lg bg-[#102238] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1a3655] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#102238]">
              Return to emergency report
            </Link>
          </section>
        ) : (
          <form onSubmit={sendSos} noValidate className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
            <section aria-labelledby="voice-note-heading" className="rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
              <h2 id="voice-note-heading" className="text-base font-semibold text-slate-900">Voice Note (Optional)</h2>
              <p className="mt-1 text-sm leading-5 text-slate-600">
                Record a short note and listen before deciding whether to keep it. Microphone permission is requested only when you press Record.
              </p>
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                The current backend does not accept or store audio. A recording stays on this device and must be removed before a location-only SOS can be sent.
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {!isRecording ? (
                  <button type="button" onClick={startRecording} disabled={Boolean(audioUrl)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-60">
                    <Mic aria-hidden="true" size={16} />
                    Record
                  </button>
                ) : (
                  <button type="button" onClick={stopRecording} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900">
                    <MicOff aria-hidden="true" size={16} />
                    Stop
                  </button>
                )}
                {audioUrl && (
                  <button type="button" onClick={playRecording} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#102238]">
                    <Play aria-hidden="true" size={16} />
                    Playback
                  </button>
                )}
                {audioUrl && (
                  <button type="button" onClick={removeRecording} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#102238]">
                    <Trash2 aria-hidden="true" size={16} />
                    Remove
                  </button>
                )}
              </div>
              {isRecording && <p role="status" className="mt-3 flex items-center gap-2 text-sm font-semibold text-red-700"><span className="size-2 animate-pulse rounded-full bg-red-600" />Recording in progress…</p>}
              {audioUrl && <audio ref={audioElement} aria-label="Voice note playback" className="mt-4 w-full" controls src={audioUrl}>Audio playback is not supported by this browser.</audio>}
              {voiceError && <p role="alert" className="mt-3 text-sm text-red-700">{voiceError}</p>}
            </section>

            <div>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
                    <MapPin aria-hidden="true" className="text-red-600" size={20} />
                    Emergency location
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">The marker and coordinates update when GPS is detected or you tap the map.</p>
                </div>
                <button
                  type="button"
                  onClick={detectLocation}
                  disabled={isLocating}
                  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#102238] disabled:cursor-wait disabled:opacity-60"
                >
                  {isLocating ? <LoaderCircle aria-hidden="true" className="animate-spin" size={16} /> : <MapPin aria-hidden="true" size={16} />}
                  {isLocating ? "Detecting…" : "Retry GPS"}
                </button>
              </div>
              {isLocating && <p role="status" className="mb-3 text-sm font-medium text-blue-800">Detecting your current location…</p>}
              {locationError && <p role="alert" className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-5 text-amber-900">{locationError}</p>}
              <EmergencyLocationMap
                latitude={location?.latitude ?? null}
                longitude={location?.longitude ?? null}
                onSelectLocation={selectMapLocation}
              />
              {validCoordinates(location) ? (
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700" aria-live="polite">
                  {location.source === "gps" ? "Browser-detected coordinates" : "Map-selected coordinates"}:{" "}
                  {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
                </p>
              ) : (
                <p className="mt-3 text-sm text-slate-600">No location selected. The map’s initial overview is not your location.</p>
              )}
            </div>

            {requestError && (
              <div role="alert" className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                <AlertCircle aria-hidden="true" className="mt-0.5 shrink-0" size={18} />
                <p>{requestError}</p>
              </div>
            )}

            <button type="submit" disabled={isSubmitting || isRecording} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-5 py-3 text-base font-bold text-white shadow-sm transition hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:opacity-70">
              {isSubmitting ? <LoaderCircle aria-hidden="true" className="animate-spin" size={19} /> : <MapPin aria-hidden="true" size={18} />}
              {isSubmitting ? "Sending SOS…" : "Send SOS"}
            </button>
            <p className="text-center text-xs leading-5 text-slate-500">The reporting server must confirm receipt. This demo does not itself dispatch rescue services.</p>
          </form>
        )}
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-5 py-6 text-xs leading-5 text-slate-500 sm:px-8 md:flex-row md:items-center md:justify-between">
          <p>RescueGrid AI · Community emergency reporting</p>
          <p>If you are in immediate danger, contact local emergency services directly.</p>
        </div>
      </footer>
    </div>
  );
}
