import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "./App.jsx";
import { submitIncident } from "./services/incidents.js";

vi.mock("./services/incidents.js", () => ({ submitIncident: vi.fn() }));

describe("public incident confirmation", () => {
  it("shows receipt status without inventing public tracking", async () => {
    submitIncident.mockResolvedValue({ id: "INC-808", message: "Report received", status: "pending" });
    render(<App />);
    fireEvent.change(screen.getByLabelText(/What kind of emergency/), { target: { value: "Flood" } });
    fireEvent.change(screen.getByLabelText(/Emergency details/), { target: { value: "River water has reached nearby homes." } });
    fireEvent.change(screen.getByLabelText(/Manual location/), { target: { value: "River Road" } });

    expect(screen.getByText("Ready when you are")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));

    expect(await screen.findByText("Incident status")).toBeInTheDocument();
    expect(screen.getByText("pending", { selector: "h2" })).toBeInTheDocument();
    expect(screen.getByText(/Live status tracking is not available/)).toBeInTheDocument();
    expect(screen.getAllByText("INC-808")).toHaveLength(2);
    expect(screen.queryByText("Rescue team assigned")).not.toBeInTheDocument();
  });
});
