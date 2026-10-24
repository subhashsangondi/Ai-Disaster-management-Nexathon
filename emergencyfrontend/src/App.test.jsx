import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "./App.jsx";
import { submitIncident } from "./services/incidents.js";

vi.mock("./services/incidents.js", () => ({ submitIncident: vi.fn() }));
vi.mock("./components/EmergencyLocationMap.jsx", () => ({
  default: () => <div data-testid="emergency-location-map" />,
}));

describe("public incident confirmation", () => {
  it("routes the centered SOS link to the dedicated page and back", async () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText(/What kind of emergency/), { target: { value: "Flood" } });

    const sosLink = screen.getByRole("link", { name: "Open dedicated SOS page" });
    expect(sosLink).toHaveAttribute("href", "/sos");
    expect(sosLink.closest("form")).toBeNull();
    expect(sosLink.compareDocumentPosition(screen.getByRole("heading", { name: "Quick emergency report" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await userEvent.click(sosLink);
    expect(await screen.findByRole("heading", { name: "Send an SOS" })).toBeInTheDocument();
    expect(screen.getByText("Voice Note (Optional)")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: "Back to emergency report" }));
    expect(await screen.findByRole("heading", { name: "Quick emergency report" })).toBeInTheDocument();
    expect(screen.getByLabelText(/What kind of emergency/)).toHaveValue("Flood");
  });

  it("shows receipt status without inventing public tracking", async () => {
    submitIncident.mockResolvedValue({
      id: "INC-808",
      message: "Report received",
      status: "pending",
      reportedAt: "2026-10-24T00:30:00.000Z",
    });
    render(<App />);
    fireEvent.change(screen.getByLabelText(/What kind of emergency/), { target: { value: "Flood" } });
    fireEvent.change(screen.getByLabelText(/I am reporting as/), { target: { value: "victim" } });
    fireEvent.change(screen.getByLabelText(/Victim's phone number/), { target: { value: "9876543210" } });
    fireEvent.change(screen.getByLabelText(/Emergency details/), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(/Manual location/), { target: { value: "River Road" } });

    expect(screen.getByText("Ready when you are")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));

    expect(await screen.findByText("Incident status")).toBeInTheDocument();
    expect(screen.getByText("Report submitted", { selector: "h2" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Emergency response progress" })).toBeInTheDocument();
    expect(screen.getAllByText("Reported at")).toHaveLength(2);
    expect(screen.getAllByText("INC-808")).toHaveLength(2);
    expect(screen.getByText("Rescue team assigned")).toBeInTheDocument();
  });
});
