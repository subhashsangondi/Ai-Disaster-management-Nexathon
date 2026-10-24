import { describe, expect, it } from "vitest";
import { contactNumberError, normalizeContactNumber } from "./contactNumber.js";
import { isUsableCoordinate } from "./geolocation.js";

describe("contact numbers", () => {
  it("accepts empty, Indian, and international formats", () => {
    for (const value of ["", "   ", "+91 98765 43210", "9876543210", "022-2345 6789", "+1 (415) 555-0100", "+442079460958"]) {
      expect(contactNumberError(value)).toBe("");
    }
    expect(normalizeContactNumber(" +91 98765-43210 ")).toBe("+919876543210");
  });

  it("rejects letters, too few digits, and too many digits", () => {
    for (const value of ["call me", "12345", "+1234567890123456", "98765abc10", "++919876543210"]) {
      expect(contactNumberError(value)).not.toBe("");
    }
  });
});

describe("coordinate validation", () => {
  it("rejects 0,0, out-of-range, and non-finite coordinates", () => {
    expect(isUsableCoordinate(12.87, 74.84)).toBe(true);
    expect(isUsableCoordinate(0, 0)).toBe(false);
    expect(isUsableCoordinate(-91, 0)).toBe(false);
    expect(isUsableCoordinate(10, 181)).toBe(false);
    expect(isUsableCoordinate(Number.NaN, 10)).toBe(false);
  });
});
