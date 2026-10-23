import { useState } from "react";
import { AlertCircle, CheckCircle2, Clock3, ExternalLink, ImagePlus, LoaderCircle, MapPin, Phone, Send, Trash2, Users } from "lucide-react";
import { submitIncident } from "../services/incidents.js";
import { getMapLinks } from "../utils/maps.js";
import { validateIncident } from "../utils/validation.js";
import LocationPicker from "./LocationPicker.jsx";

const initialValues = {
  category: "",
  description: "",
  reporter_type: "",
  people_affected: null,
  people_injured: null,
  victim_phone: "",
  volunteer_phone: "",
  photos: [],
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

const reporterTypes = ["Victim", "Witness", "Volunteer", "Other"];
const progressSteps = ["Received", "Review", "Response", "Resolved"];
const MAX_PHOTOS = 3;
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const PHONE_PATTERN = /^\+?[\d\s().-]{7,20}$/;
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

function getProgressIndex(status) {
  const normalizedStatus = status.toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  if (["under_review", "reviewing", "in_review"].includes(normalizedStatus)) return 1;
  if (["assigned", "dispatched", "in_progress", "responding"].includes(normalizedStatus)) return 2;
  if (["resolved", "closed", "complete", "completed"].includes(normalizedStatus)) return 3;
  return 0;
}

function formatReportedAt(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function readPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      filename: file.name,
      content_type: file.type,
      data_url: reader.result,
    });
    reader.onerror = () => reject(new Error(`Could not read ${file.name}. Please choose that photo again.`));
    reader.readAsDataURL(file);
  });
}

function formatPeopleCount(count) {
  if (count === null) return "Unknown";
  return count === 10 ? "10+" : count;
}

function CountSelect({ id, label, value, onChange, error, max = 10 }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-800">{label}</label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(event) => onChange(id, event.target.value === "" ? null : Number(event.target.value))}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : `${id}-hint`}
        className="form-control"
      >
        <option value="">Not sure</option>
        {Array.from({ length: max + 1 }, (_, count) => (
          <option key={count} value={count}>{count === 10 ? "10 or more" : count}</option>
        ))}
      </select>
      {error ? <p id={`${id}-error`} className="field-error">{error}</p> : <p id={`${id}-hint`} className="mt-1 text-xs text-slate-500">Choose “Not sure” if unknown.</p>}
    </div>
  );
}

export default function EmergencyReportForm({ onProgressChange }) {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [requestError, setRequestError] = useState("");
  const [deviceReportedAt, setDeviceReportedAt] = useState("");
  const [photoError, setPhotoError] = useState("");

  function updateValue(name, value) {
    setValues((current) => ({ ...current, [name]: value }));
    setErrors((current) => ({
      ...current,
      [name]: undefined,
      ...(name === "victim_phone" || name === "volunteer_phone" ? { contact_phone: undefined } : {}),
      location: undefined,
    }));
    setRequestError("");
  }

  function handlePhotoSelection(event) {
    const selected = Array.from(event.target.files || []);
    event.target.value = "";
    setPhotoError("");

    const remainingSlots = MAX_PHOTOS - values.photos.length;
    if (selected.length > remainingSlots) {
      setPhotoError(`You can attach up to ${MAX_PHOTOS} photos.`);
      return;
    }
    if (selected.some((file) => !PHOTO_TYPES.includes(file.type))) {
      setPhotoError("Choose a JPG, PNG, or WebP photo.");
      return;
    }
    const oversizedPhoto = selected.find((file) => file.size > MAX_PHOTO_SIZE);
    if (oversizedPhoto) {
      setPhotoError(`${oversizedPhoto.name} is larger than 5 MB. Choose a smaller photo.`);
      return;
    }

    setValues((current) => ({
      ...current,
      photos: [...current.photos, ...selected.map((file) => ({
        file,
        preview: URL.createObjectURL(file),
      }))],
    }));
  }

  function removePhoto(index) {
    setValues((current) => {
      const photo = current.photos[index];
      if (photo) URL.revokeObjectURL(photo.preview);
      return { ...current, photos: current.photos.filter((_, photoIndex) => photoIndex !== index) };
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (isSubmitting) return;

    const validationErrors = validateIncident(values);
    const victimPhone = values.victim_phone.trim();
    const volunteerPhone = values.volunteer_phone.trim();
    for (const [field, phone] of [["victim_phone", victimPhone], ["volunteer_phone", volunteerPhone]]) {
      const digitCount = phone.replace(/\D/g, "").length;
      if (phone && (!PHONE_PATTERN.test(phone) || digitCount < 7 || digitCount > 15)) {
        validationErrors[field] = "Enter a valid phone number with 7–15 digits.";
      }
    }
    if (!victimPhone && !volunteerPhone) {
      validationErrors.contact_phone = "Enter either the victim's or the volunteer's mobile number.";
    }
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
      category: values.category.trim(),
      description: values.description.trim(),
      reporter_type: values.reporter_type.trim(),
      people_affected: values.people_affected,
      people_injured: values.people_injured,
      victim_phone: victimPhone,
      volunteer_phone: volunteerPhone,
      photos: [],
      latitude: coordinatesAreValid ? values.latitude : null,
      longitude: coordinatesAreValid ? values.longitude : null,
      location_text: values.location_text.trim(),
    };

    setIsSubmitting(true);
    onProgressChange?.({ phase: "submitting" });
    const submittedAt = new Date().toISOString();
    try {
      payload.photos = await Promise.all(values.photos.map(({ file }) => readPhoto(file)));
      const response = await submitIncident(payload);
      setDeviceReportedAt(submittedAt);
      setResult(response);
      onProgressChange?.(response);
    } catch (error) {
      onProgressChange?.({ phase: "error" });
      setRequestError(error.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  function resetForm() {
    values.photos.forEach(({ preview }) => URL.revokeObjectURL(preview));
    setValues(initialValues);
    setErrors({});
    setResult(null);
    setRequestError("");
    setDeviceReportedAt("");
    setPhotoError("");
    onProgressChange?.(null);
  }

  if (result) {
    const status = result.status || "Received";
    const progressIndex = getProgressIndex(status);
    const reportedAt = result.reportedAt || deviceReportedAt;
    const mapLinks = getMapLinks(values);

    return (
      <section className="rounded-2xl border border-emerald-200 bg-white p-5 shadow-sm sm:p-8" aria-live="polite" aria-labelledby="success-title">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
              <CheckCircle2 aria-hidden="true" size={25} />
            </span>
            <h2 id="success-title" className="text-xl font-bold text-slate-900">Report received</h2>
            <p className="mt-1 text-sm text-slate-600">{result.message || "Your report was received by the server."}</p>
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
            <p className="mt-1 text-sm font-semibold text-slate-900">{reportedAt ? formatReportedAt(reportedAt) : "Time unavailable"}</p>
            {!result.reportedAt && <p className="mt-1 text-xs text-slate-500">Your device time</p>}
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-900">Report progress</h3>
            <span className="text-xs font-medium capitalize text-slate-500">{status.replaceAll("_", " ").replaceAll("-", " ")}</span>
          </div>
          <ol className="mt-4 grid grid-cols-4 gap-2" aria-label="Report progress">
            {progressSteps.map((step, index) => {
              const isComplete = index <= progressIndex;
              return (
                <li key={step} className="min-w-0">
                  <div className={`h-1.5 rounded-full ${isComplete ? "bg-emerald-500" : "bg-slate-200"}`} />
                  <p className={`mt-2 text-[11px] leading-4 sm:text-xs ${isComplete ? "font-semibold text-slate-800" : "text-slate-400"}`}>{step}</p>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-xs leading-5 text-slate-500">Progress updates depend on information returned by the response service.</p>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex min-w-0 items-start gap-2">
            <Users aria-hidden="true" className="mt-0.5 shrink-0 text-slate-500" size={17} />
            <p className="text-sm text-slate-700">
              {formatPeopleCount(values.people_affected)} affected
              <span className="mx-2 text-slate-300" aria-hidden="true">·</span>
              {formatPeopleCount(values.people_injured)} injured
            </p>
          </div>
          {mapLinks.map((link) => (
            <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-[#173b5e] hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#102238]">
              <MapPin aria-hidden="true" size={16} />
              {link.label}
              <ExternalLink aria-hidden="true" size={14} />
            </a>
          ))}
        </div>

        <p className="mt-4 text-xs leading-5 text-slate-500">This confirmation does not mean a rescue team has been dispatched. If you are in immediate danger, contact local emergency services.</p>
        <button type="button" onClick={resetForm} className="mt-5 inline-flex min-h-11 items-center justify-center rounded-lg bg-[#102238] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#1a3655] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#102238]">
          Submit Another Report
        </button>
      </section>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
      <div className="mb-5 border-b border-slate-100 pb-4">
        <h2 className="text-lg font-semibold text-slate-900">Quick emergency report</h2>
        <p className="mt-1 text-sm text-slate-500">Choose the essentials first. You can leave details blank if you are in a hurry.</p>
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

        <fieldset className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-800">People needing help</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <CountSelect id="people_affected" label="People affected" value={values.people_affected} onChange={updateValue} max={10} />
            <CountSelect id="people_injured" label="People injured" value={values.people_injured} onChange={updateValue} error={errors.people_injured} max={values.people_affected ?? 10} />
          </div>
        </fieldset>

        <fieldset className="rounded-xl border border-slate-200 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-800">Incident photos <span className="font-normal text-slate-500">(optional)</span></legend>
          <p className="mb-3 text-xs leading-5 text-slate-500">Add up to {MAX_PHOTOS} JPG, PNG, or WebP photos (5 MB each). Do not put yourself in danger to take a photo.</p>
          <label htmlFor="incident_photos" className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#102238]">
            <ImagePlus aria-hidden="true" size={16} />
            Choose photos
            <input id="incident_photos" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={handlePhotoSelection} className="sr-only" />
          </label>
          <span className="ml-3 text-xs text-slate-500">{values.photos.length}/{MAX_PHOTOS} selected</span>
          {photoError && <p className="field-error" role="alert">{photoError}</p>}
          {values.photos.length > 0 && (
            <ul className="mt-4 grid grid-cols-3 gap-3 sm:max-w-sm">
              {values.photos.map((photo, index) => (
                <li key={`${photo.file.name}-${photo.file.lastModified}`} className="relative aspect-square overflow-hidden rounded-lg border border-slate-200">
                  <img src={photo.preview} alt={`Selected incident photo ${index + 1}`} className="size-full object-cover" />
                  <button type="button" onClick={() => removePhoto(index)} aria-label={`Remove photo ${index + 1}`} className="absolute right-1.5 top-1.5 flex size-8 items-center justify-center rounded-full bg-slate-950/75 text-white hover:bg-slate-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
                    <Trash2 aria-hidden="true" size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </fieldset>

        <LocationPicker values={values} onChange={updateValue} error={errors.location} />

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="reporter_type" className="mb-1.5 block text-sm font-medium text-slate-800">Reporting as <span className="text-red-600">*</span></label>
            <select id="reporter_type" value={values.reporter_type} onChange={(event) => updateValue("reporter_type", event.target.value)} aria-invalid={Boolean(errors.reporter_type)} aria-describedby={errors.reporter_type ? "reporter-error" : undefined} className="form-control">
              <option value="">Choose your role</option>
              {reporterTypes.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            {errors.reporter_type && <p id="reporter-error" className="field-error">{errors.reporter_type}</p>}
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <label htmlFor="description" className="block text-sm font-medium text-slate-800">Extra details <span className="font-normal text-slate-500">(optional)</span></label>
              <span className="text-xs text-slate-500">{values.description.length}/1000</span>
            </div>
            <textarea id="description" rows="2" maxLength="1000" value={values.description} onChange={(event) => updateValue("description", event.target.value)} placeholder="Anything else responders should know?" aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? "description-error" : "description-hint"} className="form-control resize-y" />
            {errors.description ? <p id="description-error" className="field-error">{errors.description}</p> : <p id="description-hint" className="mt-1.5 text-xs text-slate-500">Optional. A few words are enough.</p>}
          </div>
        </div>

        <fieldset className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-800">Contact number <span className="text-red-600">*</span></legend>
          <p className="mb-3 text-xs leading-5 text-slate-600">At least one number is required so responders can reach someone. Enter the victim's or volunteer's number.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              ["victim_phone", "Victim's mobile number"],
              ["volunteer_phone", "Volunteer / reporter's mobile"],
            ].map(([id, label]) => (
              <div key={id}>
                <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-800">{label} <span className="font-normal text-slate-500">(optional if other number provided)</span></label>
                <div className="relative">
                  <Phone
                    aria-hidden="true"
                    data-testid={`${id}-icon`}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                    size={17}
                  />
                  <input
                    id={id}
                    type="tel"
                    autoComplete="tel"
                    inputMode="tel"
                    maxLength="20"
                    value={values[id]}
                    onChange={(event) => updateValue(id, event.target.value)}
                    placeholder="+91 98765 43210"
                    aria-invalid={Boolean(errors[id] || errors.contact_phone)}
                    aria-describedby={errors[id] ? `${id}-error` : errors.contact_phone ? "contact-phone-error" : undefined}
                    className="form-control form-control--with-icon"
                  />
                </div>
                {errors[id] && <p id={`${id}-error`} className="field-error">{errors[id]}</p>}
              </div>
            ))}
          </div>
          {errors.contact_phone && <p id="contact-phone-error" className="field-error" role="alert">{errors.contact_phone}</p>}
        </fieldset>

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
