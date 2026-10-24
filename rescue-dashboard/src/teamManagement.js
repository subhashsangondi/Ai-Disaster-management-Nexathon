export const TEAM_CATEGORIES = Object.freeze([
  { id: "flood_water_rescue", label: "Flood & Water Rescue" },
  { id: "fire_urban_rescue", label: "Fire & Urban Rescue" },
  { id: "medical_response", label: "Medical Response" },
  { id: "search_evacuation", label: "Search & Evacuation" },
  { id: "general_disaster_response", label: "General Disaster Response" },
]);

export const CAPABILITY_GROUPS = Object.freeze([
  { category: "flood_water_rescue", capabilities: [
    { id: "flood_response", label: "Flood response" },
    { id: "swift_water_rescue", label: "Swift-water rescue" },
    { id: "boat_rescue", label: "Boat rescue" },
    { id: "water_evacuation", label: "Water evacuation" },
  ] },
  { category: "fire_urban_rescue", capabilities: [
    { id: "fire_suppression", label: "Fire suppression" },
    { id: "structural_collapse_rescue", label: "Structural collapse rescue" },
    { id: "confined_space_rescue", label: "Confined-space rescue" },
    { id: "urban_search_and_rescue", label: "Urban search and rescue" },
  ] },
  { category: "medical_response", capabilities: [
    { id: "first_aid", label: "First aid" },
    { id: "trauma_care", label: "Trauma care" },
    { id: "patient_stabilization", label: "Patient stabilization" },
    { id: "ambulance_support", label: "Ambulance support" },
  ] },
  { category: "search_evacuation", capabilities: [
    { id: "missing_person_search", label: "Missing-person search" },
    { id: "ground_search_and_rescue", label: "Ground search and rescue" },
    { id: "evacuation", label: "Evacuation" },
    { id: "debris_search", label: "Debris search" },
  ] },
  { category: "general_disaster_response", capabilities: [
    { id: "emergency_assessment", label: "Emergency assessment" },
    { id: "logistics_support", label: "Logistics support" },
    { id: "shelter_assistance", label: "Shelter assistance" },
    { id: "general_rescue", label: "General rescue" },
  ] },
]);

const CAPABILITIES = CAPABILITY_GROUPS.flatMap((group) => group.capabilities);
const CATEGORY_LABELS = new Map(TEAM_CATEGORIES.map((item) => [item.id, item.label]));
const CAPABILITY_LABELS = new Map(CAPABILITIES.map((item) => [item.id, item.label]));

function lookupKey(value) {
  return String(value || "").toLowerCase().replaceAll("&", " and ").replace(/[_-]+/g, " ").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

const CAPABILITY_ALIASES = new Map();
for (const capability of CAPABILITIES) {
  CAPABILITY_ALIASES.set(lookupKey(capability.id), capability.id);
  CAPABILITY_ALIASES.set(lookupKey(capability.label), capability.id);
}
Object.entries({
  "all hazard": "general_rescue",
  "all hazards": "general_rescue",
  "multi hazard": "general_rescue",
  "medical first aid": "first_aid",
  "swift water": "swift_water_rescue",
  "water rescue": "swift_water_rescue",
  firefighting: "fire_suppression",
  "urban search": "urban_search_and_rescue",
  "search and rescue": "ground_search_and_rescue",
}).forEach(([alias, id]) => CAPABILITY_ALIASES.set(lookupKey(alias), id));

export const EMPTY_TEAM_DRAFT = {
  team_name: "",
  primary_category: "",
  capabilities: [],
  legacy_capabilities: [],
  base_location_name: "",
  latitude: "",
  longitude: "",
  availability: "available",
  contact_info: "",
};

export const TEAM_FORM_MODES = Object.freeze({
  CLOSED: "closed",
  REGISTER: "register",
  EDIT: "edit",
});

export const TEAM_REGISTRATION_FIELDS = Object.freeze([
  "team_name",
  "primary_category",
  "capabilities",
  "base_location_name",
  "availability",
  "latitude",
  "longitude",
  "contact_info",
]);

export function normalizeCapabilityId(value) {
  return CAPABILITY_ALIASES.get(lookupKey(value)) || null;
}

export function categoryLabel(value) {
  return CATEGORY_LABELS.get(value) || "Category unknown";
}

export function capabilityLabel(value) {
  const normalized = normalizeCapabilityId(value);
  return normalized ? CAPABILITY_LABELS.get(normalized) : String(value || "").trim();
}

export function splitCapabilities(values) {
  const recognized = [];
  const legacy = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = normalizeCapabilityId(value);
    if (normalized && !recognized.includes(normalized)) recognized.push(normalized);
    else if (!normalized && String(value || "").trim() && !legacy.includes(String(value).trim())) legacy.push(String(value).trim());
  }
  return { recognized, legacy };
}

export function teamFormTransition(currentMode, event) {
  if (event === "open_registration") return TEAM_FORM_MODES.REGISTER;
  if (event === "open_edit") return TEAM_FORM_MODES.EDIT;
  if (event === "cancel" || event === "save_success") return TEAM_FORM_MODES.CLOSED;
  if (event === "save_failure") return currentMode;
  return currentMode;
}

export function shouldShowTeamRegistrationControls(role) {
  return role === "admin";
}

export function canManageTeams(role) {
  return shouldShowTeamRegistrationControls(role);
}

export function teamToDraft(team) {
  const split = team?.normalized_capabilities || team?.legacy_capabilities
    ? {
      recognized: team.normalized_capabilities || [],
      legacy: team.legacy_capabilities || [],
    }
    : splitCapabilities(team?.capabilities);
  return {
    team_name: team?.team_name || "",
    primary_category: team?.primary_category || "",
    capabilities: [...split.recognized],
    legacy_capabilities: [...split.legacy],
    base_location_name: team?.base_location_name || "",
    latitude: team?.latitude ?? "",
    longitude: team?.longitude ?? "",
    availability: team?.availability || "available",
    contact_info: team?.contact_info || "",
  };
}

export function validateTeamDraft(draft) {
  const errors = {};
  const latitude = Number(draft.latitude);
  const longitude = Number(draft.longitude);
  if (String(draft.team_name || "").trim().length < 2) errors.team_name = "Enter a team name with at least 2 characters.";
  if (!CATEGORY_LABELS.has(draft.primary_category)) errors.primary_category = "Choose a primary team category.";
  if (!Array.isArray(draft.capabilities) || draft.capabilities.length === 0) errors.capabilities = "Select at least one standardized capability.";
  if (String(draft.base_location_name || "").trim().length < 2) errors.base_location_name = "Enter a base location name.";
  if (draft.latitude === "" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) errors.latitude = "Latitude must be between -90 and 90.";
  if (draft.longitude === "" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) errors.longitude = "Longitude must be between -180 and 180.";
  if (!["available", "busy", "offline"].includes(draft.availability)) errors.availability = "Choose available, busy, or offline.";
  if (String(draft.contact_info || "").trim().length > 255) errors.contact_info = "Contact information must be 255 characters or fewer.";
  return errors;
}

export function teamDraftPayload(draft, { editingBusyTeam = false } = {}) {
  return {
    team_name: draft.team_name.trim(),
    primary_category: draft.primary_category,
    capabilities: [...new Set([...(draft.capabilities || []), ...(draft.legacy_capabilities || [])])],
    base_location_name: draft.base_location_name.trim(),
    latitude: Number(draft.latitude),
    longitude: Number(draft.longitude),
    ...(!editingBusyTeam ? { availability: draft.availability } : {}),
    contact_info: draft.contact_info.trim() || null,
  };
}

export function isTeamProfileComplete(team) {
  if (typeof team?.profile_complete === "boolean") return team.profile_complete;
  const capabilities = splitCapabilities(team?.capabilities).recognized;
  const latitude = Number(team?.latitude);
  const longitude = Number(team?.longitude);
  return String(team?.team_name || "").trim().length >= 2
    && CATEGORY_LABELS.has(team?.primary_category)
    && capabilities.length > 0
    && String(team?.base_location_name || "").trim().length >= 2
    && team?.latitude !== null && team?.latitude !== "" && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && team?.longitude !== null && team?.longitude !== "" && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

export function visibleCapabilityBadges(team, limit = 3) {
  const source = Array.isArray(team?.capabilities) ? team.capabilities : [];
  const badges = source.map((value) => ({
    value,
    label: capabilityLabel(value),
    legacy: !normalizeCapabilityId(value),
  }));
  return { visible: badges.slice(0, limit), remaining: Math.max(0, badges.length - limit) };
}

export function teamMapCoordinates(latitude, longitude) {
  if (latitude === "" || latitude === null || latitude === undefined
    || longitude === "" || longitude === null || longitude === undefined) return null;
  const numericLatitude = Number(latitude);
  const numericLongitude = Number(longitude);
  if (!Number.isFinite(numericLatitude) || numericLatitude < -90 || numericLatitude > 90
    || !Number.isFinite(numericLongitude) || numericLongitude < -180 || numericLongitude > 180) return null;
  return [numericLatitude, numericLongitude];
}

export function teamMapPickDraft(latitude, longitude) {
  return {
    latitude: Number(latitude).toFixed(6),
    longitude: Number(longitude).toFixed(6),
  };
}

export function recommendationDistance(team) {
  return team.distance_km == null ? "Distance unknown" : `${Number(team.distance_km).toFixed(2)} km straight-line`;
}
