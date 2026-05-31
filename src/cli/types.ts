import type { AgentRuntimeResult } from "../runtime/index.js";

export type CliMode = "help" | "print";

export interface CliOptions {
  readonly mode: CliMode;
  readonly prompt?: string;
  readonly json: boolean;
}

export interface CliError {
  readonly code: string;
  readonly message: string;
}

export interface CliResult {
  readonly ok: boolean;
  readonly status: "success" | "error" | "needs-approval";
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: CliError;
}

export interface CliJsonEnvelope {
  readonly ok: boolean;
  readonly status: CliResult["status"];
  readonly mode?: CliMode;
  readonly output?: string;
  readonly error?: CliError;
  readonly events?: readonly unknown[];
}

export interface CliRuntime {
  run(request: { readonly input: string }): Promise<AgentRuntimeResult>;
}

export interface CliRunDependencies {
  readonly runtime?: CliRuntime;
  readonly redactor?: { redact(value: string): string };
}
