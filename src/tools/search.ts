import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { SearchMatch, SearchToolOutput, SearchToolRequest, Tool, ToolContext, ToolResult } from "./types.js";
import {
  assertReadableTextFile,
  failure,
  getLimits,
  isDirectory,
  isSensitivePath,
  redactToolText,
  resolveExistingWorkspacePath
} from "./security.js";

export class SearchTool implements Tool<SearchToolRequest, SearchToolOutput> {
  public readonly name = "search";
  public readonly description = "Search text files inside the workspace after policy approval.";
  public readonly capability = "filesystem:read";
  public readonly policyEnforced = true as const;

  public async execute(request: SearchToolRequest, context: ToolContext): Promise<ToolResult<SearchToolOutput>> {
    if (request.query.length === 0) {
      return failure("invalid-request", "Search query must not be empty.", this.name, this.capability);
    }

    const targetPath = typeof request.path === "string" && request.path.trim().length > 0 ? request.path : ".";
    const resolved = await resolveExistingWorkspacePath(context.workspaceRoot, targetPath, this.name, this.capability);
    if ("ok" in resolved) {
      return resolved;
    }

    const limits = getLimits(context);
    const maxResults = request.maxResults ?? limits.maxSearchResults;
    const evaluation = await context.policyGate.evaluate({
      toolName: this.name,
      capability: this.capability,
      target: resolved.relativePath,
      cwd: resolved.root,
      parameterSummary: { path: resolved.relativePath, queryBytes: request.query.length, maxResults }
    });

    if (evaluation.decision.state !== "allow") {
      return {
        ok: false,
        code: evaluation.decision.state === "ask" ? "policy-required" : "policy-denied",
        error: "Policy did not allow searching files.",
        audit: {
          toolName: this.name,
          capability: this.capability,
          target: resolved.relativePath,
          policyDecision: evaluation.decision,
          sideEffect: false
        }
      };
    }

    const files = await collectSearchFiles(resolved.root, resolved.absolutePath, limits.maxFileBytes);
    const matches: SearchMatch[] = [];
    let redacted = false;

    for (const file of files) {
      if (matches.length >= maxResults) {
        break;
      }

      const content = await readFile(file.absolutePath, "utf8");
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (matches.length >= maxResults) {
          break;
        }

        const line = lines[index]!;
        if (!line.includes(request.query)) {
          continue;
        }

        const publicLine = redactToolText(line);
        redacted = redacted || publicLine.redacted;
        matches.push({ path: file.relativePath, line: index + 1, text: publicLine.content });
      }
    }

    return {
      ok: true,
      output: {
        matches,
        truncated: matches.length >= maxResults,
        redacted
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

interface SearchFile {
  readonly absolutePath: string;
  readonly relativePath: string;
}

async function collectSearchFiles(root: string, absolutePath: string, maxFileBytes: number): Promise<readonly SearchFile[]> {
  if (!(await isDirectory(absolutePath))) {
    const relativePath = relative(root, absolutePath).split(sep).join("/") || ".";
    const readableFailure = await assertReadableTextFile(absolutePath, maxFileBytes, "search", relativePath);
    return readableFailure === undefined ? [{ absolutePath, relativePath }] : [];
  }

  const result: SearchFile[] = [];
  await collectDirectoryFiles(root, absolutePath, maxFileBytes, result);
  return result;
}

async function collectDirectoryFiles(root: string, directory: string, maxFileBytes: number, result: SearchFile[]): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolutePath = join(directory, entry.name);
    const relativePath = relative(root, absolutePath).split(sep).join("/");

    if (entry.isSymbolicLink() || isSensitivePath(absolutePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      await collectDirectoryFiles(root, absolutePath, maxFileBytes, result);
      continue;
    }

    if (entry.isFile()) {
      const readableFailure = await assertReadableTextFile(absolutePath, maxFileBytes, "search", relativePath);
      if (readableFailure === undefined) {
        result.push({ absolutePath, relativePath });
      }
    }
  }
}

export const searchTool = new SearchTool();
