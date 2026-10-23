import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "./App.jsx";
import { submitIncident } from "./services/incidents.js";

vi.mock("./services/incidents.js", () => ({ submitIncident: vi.fn() }));

describe("response status panel", () => {
  it("shows team assignment only when the backend reports an assigned status", async () => {
    submitIncident.mockResolvedValue({
      id: 808,
      message: "Report received",
      status: "assigned",
      reportedAt: "2026-10-23T10:00:00.000Z",
    });
    render(<App />);
    fireEvent.change(screen.getByLabelText(/What kind of emergency/), { target: { value: "Flood" } });
    fireEvent.change(screen.getByLabelText(/Reporting as/), { target: { value: "Victim" } });
    fireEvent.change(screen.getByLabelText(/Manual location/), { target: { value: "River Road" } });
    fireEvent.change(screen.getByLabelText(/Victim's mobile/), { target: { value: "+91 98765 43210" } });

    expect(screen.getByText("Ready when you are")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Rescue response progress" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));

    expect(await screen.findByText("Incident status")).toBeInTheDocument();
    expect(screen.getByText("Rescue team assigned", { selector: "h2" })).toBeInTheDocument();
    expect(screen.getAllByText("Rescue team assigned")).toHaveLength(2);
    const progress = screen.getByRole("list", { name: "Rescue response progress" });
    expect(progress).toHaveTextContent("Report submitted");
    expect(progress).toHaveTextContent("Rescue team assigned");
    expect(progress).toHaveTextContent("Rescue team on the way");
    expect(screen.getAllByText("808")).toHaveLength(2);
  });
});
