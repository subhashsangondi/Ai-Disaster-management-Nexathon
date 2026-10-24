import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SosStatusCard from "./SosStatusCard.jsx";
import { trackIncident } from "../services/incidents.js";

vi.mock("../services/incidents.js", () => ({ trackIncident: vi.fn() }));

const reference = "30000000-0000-4000-8000-000000000001";
const token = "private-token-abcdefghijklmnopqrstuvwxyz-WXYZ";
const quickSos = { id: reference, status: "pending", submissionMode: "quick_sos", trackingToken: token, reportedAt: "2026-10-24T09:00:00Z" };
const verified = (status, message, overrides = {}) => ({
  incident_reference: reference,
  emergency_type: "Unknown",
  submission_mode: "quick_sos",
  status,
  submitted_at: "2026-10-24T09:00:00Z",
  last_updated_at: "2026-10-24T09:05:00Z",
  progress_messages: [message],
  ...overrides,
});

describe("SosStatusCard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows one unified status with reference, time, verified message and triage state", async () => {
    trackIncident.mockResolvedValue(verified("pending", "Your Quick SOS location has been received and is awaiting operator triage."));
    render(<SosStatusCard incident={quickSos} />);

    expect(screen.getAllByRole("heading", { name: "Your SOS Status" })).toHaveLength(1);
    expect(await screen.findByText(/awaiting operator triage\.$/)).toBeInTheDocument();
    expect(trackIncident).toHaveBeenCalledWith(token);
    expect(screen.getAllByText(reference)).toHaveLength(1);
    expect(screen.getByText("Received")).toBeInTheDocument();
    expect(screen.getByText("Awaiting operator triage")).toBeInTheDocument();
    expect(screen.getByText("No rescue team has been assigned yet.")).toBeInTheDocument();
    expect(screen.queryByText(/A rescue team has been assigned/)).not.toBeInTheDocument();
    expect(screen.getByText("Submitted")).toBeInTheDocument();
  });

  it("only reports a team assignment once the verified status says so, via Refresh Status", async () => {
    trackIncident
      .mockResolvedValueOnce(verified("pending", "Your Quick SOS location has been received and is awaiting operator triage."))
      .mockResolvedValueOnce(verified("assigned", "A rescue team has been assigned to your incident."));
    render(<SosStatusCard incident={quickSos} />);
    await screen.findByText("Awaiting operator triage");
    expect(screen.queryByText("A rescue team has been assigned.")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Refresh Status" }));
    expect(await screen.findByText("Rescue team assigned")).toBeInTheDocument();
    expect(screen.getByText("A rescue team has been assigned.")).toBeInTheDocument();
    expect(screen.getByText("A rescue team has been assigned to your incident.")).toBeInTheDocument();
    expect(screen.queryByText("Awaiting operator triage")).not.toBeInTheDocument();
    expect(trackIncident).toHaveBeenCalledTimes(2);
  });

  it("keeps the last known status and offers retry when a refresh fails", async () => {
    trackIncident
      .mockRejectedValueOnce(new Error("Could not reach the tracking service."))
      .mockResolvedValueOnce(verified("in_progress", "The rescue response is currently in progress."));
    render(<SosStatusCard incident={quickSos} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the tracking service. Your SOS is still saved.");
    expect(screen.getByText("Received")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Refresh Status" }));
    expect(await screen.findByText("Response in progress")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("never shows a status that belongs to a different incident", async () => {
    trackIncident.mockResolvedValue(verified("resolved", "The rescue response has been verified as completed.", { incident_reference: "OTHER" }));
    render(<SosStatusCard incident={quickSos} />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/did not match this SOS/);
    expect(screen.queryByText("Resolved")).not.toBeInTheDocument();
    expect(screen.getByText("Received")).toBeInTheDocument();
  });

  it("issues the token with a copy action and a privacy reminder, then masks it once saved", async () => {
    trackIncident.mockResolvedValue(verified("pending", "Awaiting triage."));
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(<SosStatusCard incident={quickSos} />);

    expect(screen.getByTestId("tracking-token-value")).toHaveTextContent(token);
    expect(screen.getByText(/Keep this token private/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Copy token" }));
    expect(writeText).toHaveBeenCalledWith(token);
    expect(await screen.findByText(/Token copied/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /hide token/ }));
    expect(screen.getByTestId("tracking-token-value")).toHaveTextContent("•••• WXYZ");
    expect(screen.queryByText(token)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show token" }));
    expect(screen.getByTestId("tracking-token-value")).toHaveTextContent(token);
  });

  it("falls back to manual copying when the clipboard is unavailable", async () => {
    trackIncident.mockResolvedValue(verified("pending", "Awaiting triage."));
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    render(<SosStatusCard incident={quickSos} />);
    await user.click(screen.getByRole("button", { name: /hide token/ }));
    await user.click(screen.getByRole("button", { name: "Copy token" }));
    expect(await screen.findByText(/copy it manually/)).toBeInTheDocument();
    expect(screen.getByTestId("tracking-token-value")).toHaveTextContent(token);
  });

  it("does not track or offer refresh without a private token", async () => {
    render(<SosStatusCard incident={{ id: reference, status: "pending", submissionMode: "detailed" }} />);
    expect(screen.getByText(/No private tracking token was issued/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Refresh Status" })).not.toBeInTheDocument();
    await waitFor(() => expect(trackIncident).not.toHaveBeenCalled());
  });
});
