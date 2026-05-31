import assert from "node:assert/strict";
import test from "node:test";

import { SecretRedactor, redactSecrets } from "../dist/index.js";

test("redactSecrets redacts common API keys and bearer tokens", () => {
  const result = redactSecrets("Authorization: Bearer sk-fake-secret-token and key sk-another-secret");

  assert.equal(result.redactionApplied, true);
  assert.doesNotMatch(result.value, /sk-fake-secret-token|sk-another-secret/);
  assert.match(result.value, /<redacted>/);
});

test("redactSecrets redacts environment-style secret assignments", () => {
  const result = redactSecrets("API_TOKEN=super-secret-value\nSAFE_VALUE=visible");

  assert.equal(result.redactionApplied, true);
  assert.match(result.value, /API_TOKEN=<redacted>/);
  assert.match(result.value, /SAFE_VALUE=visible/);
});

test("redactSecrets redacts private key blocks", () => {
  const result = redactSecrets("-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----");

  assert.equal(result.value, "<redacted-private-key>");
});

test("SecretRedactor recursively redacts sensitive object keys and string values", () => {
  const redactor = new SecretRedactor();
  const result = redactor.redact({
    message: "failed with Bearer ghp_fakegithubtoken123",
    nested: {
      apiKey: "plain-value-that-should-not-appear"
    },
    safe: "visible"
  });

  assert.equal(result.redactionApplied, true);
  assert.deepEqual(result.value, {
    message: "failed with Bearer <redacted>",
    nested: {
      apiKey: "<redacted>"
    },
    safe: "visible"
  });
});

test("redactSecrets leaves safe text unchanged", () => {
  const result = redactSecrets("No credentials here.");

  assert.equal(result.redactionApplied, false);
  assert.equal(result.value, "No credentials here.");
});
