import type { RuntimeMessage, RuntimeToolCall } from "../../runtime/index.js";
import type { OpenAICompatibleCompletionRequest, OpenAICompatibleHttpRequest, OpenAICompatibleProviderOptions } from "./types.js";

export interface BuildOpenAICompatibleRequestOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly messages: readonly RuntimeMessage[];
  readonly tools?: OpenAICompatibleProviderOptions["tools"];
}

export function buildOpenAICompatibleRequest(options: BuildOpenAICompatibleRequestOptions): OpenAICompatibleHttpRequest {
  const body: OpenAICompatibleCompletionRequest = {
    model: options.model,
    messages: options.messages.map(toOpenAIMessage),
    ...(options.tools === undefined || options.tools.length === 0 ? {} : { tools: options.tools })
  };

  return {
    url: `${options.baseUrl.replace(/\/+$/, "")}/chat/completions`,
    method: "POST",
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      "content-type": "application/json"
    },
    body
  };
}

function toOpenAIMessage(message: RuntimeMessage): OpenAICompatibleCompletionRequest["messages"][number] {
  if (message.role === "assistant" && message.toolCalls !== undefined && message.toolCalls.length > 0) {
    return {
      role: "assistant",
      content: message.content.length === 0 ? null : message.content,
      tool_calls: message.toolCalls.map(toOpenAIToolCall)
    };
  }

  if (message.role === "tool") {
    if (message.toolCallId === undefined || message.toolCallId.length === 0) {
      throw new Error("OpenAI-compatible tool messages require toolCallId.");
    }

    return {
      role: "tool",
      content: message.content,
      tool_call_id: message.toolCallId
    };
  }

  return {
    role: message.role,
    content: message.content
  };
}

function toOpenAIToolCall(call: RuntimeToolCall): unknown {
  return {
    id: call.id,
    type: "function",
    function: {
      name: call.name,
      arguments: JSON.stringify(call.arguments ?? {})
    }
  };
}
