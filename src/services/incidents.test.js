import { afterEach, describe, expect, it, vi } from "vitest";
import { submitIncident } from "./incidents.js";

const payload = {
  category: "Flood",
  description: "Water entering a residential building",
  reporter_type: "Witness",
  people_affected: null,
  people_injured: null,
  victim_phone: "",
  volunteer_phone: "+91 98765 43210",
  photos: [],
  latitude: null,
  longitude: null,
  location_text: "Oak Street",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("submitIncident", () => {
  it("posts the exact JSON payload and returns the server incident ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 123,
        message: "Incident report received",
        status: "assigned",
        reported_at: "2026-10-23T10:00:00.000Z",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitIncident(payload)).resolves.toEqual({
      id: 123,
      message: "Incident report received",
      status: "assigned",
      reportedAt: "2026-10-23T10:00:00.000Z",
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:5000/api/incidents", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
  });

  it("rejects network failures and successful responses without a valid ID", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(submitIncident(payload)).rejects.toThrow(/Could not reach the reporting server/);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: "Received" }) }));
    await expect(submitIncident(payload)).rejects.toThrow(/valid incident ID/);
  });

  it("rejects malformed JSON and unsuccessful HTTP responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError(); } }));
    await expect(submitIncident(payload)).rejects.toThrow(/unreadable response/);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({ message: "Service unavailable" }) }));
    await expect(submitIncident(payload)).rejects.toThrow("Service unavailable");
  });
});
