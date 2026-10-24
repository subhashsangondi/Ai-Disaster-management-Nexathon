export const EMPTY_TEAM_DRAFT = {
  team_name: "",
  capabilities: "",
  base_location_name: "",
  latitude: "",
  longitude: "",
  availability: "available",
  contact_info: "",
};

export function canManageTeams(role) {
  return role === "admin";
}

export function teamToDraft(team) {
  return {
    team_name: team?.team_name || "",
    capabilities: Array.isArray(team?.capabilities) ? team.capabilities.join(", ") : "",
    base_location_name: team?.base_location_name || "",
    latitude: team?.latitude ?? "",
    longitude: team?.longitude ?? "",
    availability: team?.availability || "available",
    contact_info: team?.contact_info || "",
  };
}

export function validateTeamDraft(draft, { editingBusyTeam = false } = {}) {
  const errors = {};
  const capabilities = String(draft.capabilities || "").split(",").map((item) => item.trim()).filter(Boolean);
  const latitude = Number(draft.latitude);
  const longitude = Number(draft.longitude);
  if (String(draft.team_name || "").trim().length < 2) errors.team_name = "Enter a team name with at least 2 characters.";
  if (capabilities.length === 0 || capabilities.some((item) => item.length < 2)) errors.capabilities = "Enter at least one capability; separate multiple values with commas.";
  if (String(draft.base_location_name || "").trim().length < 2) errors.base_location_name = "Enter a base location name.";
  if (draft.latitude === "" || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) errors.latitude = "Latitude must be between -90 and 90.";
  if (draft.longitude === "" || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) errors.longitude = "Longitude must be between -180 and 180.";
  if (!editingBusyTeam && !["available", "offline"].includes(draft.availability)) errors.availability = "Choose available or offline.";
  if (String(draft.contact_info || "").trim().length > 255) errors.contact_info = "Contact information must be 255 characters or fewer.";
  return errors;
}

export function teamDraftPayload(draft, { editingBusyTeam = false } = {}) {
  return {
    team_name: draft.team_name.trim(),
    capabilities: [...new Set(draft.capabilities.split(",").map((item) => item.trim().replace(/\s+/g, " ")).filter(Boolean))],
    base_location_name: draft.base_location_name.trim(),
    latitude: Number(draft.latitude),
    longitude: Number(draft.longitude),
    ...(!editingBusyTeam ? { availability: draft.availability } : {}),
    contact_info: draft.contact_info.trim() || null,
  };
}

export function recommendationDistance(team) {
  return team.distance_km == null ? "Distance unknown" : `${Number(team.distance_km).toFixed(2)} km straight-line`;
}
