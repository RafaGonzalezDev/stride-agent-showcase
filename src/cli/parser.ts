import type { CliError, CliOptions } from "./types.js";

export type ParseCliResult = { readonly ok: true; readonly options: CliOptions } | { readonly ok: false; readonly error: CliError; readonly json: boolean };

export function parseCliArgs(args: readonly string[]): ParseCliResult {
  let json = false;
  let prompt: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (arg === "--help" || arg === "-h") {
      return { ok: true, options: { mode: "help", json } };
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    if (arg === "--print") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return { ok: false, error: { code: "INVALID_ARGS", message: "Missing prompt value for --print." }, json };
      }
      prompt = value;
      index += 1;
      continue;
    }

    if (arg.startsWith("--print=")) {
      const value = arg.slice("--print=".length);
      if (value.length === 0) {
        return { ok: false, error: { code: "INVALID_ARGS", message: "Missing prompt value for --print." }, json };
      }
      prompt = value;
      continue;
    }

    return { ok: false, error: { code: "INVALID_ARGS", message: `Unknown option: ${arg}` }, json };
  }

  if (prompt === undefined) {
    return { ok: true, options: { mode: "help", json } };
  }

  return { ok: true, options: { mode: "print", prompt, json } };
}
