import type { RuntimeProviderResponse } from "../../runtime/index.js";

export interface OpenAICompatibleHttpRequest {
  readonly url: string;
  readonly method: "POST";
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface OpenAICompatibleHttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface OpenAICompatibleTransport {
  send(request: OpenAICompatibleHttpRequest): Promise<OpenAICompatibleHttpResponse>;
}

export interface OpenAICompatibleTool {
  readonly type: "function";
  readonly function: {
    readonly name: string;
    readonly description?: string;
    readonly parameters: unknown;
  };
}

export interface OpenAICompatibleCompletionRequest {
  readonly model: string;
  readonly messages: readonly {
    readonly role: "system" | "user" | "assistant" | "tool";
    readonly content: string | null;
    readonly tool_call_id?: string;
    readonly tool_calls?: readonly unknown[];
  }[];
  readonly tools?: readonly OpenAICompatibleTool[];
}

export interface OpenAICompatibleProviderOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly transport: OpenAICompatibleTransport;
  readonly tools?: readonly OpenAICompatibleTool[];
}

export type OpenAICompatibleProviderResponse = RuntimeProviderResponse;
