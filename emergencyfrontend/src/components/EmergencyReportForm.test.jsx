import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import EmergencyReportForm from "./EmergencyReportForm.jsx";
import { submitIncident } from "../services/incidents.js";

vi.mock("../services/incidents.js", () => ({ submitIncident: vi.fn() }));
vi.mock("./EmergencyLocationMap.jsx", () => ({
  default: () => <div data-testid="emergency-location-map" />,
}));

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(/What kind of emergency/), { target: { value: "Flood" } });
  fireEvent.change(screen.getByLabelText(/I am reporting as/), { target: { value: "witness" } });
  fireEvent.change(screen.getByLabelText(/Volunteer's phone number/), { target: { value: "+91 98765 43210" } });
  fireEvent.change(screen.getByLabelText(/Manual location/), { target: { value: "Oak Street" } });
}

function renderReportForm() {
  return render(
    <MemoryRouter>
      <EmergencyReportForm />
    </MemoryRouter>,
  );
}

describe("EmergencyReportForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("validates required fields before sending", async () => {
    renderReportForm();
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));
    expect(await screen.findByText("Choose an emergency category.")).toBeInTheDocument();
    expect(screen.getByText("Choose who is reporting.")).toBeInTheDocument();
    expect(screen.getByText("Enter either the victim's or volunteer's phone number.")).toBeInTheDocument();
    expect(submitIncident).not.toHaveBeenCalled();
  });

  it("submits the exact backend fields and displays the returned incident ID", async () => {
    submitIncident.mockResolvedValue({
      id: "30000000-0000-4000-8000-000000000001",
      message: "Emergency report received by RescueGrid AI",
      status: "pending",
      reportedAt: "2026-10-24T00:30:00.000Z",
      analysisStatus: "pending",
      notice: "Stored immediately",
    });
    renderReportForm();
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText("People affected"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("People injured"), { target: { value: "1" } });
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));

    expect(await screen.findByText("30000000-0000-4000-8000-000000000001")).toBeInTheDocument();
    expect(screen.getByText("Stored immediately")).toBeInTheDocument();
    expect(submitIncident).toHaveBeenCalledWith({
      emergency_type: "Flood",
      description: null,
      reporter_type: "witness",
      people_affected: 3,
      people_injured: 1,
      victim_phone: null,
      volunteer_phone: "+91 98765 43210",
      latitude: null,
      longitude: null,
      location_text: "Oak Street",
    });
    expect(screen.getByText(/3 affected · 1 injured/)).toBeInTheDocument();
  });

  it("retains form data and allows retry after a network failure", async () => {
    submitIncident.mockRejectedValueOnce(new Error("Could not reach the reporting server.")).mockResolvedValueOnce({ id: "INC-9", message: "Received", status: "pending" });
    renderReportForm();
    fillRequiredFields();
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the reporting server.");
    expect(screen.getByLabelText(/Emergency details/)).toHaveValue("");
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));
    expect(await screen.findByText("INC-9")).toBeInTheDocument();
  });

  it("handles denied geolocation and still allows a manual location", async () => {
    const getCurrentPosition = vi.fn((_success, failure) => failure({ code: 1 }));
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition } });
    renderReportForm();
    await userEvent.click(screen.getByRole("button", { name: "Use My Current Location" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Location permission was denied");
    expect(screen.getByLabelText(/Manual location/)).toBeEnabled();
  });

  it("submits browser-provided coordinates", async () => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: (success) => success({ coords: { latitude: 1.25, longitude: -2.75 } }) },
    });
    submitIncident.mockResolvedValue({ id: "INC-31", message: "Received", status: "pending" });
    renderReportForm();
    await userEvent.click(screen.getByRole("button", { name: "Use My Current Location" }));
    fireEvent.change(screen.getByLabelText(/What kind of emergency/), { target: { value: "Flood" } });
    fireEvent.change(screen.getByLabelText(/I am reporting as/), { target: { value: "victim" } });
    fireEvent.change(screen.getByLabelText(/Victim's phone number/), { target: { value: "9876543210" } });
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));

    expect(await screen.findByText("INC-31")).toBeInTheDocument();
    expect(submitIncident).toHaveBeenCalledWith(expect.objectContaining({ latitude: 1.25, longitude: -2.75, location_text: null }));
  });

  it("allows an empty description but checks an optional description when supplied", async () => {
    submitIncident.mockResolvedValue({ id: "INC-OPT", message: "Received", status: "pending" });
    renderReportForm();
    fillRequiredFields();
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));
    expect(await screen.findByText("INC-OPT")).toBeInTheDocument();
    expect(submitIncident).toHaveBeenCalledWith(expect.objectContaining({ description: null }));
  });

  it("shows field-level validation for a short optional description and keeps counts consistent", async () => {
    renderReportForm();
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText(/Emergency details/), { target: { value: "Too short" } });
    fireEvent.change(screen.getByLabelText("People injured"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("People affected"), { target: { value: "2" } });
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));
    expect(await screen.findByText("Describe the emergency in at least 10 characters.")).toBeInTheDocument();
    expect(screen.getByLabelText("People injured")).toHaveValue("2");
    expect(submitIncident).not.toHaveBeenCalled();
  });

  it("locks immediately against repeated submit events", async () => {
    let resolveSubmission;
    submitIncident.mockReturnValue(new Promise((resolve) => { resolveSubmission = resolve; }));
    renderReportForm();
    fillRequiredFields();
    const form = screen.getByRole("button", { name: "Send Emergency Report" }).closest("form");
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(submitIncident).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Sending report..." })).toBeDisabled();
    resolveSubmission({ id: "INC-23", message: "Received", status: "pending" });
    await waitFor(() => expect(screen.getByText("INC-23")).toBeInTheDocument());
  });
});
