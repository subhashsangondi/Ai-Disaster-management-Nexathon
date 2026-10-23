import { describe, expect, it } from "vitest";
import { validateIncident } from "./validation.js";

const validIncident = {
  category: "Flood",
  description: "",
  reporter_type: "Witness",
  people_affected: null,
  people_injured: null,
  latitude: null,
  longitude: null,
  location_text: "  Oak Street near the library  ",
};

describe("validateIncident", () => {
  it("accepts a valid report with manual location and no GPS", () => {
    expect(validateIncident(validIncident)).toEqual({});
  });

  it("requires category, reporter type, and a location but not a description", () => {
    expect(validateIncident({ ...validIncident, category: " ", reporter_type: "", location_text: "" })).toEqual({
      category: "Choose an emergency category.",
      reporter_type: "Choose who is reporting this emergency.",
      location: "Use your current location or enter a location manually.",
    });
  });

  it("rejects overlong descriptions and out-of-range GPS without manual fallback", () => {
    const errors = validateIncident({
      ...validIncident,
      description: "x".repeat(1001),
      latitude: 91,
      longitude: 181,
      location_text: "",
    });
    expect(errors.description).toContain("no more than 1000 characters");
    expect(errors.location).toContain("GPS coordinates are invalid");
  });

  it("requires complete GPS pairs if manual location is empty", () => {
    expect(validateIncident({ ...validIncident, latitude: 12, location_text: "" }).location).toContain("complete latitude");
  });

  it("rejects an injured count above the affected count", () => {
    expect(validateIncident({ ...validIncident, people_affected: 2, people_injured: 3 }).people_injured).toContain("cannot exceed");
  });
});
