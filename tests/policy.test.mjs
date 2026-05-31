import assert from "node:assert/strict";
import test from "node:test";

import { BashCommandPolicy, PolicyGate } from "../dist/index.js";

const request = {
  toolName: "read",
  capability: "filesystem:read",
  target: "src/index.ts"
};

test("PolicyGate falls back to ask when no rule matches", () => {
  const gate = new PolicyGate();
  const evaluation = gate.evaluate(request);

  assert.equal(evaluation.decision.state, "ask");
  assert.equal(evaluation.decision.source, "fallback");
});

test("PolicyGate gives deny priority over matching allow", () => {
  const gate = new PolicyGate({
    rules: [
      {
        id: "allow-src",
        decision: "allow",
        source: "global",
        scope: "target",
        reason: "Allow source reads.",
        target: { kind: "glob", value: "src/**" }
      },
      {
        id: "deny-index",
        decision: "deny",
        source: "global",
        scope: "target",
        reason: "Deny this file.",
        target: { kind: "exact", value: "src/index.ts" }
      }
    ]
  });

  const evaluation = gate.evaluate(request);

  assert.equal(evaluation.decision.state, "deny");
  assert.equal(evaluation.decision.matchedRuleId, "deny-index");
});

test("PolicyGate uses source priority after deny priority", () => {
  const gate = new PolicyGate({
    rules: [
      {
        id: "global-ask",
        decision: "ask",
        source: "global",
        scope: "target",
        reason: "Global confirmation required.",
        target: { kind: "glob", value: "src/**" }
      },
      {
        id: "session-allow",
        decision: "allow",
        source: "session",
        scope: "target",
        reason: "Session allowed.",
        target: { kind: "glob", value: "src/**" }
      }
    ]
  });

  const evaluation = gate.evaluate(request);

  assert.equal(evaluation.decision.state, "allow");
  assert.equal(evaluation.decision.matchedRuleId, "session-allow");
});

test("BashCommandPolicy normalizes commands before matching", () => {
  const policy = new BashCommandPolicy({
    rules: [
      {
        id: "allow-status",
        decision: "allow",
        source: "global",
        reason: "Read-only git status is safe.",
        command: { kind: "exact", value: "git status --short" }
      }
    ]
  });

  const evaluation = policy.evaluate({ rawCommand: " git   status   --short " });

  assert.equal(evaluation.bash.normalizedCommand, "git status --short");
  assert.equal(evaluation.decision.state, "allow");
});

test("BashCommandPolicy blocks compound commands unless explicitly allowed", () => {
  const genericAllow = new BashCommandPolicy({
    rules: [
      {
        id: "allow-npm",
        decision: "allow",
        source: "global",
        reason: "Allow npm commands.",
        command: { kind: "glob", value: "npm *" }
      }
    ]
  });

  const denied = genericAllow.evaluate({ rawCommand: "npm test && git push" });

  assert.equal(denied.decision.state, "deny");
  assert.equal(denied.decision.matchedRuleId, "bash.compound-command");

  const explicitAllow = new BashCommandPolicy({
    rules: [
      {
        id: "allow-exact-compound",
        decision: "allow",
        source: "explicit",
        reason: "Explicitly allowed demo command.",
        command: { kind: "exact", value: "npm test && npm run typecheck" },
        allowCompound: true
      }
    ]
  });

  const allowed = explicitAllow.evaluate({ rawCommand: "npm test && npm run typecheck" });

  assert.equal(allowed.decision.state, "allow");
  assert.equal(allowed.decision.matchedRuleId, "allow-exact-compound");
});

test("BashCommandPolicy treats substitutions in double quotes as compound operators", () => {
  const policy = new BashCommandPolicy({
    rules: [
      {
        id: "allow-echo",
        decision: "allow",
        source: "global",
        reason: "Allow simple echo.",
        command: { kind: "glob", value: "echo *" }
      }
    ]
  });

  const evaluation = policy.evaluate({ rawCommand: "echo \"$(cat .env)\"" });

  assert.equal(evaluation.decision.state, "deny");
  assert.deepEqual(evaluation.bash.compoundOperators, ["$()"]);
});
