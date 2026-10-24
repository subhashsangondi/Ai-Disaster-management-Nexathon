import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPABILITY_GROUPS,
  EMPTY_TEAM_DRAFT,
  TEAM_CATEGORIES,
  TEAM_FORM_MODES,
  TEAM_REGISTRATION_FIELDS,
  canManageTeams,
  capabilityLabel,
  categoryLabel,
  isTeamProfileComplete,
  recommendationDistance,
  splitCapabilities,
  teamDraftPayload,
  teamFormTransition,
  teamMapCoordinates,
  teamMapPickDraft,
  teamToDraft,
  validateTeamDraft,
  visibleCapabilityBadges,
} from "../src/teamManagement.js";

const validDraft = {
  ...EMPTY_TEAM_DRAFT,
  team_name: "Coastal Rescue",
  primary_category: "flood_water_rescue",
  capabilities: ["flood_response", "boat_rescue", "first_aid"],
  base_location_name: "Harbor Station",
  latitude: "12.9716",
  longitude: "77.5946",
};

test("team controls are admin-only", () => {
  assert.equal(canManageTeams("admin"), true);
  assert.equal(canManageTeams("operator"), false);
  assert.equal(canManageTeams("responder"), false);
});

test("registration form starts collapsed and follows open, cancel, success, and failure transitions", () => {
  assert.equal(TEAM_FORM_MODES.CLOSED, "closed");
  assert.equal(teamFormTransition(TEAM_FORM_MODES.CLOSED, "open_registration"), TEAM_FORM_MODES.REGISTER);
  assert.equal(teamFormTransition(TEAM_FORM_MODES.REGISTER, "cancel"), TEAM_FORM_MODES.CLOSED);
  assert.equal(teamFormTransition(TEAM_FORM_MODES.REGISTER, "save_success"), TEAM_FORM_MODES.CLOSED);
  assert.equal(teamFormTransition(TEAM_FORM_MODES.REGISTER, "save_failure"), TEAM_FORM_MODES.REGISTER);
  assert.equal(teamFormTransition(TEAM_FORM_MODES.CLOSED, "open_edit"), TEAM_FORM_MODES.EDIT);
});

test("expanded registration retains required fields including standardized category and capabilities", () => {
  assert.deepEqual(TEAM_REGISTRATION_FIELDS, [
    "team_name",
    "primary_category",
    "capabilities",
    "base_location_name",
    "availability",
    "latitude",
    "longitude",
    "contact_info",
  ]);
  assert.equal(TEAM_CATEGORIES.length, 5);
  assert.equal(CAPABILITY_GROUPS.flatMap((group) => group.capabilities).length, 20);
});

test("registration validation reports missing capabilities and invalid coordinates", () => {
  const missing = validateTeamDraft(EMPTY_TEAM_DRAFT);
  assert.deepEqual(Object.keys(missing).sort(), ["base_location_name", "capabilities", "latitude", "longitude", "primary_category", "team_name"]);
  const invalidCoordinates = validateTeamDraft({ ...validDraft, latitude: "91", longitude: "-181" });
  assert.match(invalidCoordinates.latitude, /-90 and 90/);
  assert.match(invalidCoordinates.longitude, /-180 and 180/);
});

test("valid multi-select form data becomes the standardized backend contract", () => {
  assert.deepEqual(validateTeamDraft(validDraft), {});
  assert.deepEqual(teamDraftPayload(validDraft), {
    team_name: "Coastal Rescue",
    primary_category: "flood_water_rescue",
    capabilities: ["flood_response", "boat_rescue", "first_aid"],
    base_location_name: "Harbor Station",
    latitude: 12.9716,
    longitude: 77.5946,
    availability: "available",
    contact_info: null,
  });
});

test("editing a legacy team normalizes known values and preserves unknown values", () => {
  const draft = teamToDraft({
    team_name: "Legacy Team",
    availability: "available",
    capabilities: ["Flood response", "Rope specialty"],
    latitude: null,
    longitude: null,
  });
  assert.deepEqual(draft.capabilities, ["flood_response"]);
  assert.deepEqual(draft.legacy_capabilities, ["Rope specialty"]);
  const completed = { ...validDraft, legacy_capabilities: draft.legacy_capabilities };
  assert.deepEqual(teamDraftPayload(completed).capabilities, ["flood_response", "boat_rescue", "first_aid", "Rope specialty"]);
});

test("busy-team editing omits availability while preserving other profile fields", () => {
  const payload = teamDraftPayload({ ...validDraft, availability: "busy" }, { editingBusyTeam: true });
  assert.equal(Object.hasOwn(payload, "availability"), false);
  assert.equal(payload.primary_category, "flood_water_rescue");
});

test("profile completeness identifies incomplete legacy and complete standardized teams", () => {
  assert.equal(isTeamProfileComplete({ team_name: "Legacy", capabilities: null, primary_category: null }), false);
  assert.equal(isTeamProfileComplete({
    team_name: "Complete",
    primary_category: "medical_response",
    capabilities: ["first_aid"],
    base_location_name: "Clinic Base",
    latitude: 12,
    longitude: 77,
  }), true);
});

test("cards label standardized and legacy capabilities and collapse long lists", () => {
  const badges = visibleCapabilityBadges({ capabilities: ["flood_response", "boat_rescue", "first_aid", "Rope specialty"] });
  assert.deepEqual(badges.visible.map((badge) => badge.label), ["Flood response", "Boat rescue", "First aid"]);
  assert.equal(badges.remaining, 1);
  assert.equal(splitCapabilities(["Medical first aid", "Rope specialty"]).recognized[0], "first_aid");
  assert.equal(capabilityLabel("Rope specialty"), "Rope specialty");
  assert.equal(categoryLabel("search_evacuation"), "Search & Evacuation");
});

test("manual coordinates and map clicks use the same validated marker state", () => {
  assert.deepEqual(teamMapCoordinates("12.9716", "77.5946"), [12.9716, 77.5946]);
  assert.equal(teamMapCoordinates("91", "77"), null);
  assert.equal(teamMapCoordinates("12", "181"), null);
  const picked = teamMapPickDraft(12.3456784, 77.1234567);
  assert.deepEqual(picked, { latitude: "12.345678", longitude: "77.123457" });
  assert.deepEqual(teamMapCoordinates(picked.latitude, picked.longitude), [12.345678, 77.123457]);
});

test("recommendation rendering labels known and unknown straight-line distance", () => {
  assert.equal(recommendationDistance({ distance_km: 12.345 }), "12.35 km straight-line");
  assert.equal(recommendationDistance({ distance_km: null }), "Distance unknown");
});
