import { Buffer } from "node:buffer";
import { access, lstat, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { redactSecrets } from "../security/redaction.js";
import type { ToolContext, ToolFailure, ToolLimits } from "./types.js";

export const defaultToolLimits: ToolLimits = {
  maxFileBytes: 1024 * 1024,
  maxSearchResults: 100,
  maxOutputBytes: 64 * 1024,
  timeoutMs: 30_000
};

const sensitiveBasenames = new Set([
  ".env",
  ".env.local",
  ".env.production",
  "credentials.json",
  ".npmrc",
  ".pypirc",
  "id_rsa",
  "id_ed25519"
]);

const sensitiveExtensions = [".pem", ".key", ".p12", ".pfx"];

export function getLimits(context: ToolContext): ToolLimits {
  return { ...defaultToolLimits, ...(context.limits ?? {}) };
}

export async function resolveWorkspaceRoot(workspaceRoot: string): Promise<string> {
  return realpath(resolve(workspaceRoot));
}

export async function resolveExistingWorkspacePath(
  workspaceRoot: string,
  requestedPath: string,
  toolName = "read",
  capability = "filesystem:read"
): Promise<{ readonly root: string; readonly absolutePath: string; readonly relativePath: string } | ToolFailure> {
  const root = await resolveWorkspaceRoot(workspaceRoot);
  const candidate = resolveCandidate(root, requestedPath);
  const boundaryFailure = validateBoundary(root, candidate, toolName, capability, requestedPath);
  if (boundaryFailure !== undefined) {
    return boundaryFailure;
  }

  const realCandidate = await realpath(candidate).catch((error: unknown) => {
    if (isMissingOrInvalidPathError(error)) {
      return undefined;
    }
    throw error;
  });

  if (realCandidate === undefined) {
    return failure("invalid-request", "Path does not exist or is invalid.", toolName, capability, requestedPath);
  }

  const realBoundaryFailure = validateBoundary(root, realCandidate, toolName, capability, requestedPath);
  if (realBoundaryFailure !== undefined) {
    return realBoundaryFailure;
  }

  return { root, absolutePath: realCandidate, relativePath: toRelative(root, realCandidate) };
}

export async function resolveWritableWorkspacePath(
  workspaceRoot: string,
  requestedPath: string,
  toolName = "write"
): Promise<
  | { readonly root: string; readonly absolutePath: string; readonly relativePath: string; readonly exists: boolean; readonly parentExists: boolean }
  | ToolFailure
> {
  const root = await resolveWorkspaceRoot(workspaceRoot);
  const candidate = resolveCandidate(root, requestedPath);
  const boundaryFailure = validateBoundary(root, candidate, toolName, "filesystem:write", requestedPath);
  if (boundaryFailure !== undefined) {
    return boundaryFailure;
  }

  const exists = await pathExists(candidate);
  const parentPath = dirname(candidate);
  const parentExists = await pathExists(parentPath);
  const pathToValidate = exists ? await realpath(candidate) : await resolveExistingAncestor(parentPath, root);
  const realBoundaryFailure = validateBoundary(root, pathToValidate, toolName, "filesystem:write", requestedPath);
  if (realBoundaryFailure !== undefined) {
    return realBoundaryFailure;
  }

  return { root, absolutePath: candidate, relativePath: toRelative(root, candidate), exists, parentExists };
}

export function isSensitivePath(filePath: string): boolean {
  const name = basename(filePath).toLowerCase();

  if (name === ".env.example") {
    return false;
  }

  return (
    sensitiveBasenames.has(name) ||
    name.startsWith(".env.") ||
    name.includes("secret") ||
    name.includes("token") ||
    sensitiveExtensions.some((extension) => name.endsWith(extension))
  );
}

export async function assertReadableTextFile(
  absolutePath: string,
  maxBytes: number,
  toolName: string,
  target: string
): Promise<ToolFailure | undefined> {
  if (isSensitivePath(absolutePath)) {
    return failure("sensitive-file", "Sensitive files cannot be read by this tool.", toolName, "filesystem:read", target);
  }

  const info = await stat(absolutePath).catch((error: unknown) => {
    if (isMissingOrInvalidPathError(error)) {
      return undefined;
    }
    throw error;
  });

  if (info === undefined) {
    return failure("invalid-request", "Path does not exist or is invalid.", toolName, "filesystem:read", target);
  }

  if (!info.isFile()) {
    return failure("invalid-request", "Path must point to a file.", toolName, "filesystem:read", target);
  }

  if (info.size > maxBytes) {
    return failure("file-too-large", "File exceeds the configured maximum size.", toolName, "filesystem:read", target);
  }

  const data = await readFile(absolutePath).catch((error: unknown) => {
    if (isMissingOrInvalidPathError(error)) {
      return undefined;
    }
    throw error;
  });

  if (data === undefined) {
    return failure("invalid-request", "Path does not exist or is invalid.", toolName, "filesystem:read", target);
  }

  if (isBinaryContent(data)) {
    return failure("binary-file", "Binary files cannot be read as text.", toolName, "filesystem:read", target);
  }

  return undefined;
}

export async function isDirectory(absolutePath: string): Promise<boolean> {
  return (await lstat(absolutePath)).isDirectory();
}

export function redactToolText(content: string): { readonly content: string; readonly redacted: boolean } {
  const redacted = redactSecrets(content);
  return { content: redacted.value, redacted: redacted.redactionApplied };
}

export function byteLength(value: string): number {
  return Buffer.from(value, "utf8").byteLength;
}

export function truncateUtf8(value: string, maxBytes: number): { readonly value: string; readonly truncated: boolean } {
  if (byteLength(value) <= maxBytes) {
    return { value, truncated: false };
  }

  const bytes = Buffer.from(value, "utf8").subarray(0, maxBytes);
  return { value: Buffer.from(bytes).toString("utf8"), truncated: true };
}

export function isBinaryContent(data: Uint8Array): boolean {
  const sampleSize = Math.min(data.byteLength, 8000);
  if (sampleSize === 0) {
    return false;
  }

  let suspicious = 0;
  for (let index = 0; index < sampleSize; index += 1) {
    const value = data[index]!;
    if (value === 0) {
      return true;
    }
    if (value < 7 || (value > 14 && value < 32)) {
      suspicious += 1;
    }
  }

  return suspicious / sampleSize > 0.3;
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function failure(
  code: ToolFailure["code"],
  error: string,
  toolName: string,
  capability: string,
  target?: string
): ToolFailure {
  return {
    ok: false,
    code,
    error,
    audit: {
      toolName,
      capability,
      ...(target === undefined ? {} : { target }),
      sideEffect: false
    }
  };
}

function resolveCandidate(root: string, requestedPath: string): string {
  return isAbsolute(requestedPath) ? resolve(requestedPath) : resolve(root, requestedPath);
}

function validateBoundary(
  root: string,
  candidate: string,
  toolName: string,
  capability: string,
  target: string
): ToolFailure | undefined {
  const relativePath = relative(root, candidate);
  if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    return undefined;
  }

  return failure("outside-workspace", "Path resolves outside the workspace root.", toolName, capability, target);
}

function toRelative(root: string, absolutePath: string): string {
  const value = relative(root, absolutePath);
  return value === "" ? "." : value.split(sep).join("/");
}

function isMissingOrInvalidPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR", "EINVAL"].includes(String(error.code));
}

async function resolveExistingAncestor(startPath: string, root: string): Promise<string> {
  let current = startPath;

  while (!(await pathExists(current))) {
    const parent = dirname(current);
    if (parent === current) {
      return root;
    }
    current = parent;
  }

  return realpath(current);
}
