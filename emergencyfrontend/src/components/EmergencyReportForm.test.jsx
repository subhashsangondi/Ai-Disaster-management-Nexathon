import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import EmergencyReportForm from "./EmergencyReportForm.jsx";
import { submitIncident } from "../services/incidents.js";

vi.mock("../services/incidents.js", () => ({ submitIncident: vi.fn() }));

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(/What kind of emergency/), { target: { value: "Flood" } });
  fireEvent.change(screen.getByLabelText(/Extra details/), { target: { value: "Water is entering a residential building." } });
  fireEvent.change(screen.getByLabelText(/Reporting as/), { target: { value: "Witness" } });
  fireEvent.change(screen.getByLabelText(/Manual location/), { target: { value: "Oak Street" } });
  fireEvent.change(screen.getByLabelText(/Volunteer \/ reporter's mobile/), { target: { value: "+91 98765 43210" } });
}

describe("EmergencyReportForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows field validation and does not send an incomplete report", async () => {
    render(<EmergencyReportForm />);
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));
    expect(await screen.findByText("Choose an emergency category.")).toBeInTheDocument();
    expect(submitIncident).not.toHaveBeenCalled();
  });

  it("posts a quick report with optional description and displays server status and ID", async () => {
    submitIncident.mockResolvedValue({ id: 456, message: "Incident report received", status: "under_review", reportedAt: "2026-10-23T10:00:00.000Z" });
    render(<EmergencyReportForm />);
    fireEvent.change(screen.getByLabelText(/What kind of emergency/), { target: { value: "Flood" } });
    fireEvent.change(screen.getByLabelText(/Reporting as/), { target: { value: "Witness" } });
    fireEvent.change(screen.getByLabelText(/Manual location/), { target: { value: "Oak Street" } });
    fireEvent.change(screen.getByLabelText("People affected"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("People injured"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/Victim's mobile/), { target: { value: "+91 98765 43210" } });
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));

    expect(await screen.findByText("456")).toBeInTheDocument();
    expect(screen.getByText("Incident report received")).toBeInTheDocument();
    expect(screen.getAllByText("under review")).toHaveLength(2);
    expect(screen.getByRole("link", { name: /Check typed location on Google Maps/ })).toHaveAttribute("href", expect.stringContaining("Oak%20Street"));
    expect(submitIncident).toHaveBeenCalledWith({
      category: "Flood",
      description: "",
      reporter_type: "Witness",
      people_affected: 3,
      people_injured: 1,
      victim_phone: "+91 98765 43210",
      volunteer_phone: "",
      photos: [],
      latitude: null,
      longitude: null,
      location_text: "Oak Street",
    });
  });

  it("retains the entered data and allows retry after request failure", async () => {
    submitIncident.mockRejectedValueOnce(new Error("Could not reach the reporting server.")).mockResolvedValueOnce({ id: "INC-9", message: "Received" });
    render(<EmergencyReportForm />);
    fillRequiredFields();
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the reporting server.");
    expect(screen.getByLabelText(/Extra details/)).toHaveValue("Water is entering a residential building.");
    const errorPosition = screen.getByRole("alert").compareDocumentPosition(
      screen.getByRole("button", { name: "Send Emergency Report" }),
    );
    expect(errorPosition & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));
    expect(await screen.findByText("INC-9")).toBeInTheDocument();
  });

  it("handles geolocation denial while preserving manual location reporting", async () => {
    const getCurrentPosition = vi.fn((_success, failure) => failure({ code: 1 }));
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition } });
    render(<EmergencyReportForm />);
    await userEvent.click(screen.getByRole("button", { name: "Use My Current Location" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Location permission was denied");
    fillRequiredFields();
    submitIncident.mockResolvedValue({ id: 12, message: "Received" });
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));
    expect(await screen.findByText("12")).toBeInTheDocument();
  });

  it("uses only coordinates returned by the browser", async () => {
    const getCurrentPosition = vi.fn((success) => success({ coords: { latitude: 1.25, longitude: -2.75 } }));
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition } });
    submitIncident.mockResolvedValue({ id: 31, message: "Received" });
    render(<EmergencyReportForm />);
    await userEvent.click(screen.getByRole("button", { name: "Use My Current Location" }));
    expect(await screen.findByText(/Latitude: 1.25, Longitude: -2.75/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Check GPS coordinates on Google Maps/ })).toHaveAttribute("href", expect.stringContaining("1.25%2C-2.75"));
    fillRequiredFields();
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));
    expect(await screen.findByText("31")).toBeInTheDocument();
    expect(submitIncident).toHaveBeenCalledWith(expect.objectContaining({ latitude: 1.25, longitude: -2.75 }));
  });

  it.each([
    [2, "position is unavailable"],
    [3, "took too long"],
  ])("explains GPS error code %i and keeps manual reporting available", async (code, message) => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: (_success, failure) => failure({ code }) },
    });
    render(<EmergencyReportForm />);
    await userEvent.click(screen.getByRole("button", { name: "Use My Current Location" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText(/Manual location/)).toBeEnabled();
  });

  it("explains when the browser does not support geolocation", async () => {
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: undefined });
    render(<EmergencyReportForm />);
    await userEvent.click(screen.getByRole("button", { name: "Use My Current Location" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("does not support location access");
  });

  it("disables submission while the backend request is pending", async () => {
    let resolveSubmission;
    submitIncident.mockReturnValue(new Promise((resolve) => { resolveSubmission = resolve; }));
    render(<EmergencyReportForm />);
    fillRequiredFields();
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));
    expect(screen.getByRole("button", { name: "Sending report..." })).toBeDisabled();
    resolveSubmission({ id: 23, message: "Received" });
    await waitFor(() => expect(screen.getByText("23")).toBeInTheDocument());
    expect(submitIncident).toHaveBeenCalledTimes(1);
  });

  it("accepts either victim or volunteer as the required contact", async () => {
    submitIncident.mockResolvedValue({ id: 32, message: "Received", status: "assigned" });
    render(<EmergencyReportForm />);
    fillRequiredFields();
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));
    expect(await screen.findByText("32")).toBeInTheDocument();
    expect(submitIncident).toHaveBeenCalledWith(expect.objectContaining({
      victim_phone: "",
      volunteer_phone: "+91 98765 43210",
    }));
  });

  it("keeps the mobile icon visible and clear of the number while typing", () => {
    render(<EmergencyReportForm />);
    const victimPhone = screen.getByLabelText(/Victim's mobile/);
    expect(screen.getByTestId("victim_phone-icon")).toBeInTheDocument();
    expect(victimPhone).toHaveClass("form-control--with-icon");

    fireEvent.change(victimPhone, { target: { value: "9876543210" } });
    expect(screen.getByTestId("victim_phone-icon")).toBeInTheDocument();
    expect(victimPhone).toHaveValue("9876543210");
  });

  it("requires one contact and validates a supplied phone number", async () => {
    render(<EmergencyReportForm />);
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText(/Victim's mobile/), { target: { value: "abc" } });
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));
    expect(await screen.findByText("Enter a valid phone number with 7–15 digits.")).toBeInTheDocument();
    expect(submitIncident).not.toHaveBeenCalled();
  });

  it("does not submit without either a victim or volunteer contact number", async () => {
    render(<EmergencyReportForm />);
    fillRequiredFields();
    fireEvent.change(screen.getByLabelText(/Volunteer \/ reporter's mobile/), { target: { value: "" } });
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));
    expect(await screen.findByText("Enter either the victim's or the volunteer's mobile number.")).toBeInTheDocument();
    expect(submitIncident).not.toHaveBeenCalled();
  });

  it("attaches selected photos to the report payload", async () => {
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:photo-preview"), revokeObjectURL: vi.fn() });
    submitIncident.mockResolvedValue({ id: 33, message: "Received" });
    render(<EmergencyReportForm />);
    fillRequiredFields();
    const photo = new File(["photo-bytes"], "flood.jpg", { type: "image/jpeg" });
    await userEvent.upload(screen.getByLabelText("Choose photos"), photo);
    await userEvent.click(screen.getByRole("button", { name: "Send Emergency Report" }));
    expect(await screen.findByText("33")).toBeInTheDocument();
    const request = submitIncident.mock.calls[0][0];
    expect(request.photos).toHaveLength(1);
    expect(request.photos[0]).toMatchObject({ filename: "flood.jpg", content_type: "image/jpeg" });
    expect(request.photos[0].data_url).toMatch(/^data:image\/jpeg;base64,/);
  });
});
