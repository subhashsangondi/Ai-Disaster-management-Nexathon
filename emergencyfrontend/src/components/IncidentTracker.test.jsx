import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import IncidentTracker from "./IncidentTracker.jsx";
import { trackIncident } from "../services/incidents.js";

vi.mock("../services/incidents.js", () => ({ trackIncident: vi.fn() }));

describe("IncidentTracker", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the private token and renders only safe tracking fields", async () => {
    const onVerifiedIncident = vi.fn();
    trackIncident.mockResolvedValue({
      incident_reference: "30000000-0000-4000-8000-000000000001",
      emergency_type: "Flood",
      status: "in_progress",
      last_updated_at: "2026-10-24T10:00:00Z",
      progress_messages: ["The rescue response is currently in progress."],
    });
    render(<IncidentTracker initialToken="private-token" onVerifiedIncident={onVerifiedIncident} />);
    await userEvent.click(screen.getByRole("button", { name: /check incident status/i }));
    expect(await screen.findByText("in progress")).toBeInTheDocument();
    expect(trackIncident).toHaveBeenCalledWith("private-token");
    expect(onVerifiedIncident).toHaveBeenCalledWith(expect.objectContaining({
      incident_reference: "30000000-0000-4000-8000-000000000001",
      status: "in_progress",
    }));
    expect(screen.getByText(/rescue response is currently in progress/i)).toBeInTheDocument();
  });

  it("shows invalid-token errors without inventing a status", async () => {
    trackIncident.mockRejectedValue(new Error("No incident was found for this tracking token"));
    render(<IncidentTracker />);
    await userEvent.type(screen.getByLabelText("Tracking token"), "wrong-token");
    await userEvent.click(screen.getByRole("button", { name: /check incident status/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No incident was found");
    expect(screen.queryByText("Verified status")).not.toBeInTheDocument();
  });
});
