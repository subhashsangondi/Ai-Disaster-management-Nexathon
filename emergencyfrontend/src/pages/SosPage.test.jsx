import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SosPage from "./SosPage.jsx";
import { submitIncident } from "../services/incidents.js";

vi.mock("../services/incidents.js", () => ({ submitIncident: vi.fn() }));
vi.mock("../components/EmergencyLocationMap.jsx", () => ({
  default: ({ latitude, longitude, onSelectLocation }) => (
    <div>
      <p data-testid="map-coordinates">{latitude ?? "none"},{longitude ?? "none"}</p>
      <button type="button" onClick={() => onSelectLocation(12.25, 77.5)}>Choose map location</button>
    </div>
  ),
}));

const originalGeolocation = navigator.geolocation;
const originalMediaDevices = navigator.mediaDevices;
const originalMediaRecorder = window.MediaRecorder;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

function renderSosPage() {
  return render(
    <MemoryRouter>
      <SosPage />
    </MemoryRouter>,
  );
}

function provideGeolocation(getCurrentPosition) {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: { getCurrentPosition },
  });
}

function provideLocation(latitude = 1.25, longitude = -2.75) {
  provideGeolocation((success) => success({ coords: { latitude, longitude } }));
}

describe("dedicated SOS page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (originalGeolocation === undefined) {
      delete navigator.geolocation;
    } else {
      Object.defineProperty(navigator, "geolocation", { configurable: true, value: originalGeolocation });
    }
    if (originalMediaDevices === undefined) {
      delete navigator.mediaDevices;
    } else {
      Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: originalMediaDevices });
    }
    if (originalMediaRecorder === undefined) {
      delete window.MediaRecorder;
    } else {
      Object.defineProperty(window, "MediaRecorder", { configurable: true, value: originalMediaRecorder });
    }
    if (originalCreateObjectURL === undefined) {
      delete URL.createObjectURL;
    } else {
      Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreateObjectURL });
    }
    if (originalRevokeObjectURL === undefined) {
      delete URL.revokeObjectURL;
    } else {
      Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalRevokeObjectURL });
    }
  });

  it("requests GPS on entry and displays the real coordinates on the map", async () => {
    const getCurrentPosition = vi.fn((success) => success({ coords: { latitude: 12.345678, longitude: 76.54321 } }));
    provideGeolocation(getCurrentPosition);
    renderSosPage();

    await waitFor(() => expect(screen.getByTestId("map-coordinates")).toHaveTextContent("12.345678,76.54321"));
    expect(getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ enableHighAccuracy: true, maximumAge: 0 }),
    );
    expect(screen.getByText(/Browser-detected coordinates/)).toHaveTextContent("12.345678, 76.543210");
  });

  it("allows a map-selected location after GPS denial and submits a confirmed SOS", async () => {
    provideGeolocation((_success, failure) => failure({ code: 1 }));
    submitIncident.mockResolvedValue({
      id: "SOS-1001",
      message: "Emergency report received by RescueGrid AI",
      status: "pending",
    });
    renderSosPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Location permission was denied");
    await userEvent.click(screen.getByRole("button", { name: "Choose map location" }));
    expect(screen.getByTestId("map-coordinates")).toHaveTextContent("12.25,77.5");
    expect(screen.getByText(/Map-selected coordinates/)).toHaveTextContent("12.250000, 77.500000");

    await userEvent.click(screen.getByRole("button", { name: "Send SOS" }));
    expect(await screen.findByText("SOS-1001")).toBeInTheDocument();
    expect(submitIncident).toHaveBeenCalledWith({
      emergency_type: "SOS",
      description: "SOS emergency reported; no additional details provided.",
      latitude: 12.25,
      longitude: 77.5,
      location_text: null,
    });
  });

  it("requires a selected location and reports network failures without clearing it", async () => {
    provideGeolocation((_success, failure) => failure({ code: 2 }));
    submitIncident.mockRejectedValueOnce(new Error("Could not reach the reporting server.")).mockResolvedValueOnce({
      id: "SOS-RETRY",
      message: "Received",
      status: "pending",
    });
    renderSosPage();

    await userEvent.click(screen.getByRole("button", { name: "Send SOS" }));
    expect(screen.getByText("Choose a valid emergency location on the map before sending SOS.")).toBeInTheDocument();
    expect(submitIncident).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Choose map location" }));
    await userEvent.click(screen.getByRole("button", { name: "Send SOS" }));
    expect(await screen.findByText("Could not reach the reporting server.")).toBeInTheDocument();
    expect(screen.getByTestId("map-coordinates")).toHaveTextContent("12.25,77.5");

    await userEvent.click(screen.getByRole("button", { name: "Send SOS" }));
    expect(await screen.findByText("SOS-RETRY")).toBeInTheDocument();
    expect(submitIncident).toHaveBeenCalledTimes(2);
  });

  it("keeps recorded audio local and requires removal before sending", async () => {
    provideLocation();
    const stopTrack = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }) },
    });
    class MockMediaRecorder {
      static isTypeSupported() {
        return false;
      }

      constructor() {
        this.state = "inactive";
        this.mimeType = "audio/webm";
      }

      start() {
        this.state = "recording";
      }

      stop() {
        this.state = "inactive";
        this.ondataavailable({ data: new Blob(["voice note"], { type: this.mimeType }) });
        this.onstop();
      }
    }
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: MockMediaRecorder });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:voice-note") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    submitIncident.mockResolvedValue({ id: "SOS-AUDIO-REMOVED", status: "pending" });
    renderSosPage();

    await userEvent.click(screen.getByRole("button", { name: "Record" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Recording in progress");
    await userEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(await screen.findByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(stopTrack).toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Send SOS" }));
    expect(screen.getByRole("alert")).toHaveTextContent("cannot accept voice-note uploads");
    expect(submitIncident).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    await userEvent.click(screen.getByRole("button", { name: "Send SOS" }));
    expect(await screen.findByText("SOS-AUDIO-REMOVED")).toBeInTheDocument();
    expect(submitIncident).toHaveBeenCalledTimes(1);
  });
});
