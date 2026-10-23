import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.jsx";
import { submitIncident, trackIncident } from "./services/incidents.js";

vi.mock("./services/incidents.js", () => ({ submitIncident: vi.fn(), trackIncident: vi.fn() }));

describe("public incident confirmation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows receipt status and the private tracking capability", async () => {
    submitIncident.mockResolvedValue({ id: "INC-808", message: "Report received", status: "pending", trackingToken: "private-token" });
    render(<App />);
    fireEvent.change(screen.getByLabelText(/What kind of emergency/), { target: { value: "Flood" } });
    fireEvent.change(screen.getByLabelText(/Emergency details/), { target: { value: "River water has reached nearby homes." } });
    fireEvent.change(screen.getByLabelText(/Manual location/), { target: { value: "River Road" } });

    expect(screen.getByText("Ready when you are")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));

    expect(await screen.findByText("Incident status")).toBeInTheDocument();
    expect(screen.getByText("pending", { selector: "h2" })).toBeInTheDocument();
    expect(screen.getByText(/Use your private token to see safe response updates/)).toBeInTheDocument();
    expect(screen.getByText("private-token")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open secure tracking" })).toBeInTheDocument();
    expect(screen.getAllByText("INC-808")).toHaveLength(2);
    expect(screen.queryByText("Rescue team assigned")).not.toBeInTheDocument();
  });

  it("synchronizes the sidebar through repeated verified status checks for the submitted incident", async () => {
    submitIncident.mockResolvedValue({ id: "INC-808", message: "Report received", status: "pending", trackingToken: "private-token" });
    trackIncident
      .mockResolvedValueOnce({ incident_reference: "INC-808", emergency_type: "Flood", status: "assigned", last_updated_at: "2026-10-24T10:00:00Z", progress_messages: ["A rescue team has been assigned."] })
      .mockResolvedValueOnce({ incident_reference: "INC-808", emergency_type: "Flood", status: "in_progress", last_updated_at: "2026-10-24T10:10:00Z", progress_messages: ["The rescue response is in progress."] })
      .mockResolvedValueOnce({ incident_reference: "INC-808", emergency_type: "Flood", status: "resolved", last_updated_at: "2026-10-24T10:20:00Z", progress_messages: ["The response was verified as completed."] });

    render(<App />);
    fireEvent.change(screen.getByLabelText(/What kind of emergency/), { target: { value: "Flood" } });
    fireEvent.change(screen.getByLabelText(/Emergency details/), { target: { value: "River water has reached nearby homes." } });
    fireEvent.change(screen.getByLabelText(/Manual location/), { target: { value: "River Road" } });
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));
    expect(await screen.findByText("pending", { selector: "h2" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Open secure tracking" }));
    const checkStatus = screen.getByRole("button", { name: /check incident status/i });
    await userEvent.click(checkStatus);
    expect(await screen.findByText("assigned", { selector: "h2" })).toBeInTheDocument();
    await userEvent.click(checkStatus);
    expect(await screen.findByText("in progress", { selector: "h2" })).toBeInTheDocument();
    await userEvent.click(checkStatus);
    expect(await screen.findByText("resolved", { selector: "h2" })).toBeInTheDocument();
    expect(trackIncident).toHaveBeenCalledTimes(3);
  });

  it("does not replace the submitted incident status with a different tracked incident", async () => {
    submitIncident.mockResolvedValue({ id: "INC-808", message: "Report received", status: "pending", trackingToken: "private-token" });
    trackIncident.mockResolvedValue({ incident_reference: "INC-OTHER", emergency_type: "Fire", status: "resolved", last_updated_at: "2026-10-24T10:20:00Z", progress_messages: ["The response was verified as completed."] });

    render(<App />);
    fireEvent.change(screen.getByLabelText(/What kind of emergency/), { target: { value: "Flood" } });
    fireEvent.change(screen.getByLabelText(/Emergency details/), { target: { value: "River water has reached nearby homes." } });
    fireEvent.change(screen.getByLabelText(/Manual location/), { target: { value: "River Road" } });
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));
    await userEvent.click(await screen.findByRole("button", { name: "Open secure tracking" }));
    await userEvent.click(screen.getByRole("button", { name: /check incident status/i }));

    expect(await screen.findByText("resolved", { selector: "h3" })).toBeInTheDocument();
    expect(screen.getByText("pending", { selector: "h2" })).toBeInTheDocument();
  });
});
