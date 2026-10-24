import { afterEach, describe, expect, it, vi } from "vitest";
import { submitIncident } from "./incidents.js";

const payload = {
  emergency_type: "Flood",
  description: "Water is entering a residential building.",
  latitude: null,
  longitude: null,
  location_text: "Oak Street",
};
const idempotencyKey = "30000000-0000-4000-8000-000000000001";

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
          analysis_status: "pending",
          notice: "Stored immediately",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(submitIncident(payload, idempotencyKey)).resolves.toEqual({
      id: "30000000-0000-4000-8000-000000000001",
      message: "Emergency report received by RescueGrid AI",
      status: "pending",
      analysisStatus: "pending",
      notice: "Stored immediately",
    });
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:4000/api/sos", expect.objectContaining({
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      credentials: "omit",
      signal: expect.anything(),
      body: JSON.stringify(payload),
    }));
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty("Authorization");
  });

  it("keeps the legacy request shape when no idempotency key is supplied", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ success: true, data: { incident_id: idempotencyKey } }),
    }));

    await submitIncident(payload);
    expect(fetch.mock.calls[0][1].body).toBe(JSON.stringify(payload));
    expect(fetch.mock.calls[0][1].headers).not.toHaveProperty("Idempotency-Key");
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

  it("rejects a successful response whose ID differs from the idempotency key", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ success: true, data: { incident_id: "30000000-0000-4000-8000-000000000099" } }),
    }));

    await expect(submitIncident(payload, idempotencyKey)).rejects.toMatchObject({
      name: "IncidentApiError",
      status: 502,
      code: "IDEMPOTENCY_MISMATCH",
    });
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
