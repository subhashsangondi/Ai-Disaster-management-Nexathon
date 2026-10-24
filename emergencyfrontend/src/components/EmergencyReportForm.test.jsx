import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EmergencyReportForm from "./EmergencyReportForm.jsx";
import { submitIncident } from "../services/incidents.js";
import { createPendingSOS, deliverPendingSOS } from "../services/offlineSos.js";

vi.mock("../services/incidents.js", () => ({
  IncidentApiError: class IncidentApiError extends Error {
    constructor(message, status = 0) {
      super(message);
      this.status = status;
    }
  },
  submitIncident: vi.fn(),
}));
vi.mock("../services/offlineSos.js", () => ({
  createPendingSOS: vi.fn(),
  createSOSId: vi.fn(() => "30000000-0000-4000-8000-000000000099"),
  deliverPendingSOS: vi.fn(),
  SOSDeviceOfflineError: class SOSDeviceOfflineError extends Error {},
  sosReceivedEvent: "rescuegrid:sos-received",
}));

const clientId = "30000000-0000-4000-8000-000000000099";

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(/What kind of emergency/), { target: { value: "Flood" } });
  fireEvent.change(screen.getByLabelText(/Emergency details/), { target: { value: "Water is entering a residential building." } });
  fireEvent.change(screen.getByLabelText(/Manual location/), { target: { value: "Oak Street" } });
}

describe("EmergencyReportForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createPendingSOS.mockImplementation(async (payload) => ({ id: clientId, payload, status: "pending", stored: true }));
    deliverPendingSOS.mockImplementation((report) => submitIncident(report.payload, report.id));
  });

  it("validates required fields before sending", async () => {
    render(<EmergencyReportForm />);
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));
    expect(await screen.findByText("Choose an emergency category.")).toBeInTheDocument();
    expect(screen.getByText(/at least 10 characters/)).toBeInTheDocument();
    expect(submitIncident).not.toHaveBeenCalled();
    expect(createPendingSOS).not.toHaveBeenCalled();
  });

  it("submits the exact backend fields and displays the returned incident ID", async () => {
    submitIncident.mockResolvedValue({
      id: "30000000-0000-4000-8000-000000000001",
      message: "Emergency report received by RescueGrid AI",
      status: "pending",
      analysisStatus: "pending",
      notice: "Stored immediately",
    });
    render(<EmergencyReportForm />);
    fillRequiredFields();
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));

    expect(await screen.findByText("30000000-0000-4000-8000-000000000001")).toBeInTheDocument();
    expect(screen.getByText("Stored immediately")).toBeInTheDocument();
    expect(submitIncident).toHaveBeenCalledWith({
      emergency_type: "Flood",
      description: "Water is entering a residential building.",
      latitude: null,
      longitude: null,
      location_text: "Oak Street",
    }, clientId);
  });

  it("keeps an offline SOS queued and retries it with the same ID", async () => {
    submitIncident.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ id: clientId, message: "Received", status: "pending" });
    render(<EmergencyReportForm />);
    fillRequiredFields();
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));

    expect(await screen.findByRole("heading", { name: "Saved on this device" })).toBeInTheDocument();
    expect(screen.getAllByText(/server has not confirmed whether it received/i)).toHaveLength(2);
    expect(createPendingSOS).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("button", { name: "Try sending again" }));
    expect(await screen.findByText(clientId)).toBeInTheDocument();
    expect(deliverPendingSOS.mock.calls.map(([report]) => report.id)).toEqual([clientId, clientId]);
  });

  it("handles denied geolocation and still allows a manual location", async () => {
    const getCurrentPosition = vi.fn((_success, failure) => failure({ code: 1 }));
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition } });
    render(<EmergencyReportForm />);
    await userEvent.click(screen.getByRole("button", { name: "Use My Current Location" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Location permission was denied");
    expect(screen.getByLabelText(/Manual location/)).toBeEnabled();
  });

  it("submits browser-provided coordinates", async () => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: (success) => success({ coords: { latitude: 1.25, longitude: -2.75 } }) },
    });
    submitIncident.mockResolvedValue({ id: clientId, message: "Received", status: "pending" });
    render(<EmergencyReportForm />);
    await userEvent.click(screen.getByRole("button", { name: "Use My Current Location" }));
    fireEvent.change(screen.getByLabelText(/What kind of emergency/), { target: { value: "Flood" } });
    fireEvent.change(screen.getByLabelText(/Emergency details/), { target: { value: "Water is entering a residential building." } });
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));

    expect(await screen.findByText(clientId)).toBeInTheDocument();
    expect(submitIncident).toHaveBeenCalledWith(expect.objectContaining({ latitude: 1.25, longitude: -2.75, location_text: null }), clientId);
  });

  it("locks immediately against repeated submit events", async () => {
    let resolveSubmission;
    deliverPendingSOS.mockReturnValue(new Promise((resolve) => { resolveSubmission = resolve; }));
    render(<EmergencyReportForm />);
    fillRequiredFields();
    const form = screen.getByRole("button", { name: "Send Emergency Report" }).closest("form");
    fireEvent.submit(form);
    fireEvent.submit(form);

    await waitFor(() => expect(createPendingSOS).toHaveBeenCalledTimes(1));
    expect(deliverPendingSOS).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Sending report..." })).toBeDisabled();
    resolveSubmission({ id: "INC-23", message: "Received", status: "pending" });
    await waitFor(() => expect(screen.getByText("INC-23")).toBeInTheDocument());
  });
});
