import assert from "node:assert/strict";
import test from "node:test";
import { formatProviderMetadata } from "../src/analysisPresentation.js";

test("formats Gemini primary metadata without credentials", () => {
  assert.deepEqual(formatProviderMetadata({ provider: "gemini", model: "gemini-2.5-flash", fallback_used: false }), {
    label: "Gemini primary",
    model: "gemini-2.5-flash",
    fallbackUsed: false,
  });
});

test("formats Groq fallback metadata and handles stored analyses without metadata", () => {
  assert.deepEqual(formatProviderMetadata({ provider: "groq", model: "openai/gpt-oss-20b", fallback_used: true }), {
    label: "Groq fallback",
    model: "openai/gpt-oss-20b",
    fallbackUsed: true,
  });
  assert.equal(formatProviderMetadata(undefined), null);
});
