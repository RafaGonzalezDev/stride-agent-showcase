import { redactSecrets } from "../../security/redaction.js";
import type { RuntimeToolCall } from "../../runtime/index.js";
import type { OpenAICompatibleProviderResponse } from "./types.js";

interface OpenAICompatibleSuccessBody {
  readonly choices?: readonly {
    readonly message?: {
      readonly content?: unknown;
      readonly tool_calls?: unknown;
    };
    readonly finish_reason?: unknown;
  }[];
}

export function parseOpenAICompatibleResponse(status: number, body: unknown): OpenAICompatibleProviderResponse {
  if (status < 200 || status >= 300) {
    throw new Error(redactSecrets(readErrorMessage(body, status)).value);
  }

  if (!isObject(body)) {
    throw new Error("OpenAI-compatible response body must be an object.");
  }

  const successBody = body as OpenAICompatibleSuccessBody;
  const message = successBody.choices?.[0]?.message;
  const content = readOptionalString(message?.content);
  const toolCalls = parseToolCalls(message?.tool_calls);

  if (content === undefined && toolCalls.length === 0) {
    throw new Error("OpenAI-compatible response is missing message content or tool calls.");
  }

  return {
    ...(content === undefined ? {} : { content }),
    ...(toolCalls.length === 0 ? {} : { toolCalls })
  };
}

function parseToolCalls(value: unknown): readonly RuntimeToolCall[] {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("OpenAI-compatible response tool_calls must be an array when present.");
  }

  return value.map((entry, index) => parseToolCall(entry, index));
}

function parseToolCall(value: unknown, index: number): RuntimeToolCall {
  if (!isObject(value)) {
    throw new Error(`OpenAI-compatible response tool_calls[${index}] must be an object.`);
  }

  const id = value["id"];
  const type = value["type"];
  const functionCall = value["function"];

  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`OpenAI-compatible response tool_calls[${index}] is missing id.`);
  }

  if (type !== undefined && type !== "function") {
    throw new Error(`OpenAI-compatible response tool_calls[${index}] must be a function tool call.`);
  }

  if (!isObject(functionCall)) {
    throw new Error(`OpenAI-compatible response tool_calls[${index}] is missing function.`);
  }

  const name = functionCall["name"];
  if (typeof name !== "string" || name.length === 0) {
    throw new Error(`OpenAI-compatible response tool_calls[${index}] function is missing name.`);
  }

  return {
    id,
    name,
    arguments: parseToolArguments(functionCall["arguments"], index)
  };
}

function parseToolArguments(value: unknown, index: number): unknown {
  if (value === undefined || value === null || value === "") {
    return {};
  }

  if (isObject(value) || Array.isArray(value)) {
    return value;
  }

  if (typeof value !== "string") {
    throw new Error(`OpenAI-compatible response tool_calls[${index}] function arguments must be JSON.`);
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new Error(`OpenAI-compatible response tool_calls[${index}] function arguments must be valid JSON.`);
  }
}

function readOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error("OpenAI-compatible response message content must be a string when present.");
  }

  return value;
}

function readErrorMessage(body: unknown, status: number): string {
  if (isObject(body)) {
    const error = body["error"];
    if (isObject(error) && typeof error["message"] === "string") {
      return error["message"];
    }

    if (typeof body["message"] === "string") {
      return body["message"];
    }
  }

  return `OpenAI-compatible provider request failed with status ${status}.`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
