import { IncidentApiError, submitIncident } from "./incidents.js";

const DATABASE_NAME = "rescuegrid-public-sos";
const DATABASE_VERSION = 1;
const STORE_NAME = "pending-reports";
const QUEUE_CHANGED_EVENT = "rescuegrid:sos-queue-changed";
const SOS_RECEIVED_EVENT = "rescuegrid:sos-received";
const RETRY_BASE_DELAY_MS = 5000;
const RETRY_MAX_DELAY_MS = 300000;
const deliveryPromises = new Map();
let retryPassPromise = null;

export class SOSDeviceOfflineError extends Error {
  constructor() {
    super("This device is offline.");
    this.name = "SOSDeviceOfflineError";
  }
}

function notify(eventName, detail) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
  }
}

function openDatabase() {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error("This browser cannot save SOS reports for offline delivery."));
  }

  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open offline SOS storage."));
    request.onblocked = () => reject(new Error("Offline SOS storage is busy in another tab."));
  });
}

async function runTransaction(mode, action) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    let result;
    transaction.oncomplete = () => {
      database.close();
      resolve(result);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error("Offline SOS storage failed."));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error || new Error("Offline SOS storage was interrupted."));
    };

    try {
      action(transaction.objectStore(STORE_NAME), (value) => { result = value; });
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  });
}

export function createSOSId() {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  if (!cryptoApi?.getRandomValues) throw new Error("A secure UUID generator is unavailable in this browser.");

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function listPendingSOS() {
  return runTransaction("readonly", (store, setResult) => {
    const request = store.getAll();
    request.onsuccess = () => setResult(request.result);
  });
}

export async function savePendingSOS(report) {
  await runTransaction("readwrite", (store, setResult) => {
    const request = store.put(report);
    request.onsuccess = () => setResult(report);
  });
  notify(QUEUE_CHANGED_EVENT);
  return report;
}

async function updatePendingSOS(id, updates) {
  await runTransaction("readwrite", (store, setResult) => {
    const request = store.get(id);
    request.onsuccess = () => {
      if (!request.result) return setResult(null);
      const updated = { ...request.result, ...updates };
      store.put(updated);
      setResult(updated);
    };
  });
  notify(QUEUE_CHANGED_EVENT);
}

export async function removePendingSOS(id) {
  await runTransaction("readwrite", (store, setResult) => {
    const request = store.delete(id);
    request.onsuccess = () => setResult(true);
  });
  notify(QUEUE_CHANGED_EVENT);
}

export async function createPendingSOS(payload) {
  const report = {
    id: createSOSId(),
    payload,
    createdAt: new Date().toISOString(),
    status: "pending",
    deliveryUnknown: false,
    attempts: 0,
    nextAttemptAt: null,
  };
  return savePendingSOS(report);
}

function isOnline() {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

function isPermanentClientError(error) {
  if (error?.code === "IDEMPOTENCY_MISMATCH") return true;
  return error instanceof IncidentApiError
    && error.status >= 400
    && error.status < 500
    && error.status !== 429;
}

function retryDelay(attempt) {
  return Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * (2 ** Math.min(Math.max(attempt - 1, 0), 16)));
}

function deliveryIsUnknown(error) {
  if (error instanceof SOSDeviceOfflineError) return false;
  if (error instanceof IncidentApiError && error.status >= 400 && error.status < 500) return false;
  return true;
}

async function submitPendingSOS(report) {
  if (!isOnline()) throw new SOSDeviceOfflineError();

  let response;
  try {
    response = await submitIncident(report.payload, report.id);
  } catch (error) {
    const attempts = (report.attempts || 0) + 1;
    const permanent = isPermanentClientError(error);
    if (isPermanentClientError(error)) {
      await updatePendingSOS(report.id, {
        status: "needs-attention",
        deliveryUnknown: deliveryIsUnknown(error),
        attempts,
        nextAttemptAt: null,
        lastAttemptAt: new Date().toISOString(),
        lastHttpStatus: error.status || null,
      });
    } else {
      const delay = retryDelay(attempts);
      await updatePendingSOS(report.id, {
        status: "pending",
        deliveryUnknown: deliveryIsUnknown(error),
        attempts,
        nextAttemptAt: new Date(Date.now() + delay).toISOString(),
        lastAttemptAt: new Date().toISOString(),
        lastHttpStatus: error.status || null,
      });
    }
    throw error;
  }

  try {
    await removePendingSOS(report.id);
  } catch {
    // A later retry uses the same ID and safely retrieves the server's receipt.
  }
  notify(SOS_RECEIVED_EVENT, { id: report.id, response });
  return response;
}

export function deliverPendingSOS(report) {
  const existing = deliveryPromises.get(report.id);
  if (existing) return existing;

  const delivery = submitPendingSOS(report).finally(() => {
    if (deliveryPromises.get(report.id) === delivery) deliveryPromises.delete(report.id);
  });
  deliveryPromises.set(report.id, delivery);
  return delivery;
}

async function runPendingSOSRetry({ force }) {
  if (!isOnline()) return listPendingSOS();
  const reports = await listPendingSOS();
  const now = Date.now();
  for (const report of reports) {
    if (report.status !== "pending") continue;
    const retryAt = report.nextAttemptAt ? Date.parse(report.nextAttemptAt) : 0;
    if (!force && Number.isFinite(retryAt) && retryAt > now) continue;
    try {
      await deliverPendingSOS(report);
    } catch {
      // Failed reports remain queued with their next retry time persisted.
    }
  }
  return listPendingSOS();
}

export function retryPendingSOS({ force = false } = {}) {
  if (retryPassPromise) return retryPassPromise;
  retryPassPromise = runPendingSOSRetry({ force }).finally(() => {
    retryPassPromise = null;
  });
  return retryPassPromise;
}

export const sosQueueChangedEvent = QUEUE_CHANGED_EVENT;
export const sosReceivedEvent = SOS_RECEIVED_EVENT;