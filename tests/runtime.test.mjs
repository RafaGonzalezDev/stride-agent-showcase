import assert from "node:assert/strict";
import test from "node:test";

import { AgentRuntime, DefaultToolRouter, PolicyGate } from "../dist/index.js";

function allowGate() {
  return new PolicyGate({
    rules: [{ id: "allow", decision: "allow", source: "global", scope: "tool", reason: "allow" }]
  });
}

const toolContext = { workspaceRoot: process.cwd(), policyGate: allowGate() };

test("runtime returns provider content without tools", async () => {
  const runtime = new AgentRuntime({
    provider: async () => ({ content: "done" }),
    toolRouter: new DefaultToolRouter({ tools: {}, toolContext })
  });

  const result = await runtime.run({ input: "hello" });

  assert.equal(result.ok, true);
  assert.equal(result.output, "done");
  assert.equal(result.events.some((event) => event.type === "runtime.completed"), true);
});

test("runtime routes tool calls and returns tool result to provider", async () => {
  let calls = 0;
  const provider = async ({ messages }) => {
    calls += 1;
    if (!messages.some((message) => message.role === "tool")) {
      return { content: "", toolCalls: [{ id: "call-1", name: "demo", arguments: { value: 1 } }] };
    }
    return { content: "tool handled" };
  };
  const tool = {
    name: "demo",
    description: "demo",
    capability: "demo:run",
    policyEnforced: true,
    async execute() {
      return { ok: true, output: { ok: true }, audit: { toolName: "demo", capability: "demo:run", sideEffect: false } };
    }
  };
  const runtime = new AgentRuntime({
    provider,
    toolRouter: new DefaultToolRouter({ tools: { demo: tool }, toolContext })
  });

  const result = await runtime.run({ input: "use tool" });

  assert.equal(result.ok, true);
  assert.equal(result.output, "tool handled");
  assert.equal(calls, 2);
});

test("runtime stops on policy-required tool failures", async () => {
  const tool = {
    name: "demo",
    description: "demo",
    capability: "demo:run",
    policyEnforced: true,
    async execute() {
      return { ok: false, code: "policy-required", error: "approval needed", audit: { toolName: "demo", capability: "demo:run", sideEffect: false } };
    }
  };
  const runtime = new AgentRuntime({
    provider: async () => ({ content: "", toolCalls: [{ id: "call-1", name: "demo", arguments: {} }] }),
    toolRouter: new DefaultToolRouter({ tools: { demo: tool }, toolContext })
  });

  const result = await runtime.run({ input: "use tool" });

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "needs-approval");
});

test("tool router rejects tools without policy metadata", async () => {
  const unsafeTool = {
    name: "unsafe",
    description: "unsafe",
    capability: "demo:run",
    async execute() {
      throw new Error("should not run");
    }
  };
  const router = new DefaultToolRouter({ tools: { unsafe: unsafeTool }, toolContext });

  const result = await router.run({ id: "call-1", name: "unsafe", arguments: {} });

  assert.equal(result.status, "error");
  assert.match(result.error, /policy enforcement/);
});
