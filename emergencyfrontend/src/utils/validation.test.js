import { describe, expect, it } from "vitest";
import { validateIncident } from "./validation.js";

const validIncident = {
  category: "Flood",
  description: "Water is entering the ground floor.",
  latitude: null,
  longitude: null,
  location_text: "Oak Street near the library",
};

describe("validateIncident", () => {
  it("accepts a backend-compatible report with manual location", () => {
    expect(validateIncident(validIncident)).toEqual({});
  });

  it("requires emergency type, a 10-character description, and location", () => {
    expect(validateIncident({ ...validIncident, category: " ", description: "short", location_text: "" })).toEqual({
      category: "Choose an emergency category.",
      description: "Describe the emergency in at least 10 characters.",
      location: "Use your current location or enter a location manually.",
    });
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
