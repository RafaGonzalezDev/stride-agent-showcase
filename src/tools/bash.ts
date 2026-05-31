import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { detectCompoundOperators, normalizeBashCommand } from "../policy/index.js";
import { redactSecrets } from "../security/redaction.js";
import type { BashToolOutput, BashToolRequest, ShellExecutionRequest, ShellExecutor, Tool, ToolContext, ToolResult } from "./types.js";
import { getLimits, resolveExistingWorkspacePath, truncateUtf8 } from "./security.js";

export class BashTool implements Tool<BashToolRequest, BashToolOutput> {
  public readonly name = "bash";
  public readonly description = "Execute a shell command after conservative policy approval.";
  public readonly capability = "shell:execute";
  public readonly policyEnforced = true as const;

  public constructor(private readonly executor: ShellExecutor = new NodeShellExecutor()) {}

  public async execute(request: BashToolRequest, context: ToolContext): Promise<ToolResult<BashToolOutput>> {
    const cwd = await resolveExistingWorkspacePath(context.workspaceRoot, request.cwd ?? ".", this.name, this.capability);
    if ("ok" in cwd) {
      return cwd;
    }

    const limits = getLimits(context);
    const timeoutMs = request.timeoutMs ?? limits.timeoutMs;
    const maxOutputBytes = request.maxOutputBytes ?? limits.maxOutputBytes;
    const rawCommand = request.command;
    const normalizedCommand = normalizeBashCommand(rawCommand);
    const compoundOperators = detectCompoundOperators(rawCommand);
    const evaluation = await context.policyGate.evaluate({
      toolName: this.name,
      capability: this.capability,
      target: normalizedCommand,
      cwd: cwd.absolutePath,
      parameterSummary: {
        rawCommand,
        normalizedCommand,
        compoundOperators,
        timeoutMs,
        maxOutputBytes,
        envKeys: Object.keys(request.env ?? {}).sort()
      }
    });

    const compoundAllowed = compoundOperators.length === 0 || (
      evaluation.decision.state === "allow" &&
      evaluation.decision.source === "explicit" &&
      evaluation.decision.scope === "command"
    );

    if (evaluation.decision.state !== "allow" || !compoundAllowed) {
      return {
        ok: false,
        code: evaluation.decision.state === "deny" || !compoundAllowed ? "policy-denied" : "policy-required",
        error: compoundAllowed ? "Policy did not allow executing the command." : "Compound shell commands require an explicit command policy allow.",
        audit: {
          toolName: this.name,
          capability: this.capability,
          target: normalizedCommand,
          policyDecision: evaluation.decision,
          sideEffect: false
        }
      };
    }

    const output = await this.executor.execute({
      command: rawCommand,
      cwd: cwd.absolutePath,
      ...(request.env === undefined ? {} : { env: request.env }),
      timeoutMs,
      maxOutputBytes
    });
    const redacted = redactBashOutput(output);

    return {
      ok: true,
      output: redacted,
      audit: {
        toolName: this.name,
        capability: this.capability,
        target: normalizedCommand,
        policyDecision: evaluation.decision,
        sideEffect: true
      }
    };
  }
}

export class NodeShellExecutor implements ShellExecutor {
  public async execute(request: ShellExecutionRequest): Promise<BashToolOutput> {
    return new Promise((resolve, reject) => {
      const child = spawn(request.command, [], {
        cwd: request.cwd,
        ...(request.env === undefined ? {} : { env: request.env }),
        shell: true,
        stdio: ["ignore", "pipe", "pipe"]
      });
      const stdout = new OutputCollector(request.maxOutputBytes);
      const stderr = new OutputCollector(request.maxOutputBytes);
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, request.timeoutMs);

      child.stdout.on("data", (chunk: Uint8Array) => stdout.append(chunk));
      child.stderr.on("data", (chunk: Uint8Array) => stderr.append(chunk));
      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        resolve({
          command: request.command,
          exitCode: code,
          signal,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
          timedOut,
          truncated: stdout.truncated || stderr.truncated,
          redacted: false
        });
      });
    });
  }
}

export class OutputCollector {
  private chunks = "";
  public truncated = false;

  public constructor(private readonly maxBytes: number) {}

  public append(chunk: Uint8Array | string): void {
    if (this.truncated) {
      return;
    }

    const value = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    const next = this.chunks + value;
    const truncated = truncateUtf8(next, this.maxBytes);
    this.chunks = truncated.value;
    this.truncated = truncated.truncated;
  }

  public toString(): string {
    return this.chunks;
  }
}

function redactBashOutput(output: BashToolOutput): BashToolOutput {
  const command = redactSecrets(output.command);
  const stdout = redactSecrets(output.stdout);
  const stderr = redactSecrets(output.stderr);

  return {
    ...output,
    command: command.value,
    stdout: stdout.value,
    stderr: stderr.value,
    redacted: output.redacted || command.redactionApplied || stdout.redactionApplied || stderr.redactionApplied
  };
}

export const bashTool = new BashTool();
