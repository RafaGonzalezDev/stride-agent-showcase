import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { EditToolRequest, Tool, ToolContext, ToolResult, WriteToolOutput, WriteToolRequest } from "./types.js";
import {
  assertReadableTextFile,
  byteLength,
  failure,
  getLimits,
  isSensitivePath,
  pathExists,
  redactToolText,
  resolveWritableWorkspacePath
} from "./security.js";

export class WriteTool implements Tool<WriteToolRequest, WriteToolOutput> {
  public readonly name = "write";
  public readonly description = "Write a UTF-8 text file after policy approval.";
  public readonly capability = "filesystem:write";
  public readonly policyEnforced = true as const;

  public async execute(request: WriteToolRequest, context: ToolContext): Promise<ToolResult<WriteToolOutput>> {
    const resolved = await resolveWritableWorkspacePath(context.workspaceRoot, request.path, this.name);
    if ("ok" in resolved) {
      return resolved;
    }

    if (isSensitivePath(resolved.absolutePath)) {
      return failure("sensitive-file", "Sensitive files cannot be written by this tool.", this.name, this.capability, resolved.relativePath);
    }

    const previous = resolved.exists ? await readFile(resolved.absolutePath, "utf8") : "";
    const publicDiff = redactToolText(createUnifiedDiff(resolved.relativePath, previous, request.content));
    const evaluation = await context.policyGate.evaluate({
      toolName: this.name,
      capability: this.capability,
      target: resolved.relativePath,
      cwd: resolved.root,
      parameterSummary: { bytes: byteLength(request.content), diff: publicDiff.content }
    });

    if (evaluation.decision.state !== "allow") {
      return {
        ok: false,
        code: evaluation.decision.state === "ask" ? "policy-required" : "policy-denied",
        error: "Policy did not allow writing the file.",
        audit: {
          toolName: this.name,
          capability: this.capability,
          target: resolved.relativePath,
          policyDecision: evaluation.decision,
          sideEffect: false
        }
      };
    }

    if (!resolved.parentExists && request.createDirectories !== true) {
      return failure("invalid-request", "Parent directory does not exist. Set createDirectories to true to create it.", this.name, this.capability, resolved.relativePath);
    }

    if (request.createDirectories === true) {
      await mkdir(dirname(resolved.absolutePath), { recursive: true });
    }

    await writeFile(resolved.absolutePath, request.content, "utf8");

    return {
      ok: true,
      output: { path: resolved.relativePath, diff: publicDiff.content, written: true, redacted: publicDiff.redacted },
      audit: {
        toolName: this.name,
        capability: this.capability,
        target: resolved.relativePath,
        policyDecision: evaluation.decision,
        sideEffect: true
      }
    };
  }
}

export class EditTool implements Tool<EditToolRequest, WriteToolOutput> {
  public readonly name = "edit";
  public readonly description = "Replace text in a UTF-8 file after policy approval.";
  public readonly capability = "filesystem:write";
  public readonly policyEnforced = true as const;

  public async execute(request: EditToolRequest, context: ToolContext): Promise<ToolResult<WriteToolOutput>> {
    const resolved = await resolveWritableWorkspacePath(context.workspaceRoot, request.path, this.name);
    if ("ok" in resolved) {
      return resolved;
    }

    const limits = getLimits(context);
    if (!(await pathExists(resolved.absolutePath))) {
      return failure("invalid-request", "Cannot edit a missing file.", this.name, this.capability, resolved.relativePath);
    }

    const readableFailure = await assertReadableTextFile(resolved.absolutePath, limits.maxFileBytes, this.name, resolved.relativePath);
    if (readableFailure !== undefined) {
      return readableFailure;
    }

    const previous = await readFile(resolved.absolutePath, "utf8");
    if (!previous.includes(request.oldText)) {
      return failure("invalid-request", "Edit target text was not found.", this.name, this.capability, resolved.relativePath);
    }

    const next = request.replaceAll === true ? previous.split(request.oldText).join(request.newText) : previous.replace(request.oldText, request.newText);
    const publicDiff = redactToolText(createUnifiedDiff(resolved.relativePath, previous, next));
    const evaluation = await context.policyGate.evaluate({
      toolName: this.name,
      capability: this.capability,
      target: resolved.relativePath,
      cwd: resolved.root,
      parameterSummary: {
        oldTextBytes: byteLength(request.oldText),
        newTextBytes: byteLength(request.newText),
        diff: publicDiff.content
      }
    });

    if (evaluation.decision.state !== "allow") {
      return {
        ok: false,
        code: evaluation.decision.state === "ask" ? "policy-required" : "policy-denied",
        error: "Policy did not allow editing the file.",
        audit: {
          toolName: this.name,
          capability: this.capability,
          target: resolved.relativePath,
          policyDecision: evaluation.decision,
          sideEffect: false
        }
      };
    }

    await writeFile(resolved.absolutePath, next, "utf8");

    return {
      ok: true,
      output: { path: resolved.relativePath, diff: publicDiff.content, written: true, redacted: publicDiff.redacted },
      audit: {
        toolName: this.name,
        capability: this.capability,
        target: resolved.relativePath,
        policyDecision: evaluation.decision,
        sideEffect: true
      }
    };
  }
}

export function createUnifiedDiff(path: string, before: string, after: string): string {
  const beforeLines = before.split(/\r?\n/);
  const afterLines = after.split(/\r?\n/);
  const lines = [`--- a/${path}`, `+++ b/${path}`];
  const max = Math.max(beforeLines.length, afterLines.length);

  for (let index = 0; index < max; index += 1) {
    const oldLine = beforeLines[index];
    const newLine = afterLines[index];

    if (oldLine === newLine) {
      lines.push(` ${oldLine ?? ""}`);
      continue;
    }

    if (oldLine !== undefined) {
      lines.push(`-${oldLine}`);
    }

    if (newLine !== undefined) {
      lines.push(`+${newLine}`);
    }
  }

  return lines.join("\n");
}

export const writeTool = new WriteTool();
export const editTool = new EditTool();
