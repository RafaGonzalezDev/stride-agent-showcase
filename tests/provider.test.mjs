import assert from "node:assert/strict";
import test from "node:test";

import { OpenAICompatibleProviderAdapter, buildOpenAICompatibleRequest, createFakeProvider, parseOpenAICompatibleResponse } from "../dist/index.js";

test("fake provider returns deterministic content", async () => {
  const provider = createFakeProvider({ defaultResponse: "ok" });
  const result = await provider({ turn: 1, messages: [{ role: "user", content: "hello" }] });

  assert.deepEqual(result, { content: "ok" });
});

test("fake provider can request a list tool call", async () => {
  const provider = createFakeProvider();
  const result = await provider({ turn: 1, messages: [{ role: "user", content: "please list files" }] });

  assert.equal(result.toolCalls[0].name, "list");
});

test("builds OpenAI-compatible requests", () => {
  const request = buildOpenAICompatibleRequest({
    baseUrl: "https://api.example.invalid/v1/",
    apiKey: "sk-fake-key",
    model: "fake-model",
    messages: [{ role: "user", content: "hello" }]
  });

  assert.equal(request.url, "https://api.example.invalid/v1/chat/completions");
  assert.equal(request.headers.authorization, "Bearer sk-fake-key");
  assert.deepEqual(request.body.messages, [{ role: "user", content: "hello" }]);
});

test("parses OpenAI-compatible tool calls", () => {
  const result = parseOpenAICompatibleResponse(200, {
    choices: [
      {
        message: {
          tool_calls: [
            { id: "call-1", type: "function", function: { name: "list", arguments: "{\"path\":\".\"}" } }
          ]
        }
      }
    ]
  });

  assert.equal(result.toolCalls[0].name, "list");
  assert.deepEqual(result.toolCalls[0].arguments, { path: "." });
});

test("adapter uses injected transport and redacts provider errors", async () => {
  const adapter = new OpenAICompatibleProviderAdapter({
    baseUrl: "https://api.example.invalid/v1",
    apiKey: "sk-transport-secret-key",
    model: "fake-model",
    transport: {
      async send() {
        throw new Error("failed with sk-transport-secret-key");
      }
    }
  });

  await assert.rejects(
    adapter.complete({ turn: 1, messages: [{ role: "user", content: "hello" }] }),
    (error) => error instanceof Error && !error.message.includes("sk-transport-secret-key")
  );
});
