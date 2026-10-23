import { afterEach, describe, expect, it, vi } from "vitest";
import { submitIncident } from "./incidents.js";

const payload = {
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
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("submitIncident", () => {
  it("posts the exact public SOS payload and parses the response envelope", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        success: true,
        message: "Emergency report received by RescueGrid AI",
        data: {
          incident_id: "30000000-0000-4000-8000-000000000001",
          status: "pending",
          created_at: "2026-10-24T00:30:00.000Z",
          analysis_status: "pending",
          notice: "Stored immediately",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitIncident(payload)).resolves.toEqual({
      id: "30000000-0000-4000-8000-000000000001",
      message: "Emergency report received by RescueGrid AI",
      status: "pending",
      reportedAt: "2026-10-24T00:30:00.000Z",
      analysisStatus: "pending",
      notice: "Stored immediately",
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:4000/api/sos", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "omit",
      signal: expect.anything(),
      body: JSON.stringify(payload),
    }));
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
  });

  it("reports network, malformed-response, and backend validation failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(submitIncident(payload)).rejects.toThrow(/Could not reach the reporting server/);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => { throw new SyntaxError(); } }));
    await expect(submitIncident(payload)).rejects.toThrow(/unreadable response/);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ success: false, message: "Validation failed", errors: [{ field: "description", message: "Too short" }] }),
    }));
    await expect(submitIncident(payload)).rejects.toThrow("description: Too short");
  });

  it("rejects a successful response without an incident ID", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ success: true, message: "Received", data: { status: "pending" } }),
    }));
    await expect(submitIncident(payload)).rejects.toThrow(/valid incident ID/);
  });

  it("aborts a request that exceeds the configured timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    })));

    const expectation = expect(submitIncident(payload)).rejects.toThrow(/took too long/);
    await vi.advanceTimersByTimeAsync(10000);
    await expectation;
  });
});
