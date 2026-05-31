import assert from "node:assert/strict";
import test from "node:test";

import * as publicApi from "../dist/index.js";

test("public entry exports showcase modules", () => {
  for (const key of [
    "PolicyGate",
    "BashCommandPolicy",
    "SecretRedactor",
    "ReadTool",
    "AgentRuntime",
    "DefaultToolRouter",
    "createFakeProvider",
    "InMemoryEventStore",
    "SessionStore",
    "AuditLogger",
    "PluginLoader"
  ]) {
    assert.equal(key in publicApi, true, `${key} should be exported`);
  }
});
