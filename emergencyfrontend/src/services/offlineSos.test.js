import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IncidentApiError } from "./incidents.js";
import {
  createPendingSOS,
  deliverPendingSOS,
  listPendingSOS,
  retryPendingSOS,
  savePendingSOS,
  SOSDeviceOfflineError,
} from "./offlineSos.js";
import { submitIncident } from "./incidents.js";

vi.mock("./incidents.js", () => ({
  IncidentApiError: class IncidentApiError extends Error {
    constructor(message, status = 0) {
      super(message);
      this.status = status;
    }
  },
  submitIncident: vi.fn(),
}));

const clientId = "30000000-0000-4000-8000-000000000001";
const payload = {
  emergency_type: "Flood",
  description: "Water is entering a residential building.",
  latitude: 1.25,
  longitude: -2.75,
  location_text: null,
};

function makeIndexedDb() {
  const records = new Map();
  let hasStore = false;
  const database = {
    objectStoreNames: { contains: () => hasStore },
    createObjectStore: () => { hasStore = true; },
    close: vi.fn(),
    transaction() {
      const transaction = { pending: 0, completed: false };
      const finishIfIdle = () => {
        if (transaction.pending !== 0 || transaction.completed) return;
        setTimeout(() => {
          if (transaction.pending !== 0 || transaction.completed) return;
          transaction.completed = true;
          transaction.oncomplete?.();
        }, 0);
      };
      const request = (operation) => {
        const result = {};
        transaction.pending += 1;
        setTimeout(() => {
          operation(result);
          result.onsuccess?.();
          transaction.pending -= 1;
          finishIfIdle();
        }, 0);
        return result;
      };
      transaction.objectStore = () => ({
        put: (value) => request((result) => {
          records.set(value.id, structuredClone(value));
          result.result = value;
        }),
        get: (id) => request((result) => { result.result = records.get(id); }),
        getAll: () => request((result) => { result.result = [...records.values()].map((value) => structuredClone(value)); }),
        delete: (id) => request(() => { records.delete(id); }),
      });
      transaction.abort = () => {
        transaction.onabort?.();
      };
      return transaction;
    },
  };

  return {
    open: () => {
      const openRequest = { result: database };
      setTimeout(() => {
        if (!hasStore) openRequest.onupgradeneeded?.();
        openRequest.onsuccess?.();
      }, 0);
      return openRequest;
    },
  };
}

describe("offline SOS queue", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", makeIndexedDb());
    vi.stubGlobal("crypto", { randomUUID: () => clientId });
    vi.stubGlobal("navigator", { onLine: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("persists a UUID and its original payload in IndexedDB", async () => {
    const saved = await createPendingSOS(payload);

    expect(saved).toMatchObject({ id: clientId, payload, status: "pending" });
    expect(await listPendingSOS()).toEqual([saved]);
  });

  it("retains failed submissions and removes them only after confirmed receipt", async () => {
    const report = await createPendingSOS(payload);
    submitIncident.mockRejectedValueOnce(new TypeError("offline"));
    await expect(deliverPendingSOS(report)).rejects.toThrow("offline");
    expect(await listPendingSOS()).toHaveLength(1);

    submitIncident.mockResolvedValueOnce({ id: clientId, status: "pending" });
    await deliverPendingSOS(report);
    expect(submitIncident).toHaveBeenLastCalledWith(payload, clientId);
    expect(await listPendingSOS()).toEqual([]);
  });

  it("distinguishes offline-before-send from an attempted request with unknown receipt", async () => {
    const report = await createPendingSOS(payload);
    vi.stubGlobal("navigator", { onLine: false });
    await expect(deliverPendingSOS(report)).rejects.toBeInstanceOf(SOSDeviceOfflineError);
    expect(await listPendingSOS()).toMatchObject([{ id: clientId, deliveryUnknown: false }]);

    vi.stubGlobal("navigator", { onLine: true });
    submitIncident.mockRejectedValueOnce(new TypeError("connection lost after request"));
    await expect(deliverPendingSOS(report)).rejects.toThrow("connection lost after request");
    expect(await listPendingSOS()).toMatchObject([{ id: clientId, deliveryUnknown: true }]);
  });

  it("marks rejected reports for attention instead of retrying them automatically", async () => {
    const report = await createPendingSOS(payload);
    submitIncident.mockRejectedValueOnce(new IncidentApiError("Validation failed", 400));

    await expect(deliverPendingSOS(report)).rejects.toThrow("Validation failed");
    expect(await listPendingSOS()).toMatchObject([{ id: clientId, status: "needs-attention" }]);
  });

  it("retains mismatched success receipts for attention without deleting the SOS", async () => {
    const report = await createPendingSOS(payload);
    submitIncident.mockRejectedValueOnce(Object.assign(
      new IncidentApiError("Mismatched incident ID", 502),
      { code: "IDEMPOTENCY_MISMATCH" },
    ));

    await expect(deliverPendingSOS(report)).rejects.toMatchObject({ code: "IDEMPOTENCY_MISMATCH" });
    expect(await listPendingSOS()).toMatchObject([{
      id: clientId,
      status: "needs-attention",
      deliveryUnknown: true,
    }]);
  });

  it.each([
    [429, false],
    [500, true],
    [503, true],
  ])("keeps HTTP %i reports queued with a bounded retry time", async (status, deliveryUnknown) => {
    const report = await createPendingSOS(payload);
    const startedAt = Date.now();
    submitIncident.mockRejectedValueOnce(new IncidentApiError(`HTTP ${status}`, status));

    await expect(deliverPendingSOS(report)).rejects.toThrow(`HTTP ${status}`);
    const [queued] = await listPendingSOS();
    const retryAt = Date.parse(queued.nextAttemptAt);
    expect(queued).toMatchObject({ status: "pending", attempts: 1, deliveryUnknown });
    expect(retryAt).toBeGreaterThanOrEqual(startedAt + 5000);
    expect(retryAt).toBeLessThanOrEqual(Date.now() + 5000);
  });

  it("does not automatically retry an SOS before its persisted retry time", async () => {
    const report = await createPendingSOS(payload);
    await savePendingSOS({ ...report, nextAttemptAt: new Date(Date.now() + 60_000).toISOString() });

    await expect(retryPendingSOS()).resolves.toMatchObject([{ id: clientId }]);
    expect(submitIncident).not.toHaveBeenCalled();
  });

  it("retries an SOS after its persisted retry time has elapsed", async () => {
    const report = await createPendingSOS(payload);
    await savePendingSOS({ ...report, nextAttemptAt: new Date(Date.now() - 1).toISOString() });
    submitIncident.mockResolvedValueOnce({ id: clientId, status: "pending" });

    await expect(retryPendingSOS()).resolves.toEqual([]);
    expect(submitIncident).toHaveBeenCalledWith(payload, clientId);
  });

  it("shares one in-flight request for duplicate deliveries in this app runtime", async () => {
    const report = await createPendingSOS(payload);
    let resolveSubmission;
    submitIncident.mockReturnValue(new Promise((resolve) => { resolveSubmission = resolve; }));

    const firstDelivery = deliverPendingSOS(report);
    const duplicateDelivery = deliverPendingSOS(report);
    expect(submitIncident).toHaveBeenCalledOnce();

    resolveSubmission({ id: clientId, status: "pending" });
    await expect(Promise.all([firstDelivery, duplicateDelivery])).resolves.toEqual([
      { id: clientId, status: "pending" },
      { id: clientId, status: "pending" },
    ]);
    expect(await listPendingSOS()).toEqual([]);
  });

  it("retains a report across a simulated reload and retries it when connectivity returns", async () => {
    const report = await createPendingSOS(payload);
    vi.stubGlobal("navigator", { onLine: false });
    expect(await retryPendingSOS()).toEqual([report]);
    expect(submitIncident).not.toHaveBeenCalled();

    vi.resetModules();
    const submitAfterReload = vi.fn().mockResolvedValue({ id: clientId, status: "pending" });
    vi.doMock("./incidents.js", () => ({
      IncidentApiError: class IncidentApiError extends Error {},
      submitIncident: submitAfterReload,
    }));
    const { retryPendingSOS: retryReloadedQueue } = await import("./offlineSos.js");
    vi.stubGlobal("navigator", { onLine: true });
    expect(await retryReloadedQueue()).toEqual([]);
    expect(submitAfterReload).toHaveBeenCalledWith(payload, clientId);
  });
});