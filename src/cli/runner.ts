import { parseCliArgs } from "./parser.js";
import type { CliError, CliJsonEnvelope, CliOptions, CliResult, CliRunDependencies } from "./types.js";

const helpText = `Usage: stride-showcase [options]

Options:
  --print <prompt>  Run one safe fake-provider request.
  --json            Emit a stable JSON envelope.
  --help, -h        Show this help text.
`;

export function getCliHelpText(): string {
  return helpText;
}

export function runCli(args: readonly string[], dependencies: CliRunDependencies = {}): CliResult | Promise<CliResult> {
  const parsed = parseCliArgs(args);

  if (!parsed.ok) {
    return renderError(parsed.error, parsed.json);
  }

  return renderSuccess(parsed.options, dependencies);
}

function renderSuccess(options: CliOptions, dependencies: CliRunDependencies): CliResult | Promise<CliResult> {
  if (options.mode === "help") {
    return { ok: true, status: "success", exitCode: 0, stdout: helpText, stderr: "" };
  }

  return renderRuntimePrint(options, dependencies);
}

async function renderRuntimePrint(options: CliOptions, dependencies: CliRunDependencies): Promise<CliResult> {
  if (dependencies.runtime === undefined) {
    return renderError({ code: "RUNTIME_ERROR", message: "CLI runtime dependencies were not configured." }, options.json);
  }

  try {
    const result = await dependencies.runtime.run({ input: options.prompt ?? "" });

    if (!result.ok) {
      const mapped = mapRuntimeFailure(result.errorCode, result.error, dependencies);
      return renderError(mapped.error, options.json, mapped.status, result.events);
    }

    if (options.json) {
      return {
        ok: true,
        status: "success",
        exitCode: 0,
        stdout: `${stringifyEnvelope({ ok: true, status: "success", mode: options.mode, output: result.output })}\n`,
        stderr: ""
      };
    }

    return { ok: true, status: "success", exitCode: 0, stdout: `${result.output}\n`, stderr: "" };
  } catch (error) {
    return renderError({ code: "RUNTIME_ERROR", message: redactMessage(errorToMessage(error), dependencies) }, options.json);
  }
}

function mapRuntimeFailure(
  errorCode: string,
  error: string,
  dependencies: CliRunDependencies
): { readonly status: CliResult["status"]; readonly error: CliError } {
  const message = redactMessage(error, dependencies);

  if (errorCode === "needs-approval") {
    return { status: "needs-approval", error: { code: "NEEDS_APPROVAL", message } };
  }

  if (errorCode === "permission-denied") {
    return { status: "error", error: { code: "PERMISSION_DENIED", message } };
  }

  return { status: "error", error: { code: "RUNTIME_ERROR", message } };
}

function renderError(
  error: CliError,
  json: boolean,
  status: CliResult["status"] = "error",
  events?: readonly unknown[]
): CliResult {
  if (json) {
    return {
      ok: false,
      status,
      exitCode: 1,
      stdout: `${stringifyEnvelope({ ok: false, status, error, ...(events === undefined ? {} : { events }) })}\n`,
      stderr: "",
      error
    };
  }

  return { ok: false, status, exitCode: 1, stdout: "", stderr: `Error: ${error.message}\n`, error };
}

function redactMessage(message: string, dependencies: CliRunDependencies): string {
  return dependencies.redactor?.redact(message) ?? message;
}

function stringifyEnvelope(envelope: CliJsonEnvelope): string {
  return JSON.stringify(envelope);
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
