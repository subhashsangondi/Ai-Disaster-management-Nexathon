import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LocationPicker from "./LocationPicker.jsx";

vi.mock("./EmergencyLocationMap.jsx", () => ({
  default: () => <div data-testid="emergency-location-map" />,
}));

const values = {
  latitude: null,
  longitude: null,
  location_text: "",
};

describe("LocationPicker", () => {
  it("explains how to continue when geolocation is unsupported", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined });
    render(<LocationPicker values={values} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Use My Current Location" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("does not support location access");
    expect(screen.getByLabelText("Manual location")).toBeEnabled();
  });

  it.each([
    [2, "position is unavailable"],
    [3, "took too long"],
  ])("explains geolocation error code %s", async (code, message) => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: (_success, failure) => failure({ code }) },
    });
    render(<LocationPicker values={values} onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Use My Current Location" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText("Manual location")).toBeEnabled();
  });
});
