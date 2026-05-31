import type { PermissionDecision, PolicyEvaluation, PolicyRequest } from "../policy/index.js";

export interface ToolPolicyGate {
  evaluate(request: PolicyRequest): PolicyEvaluation | Promise<PolicyEvaluation>;
}

export interface ToolLimits {
  readonly maxFileBytes: number;
  readonly maxSearchResults: number;
  readonly maxOutputBytes: number;
  readonly timeoutMs: number;
}

export interface ToolContext {
  readonly workspaceRoot: string;
  readonly policyGate: ToolPolicyGate;
  readonly limits?: Partial<ToolLimits>;
}

export interface ToolAudit {
  readonly toolName: string;
  readonly capability: string;
  readonly target?: string;
  readonly policyDecision?: PermissionDecision;
  readonly sideEffect: boolean;
}

export interface ToolSuccess<Output> {
  readonly ok: true;
  readonly output: Output;
  readonly audit: ToolAudit;
}

export interface ToolFailure {
  readonly ok: false;
  readonly code:
    | "invalid-request"
    | "outside-workspace"
    | "sensitive-file"
    | "binary-file"
    | "file-too-large"
    | "policy-required"
    | "policy-denied"
    | "execution-failed";
  readonly error: string;
  readonly audit: ToolAudit;
}

export type ToolResult<Output> = ToolSuccess<Output> | ToolFailure;

export interface Tool<Request = unknown, Output = unknown> {
  readonly name: string;
  readonly description: string;
  readonly capability: string;
  readonly policyEnforced: true;
  execute(request: Request, context: ToolContext): Promise<ToolResult<Output>>;
}

export interface ListToolRequest {
  readonly path?: string;
  readonly maxDepth?: number;
  readonly maxEntries?: number;
}

export interface ListEntry {
  readonly path: string;
  readonly type: "file" | "directory";
}

export interface ListToolOutput {
  readonly entries: readonly ListEntry[];
  readonly skipped: readonly { readonly path: string; readonly reason: string }[];
  readonly truncated: boolean;
}

export interface ReadToolRequest {
  readonly path: string;
  readonly maxBytes?: number;
}

export interface ReadToolOutput {
  readonly path: string;
  readonly content: string;
  readonly bytes: number;
  readonly redacted: boolean;
}

export interface SearchToolRequest {
  readonly path?: string;
  readonly query: string;
  readonly maxResults?: number;
}

export interface SearchMatch {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export interface SearchToolOutput {
  readonly matches: readonly SearchMatch[];
  readonly truncated: boolean;
  readonly redacted: boolean;
}

export interface WriteToolRequest {
  readonly path: string;
  readonly content: string;
  readonly createDirectories?: boolean;
}

export interface EditToolRequest {
  readonly path: string;
  readonly oldText: string;
  readonly newText: string;
  readonly replaceAll?: boolean;
}

export interface WriteToolOutput {
  readonly path: string;
  readonly diff: string;
  readonly written: boolean;
  readonly redacted: boolean;
}

export interface BashToolRequest {
  readonly command: string;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}

export interface ShellExecutionRequest {
  readonly command: string;
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}

export interface BashToolOutput {
  readonly command: string;
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly truncated: boolean;
  readonly redacted: boolean;
}

export interface ShellExecutor {
  execute(request: ShellExecutionRequest): Promise<BashToolOutput>;
}
