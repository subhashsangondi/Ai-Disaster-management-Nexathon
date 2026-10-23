import { describe, expect, it } from "vitest";
import { validateIncident } from "./validation.js";

const validIncident = {
  category: "Flood",
  description: "Water is entering the ground floor.",
  reporter_type: "witness",
  people_affected: null,
  people_injured: null,
  victim_phone: null,
  volunteer_phone: "+91 98765 43210",
  latitude: null,
  longitude: null,
  location_text: "Oak Street near the library",
};

describe("validateIncident", () => {
  it("accepts a backend-compatible report with manual location", () => {
    expect(validateIncident(validIncident)).toEqual({});
  });

  it("accepts a blank description while requiring role, contact, and location", () => {
    expect(validateIncident({
      ...validIncident,
      description: "",
      reporter_type: "",
      victim_phone: "",
      volunteer_phone: "",
      location_text: "",
    })).toEqual({
      reporter_type: "Choose who is reporting.",
      contact_phone: "Enter either the victim's or volunteer's phone number.",
      location: "Use your current location or enter a location manually.",
    });
  });

  it("validates non-empty optional descriptions and victim counts", () => {
    const errors = validateIncident({
      ...validIncident,
      description: "short",
      people_affected: 2,
      people_injured: 3,
    });
    expect(errors.description).toContain("at least 10 characters");
    expect(errors.people_injured).toContain("cannot exceed");
  });

  it("rejects an overlong description and invalid GPS without a fallback", () => {
    const errors = validateIncident({
      ...validIncident,
      description: "x".repeat(5001),
      latitude: 91,
      longitude: 181,
      location_text: "",
    });
    expect(errors.description).toContain("5000");
    expect(errors.location).toContain("GPS coordinates are invalid");
  });

  it("requires a complete coordinate pair when manual location is empty", () => {
    expect(validateIncident({ ...validIncident, latitude: 12, location_text: "" }).location).toContain("complete latitude");
  });
});
