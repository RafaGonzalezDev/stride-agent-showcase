import { lstat, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { ListEntry, ListToolOutput, ListToolRequest, Tool, ToolContext, ToolResult } from "./types.js";
import { getLimits, isDirectory, isSensitivePath, resolveExistingWorkspacePath } from "./security.js";

export class ListTool implements Tool<ListToolRequest, ListToolOutput> {
  public readonly name = "list";
  public readonly description = "List workspace files without using shell commands.";
  public readonly capability = "filesystem:read";
  public readonly policyEnforced = true as const;

  public async execute(request: ListToolRequest, context: ToolContext): Promise<ToolResult<ListToolOutput>> {
    const targetPath = typeof request.path === "string" && request.path.trim().length > 0 ? request.path : ".";
    const resolved = await resolveExistingWorkspacePath(context.workspaceRoot, targetPath, this.name, this.capability);
    if ("ok" in resolved) {
      return resolved;
    }

    const limits = getLimits(context);
    const maxEntries = readPositiveInteger(request.maxEntries) ?? limits.maxSearchResults;
    const maxDepth = readNonNegativeInteger(request.maxDepth) ?? 2;
    const evaluation = await context.policyGate.evaluate({
      toolName: this.name,
      capability: this.capability,
      target: resolved.relativePath,
      cwd: resolved.root,
      parameterSummary: { path: resolved.relativePath, maxDepth, maxEntries }
    });

    if (evaluation.decision.state !== "allow") {
      return {
        ok: false,
        code: evaluation.decision.state === "ask" ? "policy-required" : "policy-denied",
        error: "Policy did not allow listing files.",
        audit: {
          toolName: this.name,
          capability: this.capability,
          target: resolved.relativePath,
          policyDecision: evaluation.decision,
          sideEffect: false
        }
      };
    }

    const entries: ListEntry[] = [];
    const skipped: { path: string; reason: string }[] = [];

    if (!(await isDirectory(resolved.absolutePath))) {
      if (isSensitivePath(resolved.absolutePath)) {
        skipped.push({ path: resolved.relativePath, reason: "sensitive-file" });
      } else {
        entries.push({ path: resolved.relativePath, type: "file" });
      }
    } else {
      await collectEntries({
        root: resolved.root,
        directory: resolved.absolutePath,
        depth: 1,
        maxDepth,
        maxEntries,
        entries,
        skipped
      });
    }

    return {
      ok: true,
      output: {
        entries,
        skipped,
        truncated: entries.length >= maxEntries
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

interface CollectEntriesOptions {
  readonly root: string;
  readonly directory: string;
  readonly depth: number;
  readonly maxDepth: number;
  readonly maxEntries: number;
  readonly entries: ListEntry[];
  readonly skipped: { path: string; reason: string }[];
}

async function collectEntries(options: CollectEntriesOptions): Promise<void> {
  if (options.entries.length >= options.maxEntries || options.depth > options.maxDepth) {
    return;
  }

  const directoryEntries = await readdir(options.directory, { withFileTypes: true });
  const sortedEntries = [...directoryEntries].sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of sortedEntries) {
    if (options.entries.length >= options.maxEntries) {
      return;
    }

    const absolutePath = join(options.directory, entry.name);
    const relativePath = relative(options.root, absolutePath).split(sep).join("/");

    if (entry.isSymbolicLink()) {
      options.skipped.push({ path: relativePath, reason: "symlink" });
      continue;
    }

    if (isSensitivePath(absolutePath)) {
      options.skipped.push({ path: relativePath, reason: "sensitive-file" });
      continue;
    }

    const info = await lstat(absolutePath);
    if (info.isDirectory()) {
      options.entries.push({ path: relativePath, type: "directory" });
      await collectEntries({ ...options, directory: absolutePath, depth: options.depth + 1 });
      continue;
    }

    if (info.isFile()) {
      options.entries.push({ path: relativePath, type: "file" });
    }
  }
}

function readPositiveInteger(value: number | undefined): number | undefined {
  return value !== undefined && Number.isInteger(value) && value > 0 ? value : undefined;
}

function readNonNegativeInteger(value: number | undefined): number | undefined {
  return value !== undefined && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export const listTool = new ListTool();
