import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.jsx";
import { submitIncident, trackIncident } from "./services/incidents.js";

vi.mock("./services/incidents.js", () => ({ submitIncident: vi.fn(), trackIncident: vi.fn(), addQuickSosDetails: vi.fn() }));

const token = "private-token-0123456789-abcdefghijklmnop";
const pendingStatus = (reference, mode = "detailed") => ({
  incident_reference: reference,
  emergency_type: "Flood",
  submission_mode: mode,
  status: "pending",
  submitted_at: "2026-10-24T10:00:00Z",
  last_updated_at: "2026-10-24T10:00:00Z",
  progress_messages: ["Your emergency report has been received and is awaiting operator review."],
});

async function submitDetailedReport() {
  fireEvent.change(screen.getByLabelText(/What kind of emergency/), { target: { value: "Flood" } });
  fireEvent.change(screen.getByLabelText(/Emergency details/), { target: { value: "River water has reached nearby homes." } });
  fireEvent.change(screen.getByLabelText(/Manual location/), { target: { value: "River Road" } });
  await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));
  await screen.findByText(/awaiting operator review/);
}

describe("public incident confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  });
  afterEach(() => Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined }));

  it("shows exactly one status card after a detailed report, with no duplicated status content", async () => {
    submitIncident.mockResolvedValue({ id: "INC-808", message: "Report received", status: "pending", trackingToken: token });
    trackIncident.mockResolvedValue(pendingStatus("INC-808"));
    render(<App />);
    expect(screen.getByText("Ready when you are")).toBeInTheDocument();

    await submitDetailedReport();

    expect(screen.getAllByRole("heading", { name: "Your SOS Status" })).toHaveLength(1);
    expect(screen.getAllByText("INC-808")).toHaveLength(1);
    expect(screen.getAllByText(token)).toHaveLength(1);
    expect(screen.getAllByText("Received")).toHaveLength(1);
    expect(screen.getAllByText("Submitted")).toHaveLength(1);
    expect(screen.queryByText("Incident status")).not.toBeInTheDocument();
    expect(screen.queryByText("Ready when you are")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open secure tracking" })).not.toBeInTheDocument();
    expect(screen.queryByText("A rescue team has been assigned.")).not.toBeInTheDocument();
    expect(trackIncident).toHaveBeenCalledWith(token);
    expect(trackIncident).not.toHaveBeenCalledWith("INC-808");
  });

  it("shows one status card after a Quick SOS and keeps the optional details form", async () => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: (success) => success({ coords: { latitude: 12.9, longitude: 74.8, accuracy: 10 }, timestamp: Date.now() }) },
    });
    submitIncident.mockResolvedValue({ id: "INC-QS", status: "pending", submissionMode: "quick_sos", trackingToken: token });
    trackIncident.mockResolvedValue(pendingStatus("INC-QS", "quick_sos"));
    render(<App />);

    await userEvent.click(screen.getByRole("button", { name: "SEND QUICK SOS" }));
    expect(await screen.findByText("SOS received")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { name: "Your SOS Status" })).toHaveLength(1);
    expect(screen.getAllByText("INC-QS")).toHaveLength(1);
    expect(screen.getByText("Awaiting operator triage")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fire" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save number" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Track my SOS|Open secure tracking/ })).not.toBeInTheDocument();
  });

  it("keeps secure tracking available separately, requiring a pasted private token", async () => {
    submitIncident.mockResolvedValue({ id: "INC-808", message: "Report received", status: "pending", trackingToken: token });
    trackIncident.mockResolvedValue(pendingStatus("INC-808"));
    render(<App />);
    await submitDetailedReport();

    await userEvent.click(screen.getByRole("button", { name: "Track incident" }));
    const tokenField = screen.getByLabelText("Tracking token");
    expect(tokenField).toHaveValue("");
    expect(screen.getByRole("button", { name: /check incident status/i })).toBeDisabled();
    expect(screen.queryByRole("heading", { name: "Your SOS Status" })).not.toBeInTheDocument();

    trackIncident.mockClear();
    trackIncident.mockResolvedValueOnce({ ...pendingStatus("INC-808"), status: "assigned", progress_messages: ["A rescue team has been assigned to your incident."] });
    fireEvent.change(tokenField, { target: { value: token } });
    await userEvent.click(screen.getByRole("button", { name: /check incident status/i }));
    const tracker = screen.getByRole("region", { name: "Secure incident tracking" });
    expect(await within(tracker).findByText("assigned")).toBeInTheDocument();
    expect(trackIncident).toHaveBeenCalledWith(token);

    // Returning to the report view keeps the submitted SOS status and its token.
    await userEvent.click(screen.getByRole("button", { name: "Report emergency" }));
    expect(screen.getByRole("heading", { name: "Your SOS Status" })).toBeInTheDocument();
    expect(screen.getByTestId("tracking-token-value")).toHaveTextContent(token);
  });

  it("restores the pre-submission panel after the victim starts a new report", async () => {
    submitIncident.mockResolvedValue({ id: "INC-808", message: "Report received", status: "pending", trackingToken: token });
    trackIncident.mockResolvedValue(pendingStatus("INC-808"));
    render(<App />);
    await submitDetailedReport();
    await userEvent.click(screen.getByRole("button", { name: "Submit Another Report" }));
    expect(screen.getByText("Ready when you are")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your SOS Status" })).not.toBeInTheDocument();
  });

  it("shows the server error and no status card when submission fails", async () => {
    submitIncident.mockRejectedValue(new Error("Could not reach the reporting server."));
    render(<App />);
    fireEvent.change(screen.getByLabelText(/What kind of emergency/), { target: { value: "Flood" } });
    fireEvent.change(screen.getByLabelText(/Emergency details/), { target: { value: "River water has reached nearby homes." } });
    fireEvent.change(screen.getByLabelText(/Manual location/), { target: { value: "River Road" } });
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the reporting server.");
    expect(screen.getByText(/has not confirmed this report yet/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your SOS Status" })).not.toBeInTheDocument();
  });
});
