import assert from "node:assert/strict";
import test from "node:test";
import {
  EMPTY_TEAM_DRAFT,
  TEAM_FORM_MODES,
  TEAM_REGISTRATION_FIELDS,
  canManageTeams,
  recommendationDistance,
  teamDraftPayload,
  teamFormTransition,
  teamToDraft,
  validateTeamDraft,
} from "../src/teamManagement.js";

const validDraft = {
  ...EMPTY_TEAM_DRAFT,
  team_name: "Coastal Rescue",
  capabilities: "Flood response, Medical first aid",
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
  assert.equal(teamFormTransition(TEAM_FORM_MODES.EDIT, "save_failure"), TEAM_FORM_MODES.EDIT);
});

test("expanded registration retains every existing field", () => {
  assert.deepEqual(TEAM_REGISTRATION_FIELDS, [
    "team_name",
    "capabilities",
    "base_location_name",
    "availability",
    "latitude",
    "longitude",
    "contact_info",
  ]);
});

test("registration validation reports required and invalid fields", () => {
  const missing = validateTeamDraft(EMPTY_TEAM_DRAFT);
  assert.deepEqual(Object.keys(missing).sort(), ["base_location_name", "capabilities", "latitude", "longitude", "team_name"]);
  const invalidCoordinates = validateTeamDraft({ ...validDraft, latitude: "91", longitude: "-181" });
  assert.match(invalidCoordinates.latitude, /-90 and 90/);
  assert.match(invalidCoordinates.longitude, /-180 and 180/);
});

test("valid form data becomes the backend registration contract", () => {
  assert.deepEqual(validateTeamDraft(validDraft), {});
  assert.deepEqual(teamDraftPayload(validDraft), {
    team_name: "Coastal Rescue",
    capabilities: ["Flood response", "Medical first aid"],
    base_location_name: "Harbor Station",
    latitude: 12.9716,
    longitude: 77.5946,
    availability: "available",
    contact_info: null,
  });
});

test("editing legacy and busy teams preserves safe availability behavior", () => {
  const draft = teamToDraft({ team_name: "Legacy Team", availability: "busy", capabilities: null, latitude: null, longitude: null });
  assert.equal(draft.capabilities, "");
  const payload = teamDraftPayload(validDraft, { editingBusyTeam: true });
  assert.equal(Object.hasOwn(payload, "availability"), false);
});

test("recommendation rendering labels known and unknown straight-line distance", () => {
  assert.equal(recommendationDistance({ distance_km: 12.345 }), "12.35 km straight-line");
  assert.equal(recommendationDistance({ distance_km: null }), "Distance unknown");
});
