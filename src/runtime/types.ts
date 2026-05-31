import type { Tool, ToolContext, ToolResult } from "../tools/index.js";

export type RuntimeMessageRole = "system" | "user" | "assistant" | "tool";

export interface RuntimeToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
}

export interface RuntimeMessage {
  readonly role: RuntimeMessageRole;
  readonly content: string;
  readonly name?: string;
  readonly toolCallId?: string;
  readonly toolCalls?: readonly RuntimeToolCall[];
}

export interface RuntimeProviderRequest {
  readonly messages: readonly RuntimeMessage[];
  readonly turn: number;
}

export interface RuntimeProviderResponse {
  readonly content?: string;
  readonly toolCalls?: readonly RuntimeToolCall[];
}

export type RuntimeProvider = (request: RuntimeProviderRequest) => Promise<RuntimeProviderResponse>;

export type RuntimeEventType =
  | "runtime.started"
  | "provider.requested"
  | "provider.completed"
  | "assistant.completed"
  | "tool.requested"
  | "tool.completed"
  | "runtime.completed"
  | "runtime.failed";

export interface RuntimeEvent {
  readonly type: RuntimeEventType;
  readonly timestamp: string;
  readonly payload: unknown;
}

export type RuntimeEventHandler = (event: RuntimeEvent) => void | Promise<void>;

export interface RuntimeRedactor {
  redact(value: string): string;
}

export type RuntimeTool = Tool;

export interface RuntimeToolRegistry {
  get(name: string): RuntimeTool | undefined;
}

export interface RoutedToolResult {
  readonly toolCallId: string;
  readonly name: string;
  readonly status: "success" | "failure" | "error";
  readonly result?: ToolResult<unknown>;
  readonly error?: string;
}

export interface ToolRouter {
  run(call: RuntimeToolCall): Promise<RoutedToolResult>;
}

export interface ToolRouterOptions {
  readonly tools?: Readonly<Record<string, RuntimeTool>>;
  readonly registry?: RuntimeToolRegistry;
  readonly toolContext: ToolContext;
  readonly redactor?: RuntimeRedactor;
}

export interface AgentRuntimeHooks {
  readonly onEvent?: RuntimeEventHandler;
  readonly onAuditEvent?: RuntimeEventHandler;
  readonly onSessionMessage?: (message: RuntimeMessage) => void | Promise<void>;
}

export interface AgentRuntimeOptions {
  readonly provider: RuntimeProvider;
  readonly toolRouter: ToolRouter;
  readonly maxTurns?: number;
  readonly redactor?: RuntimeRedactor;
  readonly hooks?: AgentRuntimeHooks;
  readonly stopOnPolicyFailure?: boolean;
}

export interface AgentRuntimeRunRequest {
  readonly input: string;
  readonly messages?: readonly RuntimeMessage[];
  readonly maxTurns?: number;
  readonly onEvent?: RuntimeEventHandler;
}

export type AgentRuntimeErrorCode = "needs-approval" | "permission-denied" | "max-turns" | "runtime-error";

export interface AgentRuntimeSuccess {
  readonly ok: true;
  readonly output: string;
  readonly messages: readonly RuntimeMessage[];
  readonly events: readonly RuntimeEvent[];
}

export interface AgentRuntimeFailure {
  readonly ok: false;
  readonly output: "";
  readonly messages: readonly RuntimeMessage[];
  readonly events: readonly RuntimeEvent[];
  readonly error: string;
  readonly errorCode: AgentRuntimeErrorCode;
}

export type AgentRuntimeResult = AgentRuntimeSuccess | AgentRuntimeFailure;
