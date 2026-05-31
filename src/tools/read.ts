import { readFile } from "node:fs/promises";
import type { ReadToolOutput, ReadToolRequest, Tool, ToolContext, ToolResult } from "./types.js";
import { assertReadableTextFile, byteLength, getLimits, redactToolText, resolveExistingWorkspacePath } from "./security.js";

export class ReadTool implements Tool<ReadToolRequest, ReadToolOutput> {
  public readonly name = "read";
  public readonly description = "Read a UTF-8 text file inside the workspace after policy approval.";
  public readonly capability = "filesystem:read";
  public readonly policyEnforced = true as const;

  public async execute(request: ReadToolRequest, context: ToolContext): Promise<ToolResult<ReadToolOutput>> {
    const resolved = await resolveExistingWorkspacePath(context.workspaceRoot, request.path, this.name, this.capability);
    if ("ok" in resolved) {
      return resolved;
    }

    const limits = getLimits(context);
    const maxBytes = request.maxBytes ?? limits.maxFileBytes;
    const evaluation = await context.policyGate.evaluate({
      toolName: this.name,
      capability: this.capability,
      target: resolved.relativePath,
      cwd: resolved.root,
      parameterSummary: { path: resolved.relativePath, maxBytes }
    });

    if (evaluation.decision.state !== "allow") {
      return {
        ok: false,
        code: evaluation.decision.state === "ask" ? "policy-required" : "policy-denied",
        error: "Policy did not allow reading the file.",
        audit: {
          toolName: this.name,
          capability: this.capability,
          target: resolved.relativePath,
          policyDecision: evaluation.decision,
          sideEffect: false
        }
      };
    }

    const readableFailure = await assertReadableTextFile(resolved.absolutePath, maxBytes, this.name, resolved.relativePath);
    if (readableFailure !== undefined) {
      return readableFailure;
    }

    const content = await readFile(resolved.absolutePath, "utf8");
    const redacted = redactToolText(content);

    return {
      ok: true,
      output: {
        path: resolved.relativePath,
        content: redacted.content,
        bytes: byteLength(content),
        redacted: redacted.redacted
      },
      audit: {
        toolName: this.name,
        capability: this.capability,
        target: resolved.relativePath,
        policyDecision: evaluation.decision,
        sideEffect: false
      }
    };
  }
}

export const readTool = new ReadTool();
