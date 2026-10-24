import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import QuickSos from "./QuickSos.jsx";
import { addQuickSosDetails, submitIncident, trackIncident } from "../services/incidents.js";

vi.mock("../services/incidents.js", () => ({ submitIncident: vi.fn(), addQuickSosDetails: vi.fn(), trackIncident: vi.fn() }));

const sentResponse = { id: "INC-QS-1", message: "Quick SOS received", status: "pending", trackingToken: "private-quick-token", submissionMode: "quick_sos" };

function mockGeolocation(getCurrentPosition) {
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: getCurrentPosition ? { getCurrentPosition } : undefined });
}

function succeedWith(coords, timestamp = Date.parse("2026-10-24T09:00:00.000Z")) {
  return vi.fn((success) => success({ coords, timestamp }));
}

describe("QuickSos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    trackIncident.mockResolvedValue({ incident_reference: "INC-QS-1", submission_mode: "quick_sos", status: "pending", submitted_at: "2026-10-24T09:00:00Z", last_updated_at: "2026-10-24T09:00:00Z", progress_messages: ["Your Quick SOS location has been received and is awaiting operator triage."] });
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  });
  afterEach(() => mockGeolocation(undefined));

  it("renders a prominent, accessible Quick SOS button and the 112 notice", () => {
    render(<QuickSos />);
    const button = screen.getByRole("button", { name: "SEND QUICK SOS" });
    expect(button).toBeEnabled();
    expect(button).toHaveAccessibleDescription("Share your location and request help. No typing required.");
    expect(screen.getByRole("link", { name: /Call 112/ })).toHaveAttribute("href", "tel:112");
    expect(screen.getByText(/not connected to official emergency services/)).toBeInTheDocument();
  });

  it("captures a high-accuracy location and submits it as a Quick SOS", async () => {
    const getCurrentPosition = succeedWith({ latitude: 12.871, longitude: 74.842, accuracy: 15.04 });
    mockGeolocation(getCurrentPosition);
    submitIncident.mockResolvedValue(sentResponse);
    const onProgressChange = vi.fn();
    render(<QuickSos onProgressChange={onProgressChange} />);

    await userEvent.click(screen.getByRole("button", { name: "SEND QUICK SOS" }));

    expect(await screen.findByText("SOS received")).toBeInTheDocument();
    expect(getCurrentPosition.mock.calls[0][2]).toEqual({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    expect(submitIncident).toHaveBeenCalledWith({
      submission_mode: "quick_sos",
      latitude: 12.871,
      longitude: 74.842,
      location_accuracy_meters: 15,
      location_captured_at: "2026-10-24T09:00:00.000Z",
    });
    expect(screen.getAllByRole("heading", { name: "Your SOS Status" })).toHaveLength(1);
    expect(screen.getAllByText("INC-QS-1")).toHaveLength(1);
    expect(screen.getByText("private-quick-token")).toBeInTheDocument();
    expect(screen.getByText("Awaiting operator triage")).toBeInTheDocument();
    expect(screen.getByText("No rescue team has been assigned yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Track my SOS|Open secure tracking/ })).not.toBeInTheDocument();
    expect(trackIncident).toHaveBeenCalledWith("private-quick-token");
    expect(onProgressChange).toHaveBeenLastCalledWith(expect.objectContaining({ id: "INC-QS-1" }));
  });

  it.each([
    [1, /permission was denied/],
    [2, /location is unavailable/],
    [3, /took too long/],
  ])("handles geolocation error code %i with a manual fallback and no submission", async (code, message) => {
    mockGeolocation(vi.fn((_success, failure) => failure({ code })));
    render(<QuickSos />);
    await userEvent.click(screen.getByRole("button", { name: "SEND QUICK SOS" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText("Where are you?")).toBeInTheDocument();
    expect(submitIncident).not.toHaveBeenCalled();
    expect(screen.queryByText("SOS received")).not.toBeInTheDocument();
  });

  it("reports unsupported browsers and insecure contexts without calling the API", async () => {
    mockGeolocation(undefined);
    const { unmount } = render(<QuickSos />);
    await userEvent.click(screen.getByRole("button", { name: "SEND QUICK SOS" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/cannot share your location/);
    unmount();

    const getCurrentPosition = succeedWith({ latitude: 1, longitude: 1 });
    mockGeolocation(getCurrentPosition);
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    render(<QuickSos />);
    await userEvent.click(screen.getByRole("button", { name: "SEND QUICK SOS" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/secure \(HTTPS\)/);
    expect(getCurrentPosition).not.toHaveBeenCalled();
    expect(submitIncident).not.toHaveBeenCalled();
  });

  it.each([
    [{ latitude: 0, longitude: 0 }],
    [{ latitude: 95, longitude: 10 }],
    [{ latitude: Number.NaN, longitude: 10 }],
  ])("rejects invalid coordinates %o instead of submitting them", async (coords) => {
    mockGeolocation(succeedWith(coords));
    render(<QuickSos />);
    await userEvent.click(screen.getByRole("button", { name: "SEND QUICK SOS" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/unusable location/);
    expect(submitIncident).not.toHaveBeenCalled();
  });

  it("submits a manually entered location after location failure", async () => {
    mockGeolocation(vi.fn((_success, failure) => failure({ code: 1 })));
    submitIncident.mockResolvedValue(sentResponse);
    render(<QuickSos />);
    await userEvent.click(screen.getByRole("button", { name: "SEND QUICK SOS" }));
    await userEvent.click(await screen.findByRole("button", { name: /Send SOS with this location/ }));
    expect(screen.getByText("Enter an address, landmark, or directions.")).toBeInTheDocument();
    expect(submitIncident).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Where are you?"), { target: { value: "Near the bus stand" } });
    await userEvent.click(screen.getByRole("button", { name: /Send SOS with this location/ }));
    expect(await screen.findByText("SOS received")).toBeInTheDocument();
    expect(submitIncident).toHaveBeenCalledWith({ submission_mode: "quick_sos", location_text: "Near the bus stand" });
  });

  it("does not claim success when the backend fails, and retries without re-locating", async () => {
    const getCurrentPosition = succeedWith({ latitude: 12.9, longitude: 74.8, accuracy: 20 });
    mockGeolocation(getCurrentPosition);
    submitIncident.mockRejectedValueOnce(new Error("Could not reach the reporting server.")).mockResolvedValueOnce(sentResponse);
    render(<QuickSos />);
    await userEvent.click(screen.getByRole("button", { name: "SEND QUICK SOS" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("SOS not sent. Could not reach the reporting server.");
    expect(screen.queryByText("SOS received")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Retry sending SOS/ }));
    expect(await screen.findByText("SOS received")).toBeInTheDocument();
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(submitIncident.mock.calls[1][0]).toEqual(submitIncident.mock.calls[0][0]);
  });

  it("ignores repeated taps while locating and submitting", async () => {
    let resolveLocation;
    mockGeolocation(vi.fn((success) => { resolveLocation = success; }));
    let resolveSubmission;
    submitIncident.mockReturnValue(new Promise((resolve) => { resolveSubmission = resolve; }));
    render(<QuickSos />);
    const button = screen.getByRole("button", { name: "SEND QUICK SOS" });

    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(navigator.geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Finding your location..." })).toBeDisabled();

    resolveLocation({ coords: { latitude: 12.9, longitude: 74.8, accuracy: 10 }, timestamp: Date.now() });
    expect(await screen.findByRole("button", { name: "Sending SOS..." })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Sending SOS..." }));
    expect(submitIncident).toHaveBeenCalledTimes(1);

    resolveSubmission(sentResponse);
    expect(await screen.findByText("SOS received")).toBeInTheDocument();
    expect(submitIncident).toHaveBeenCalledTimes(1);
  });

  it("lets the victim add an emergency type and contact number after the SOS is saved", async () => {
    mockGeolocation(succeedWith({ latitude: 12.9, longitude: 74.8 }));
    submitIncident.mockResolvedValue(sentResponse);
    addQuickSosDetails.mockResolvedValue({ incident_reference: "INC-QS-1" });
    render(<QuickSos />);
    expect(screen.queryByRole("button", { name: "Fire" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "SEND QUICK SOS" }));
    await screen.findByText("SOS received");

    await userEvent.click(screen.getByRole("button", { name: "Fire" }));
    expect(addQuickSosDetails).toHaveBeenCalledWith("private-quick-token", { emergency_type: "Fire" });
    expect(await screen.findByText(/Added emergency type: Fire/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fire" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.change(screen.getByLabelText("Contact number (optional)"), { target: { value: "12ab" } });
    await userEvent.click(screen.getByRole("button", { name: "Save number" }));
    expect(screen.getByText(/Enter a valid phone number/)).toBeInTheDocument();
    expect(addQuickSosDetails).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("Contact number (optional)"), { target: { value: "+91 98765 43210" } });
    await userEvent.click(screen.getByRole("button", { name: "Save number" }));
    expect(addQuickSosDetails).toHaveBeenLastCalledWith("private-quick-token", { contact_number: "+919876543210" });
    expect(await screen.findByText("Contact number added to your SOS.")).toBeInTheDocument();
  });

  it("keeps the SOS confirmed when adding optional details fails", async () => {
    mockGeolocation(succeedWith({ latitude: 12.9, longitude: 74.8 }));
    submitIncident.mockResolvedValue(sentResponse);
    addQuickSosDetails.mockRejectedValue(new Error("Could not reach the server. Your SOS is still saved; try adding details again."));
    render(<QuickSos />);
    await userEvent.click(screen.getByRole("button", { name: "SEND QUICK SOS" }));
    await screen.findByText("SOS received");
    await userEvent.click(screen.getByRole("button", { name: "Medical" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Your SOS is still saved/);
    expect(screen.getByText("SOS received")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Medical" })).toHaveAttribute("aria-pressed", "false"));
  });
});
