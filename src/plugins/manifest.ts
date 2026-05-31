import type { NormalizedPluginToolManifest, PluginManifest, PluginPermission } from "./types.js";

const pluginNamePattern = /^[a-z0-9][a-z0-9-]*(?:[./][a-z0-9][a-z0-9-]*)*$/;
const toolNamePattern = /^[a-z0-9][a-z0-9-]*(?:[._-][a-z0-9][a-z0-9-]*)*$/;
const capabilityPattern = /^[a-z][a-z0-9-]*(?::[a-z][a-z0-9-]*)+$/;
const semverPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const compatibilityPattern = /^(?:\*|\d+\.\d+\.\d+|[~^]?\d+\.\d+\.\d+|>=\d+\.\d+\.\d+(?:\s+<\d+\.\d+\.\d+)?)$/;

export function validatePluginManifest(value: unknown): PluginManifest {
  if (!isPlainObject(value)) {
    throw new Error("Plugin manifest must be a plain object.");
  }

  const name = requireString(value, "name");
  const version = requireString(value, "version");
  const description = requireString(value, "description");
  const entrypoint = requireString(value, "entrypoint");
  const tools = requireArray(value, "tools");
  const permissions = requireArray(value, "permissions");
  const agentCompatibility = requireString(value, "agentCompatibility");

  if (!pluginNamePattern.test(name)) {
    throw new Error("Plugin manifest name must be a safe stable identifier or namespace.");
  }

  if (!semverPattern.test(version)) {
    throw new Error("Plugin manifest version must use semver syntax.");
  }

  if (description.trim().length === 0) {
    throw new Error("Plugin manifest description must not be empty.");
  }

  validateEntrypoint(entrypoint);
  validateCompatibility(agentCompatibility);

  return {
    name,
    version,
    description,
    entrypoint,
    tools: validateTools(name, tools),
    permissions: validatePermissions(permissions),
    agentCompatibility
  };
}

export function normalizePluginToolName(pluginName: string, toolName: string): string {
  return toolName.startsWith(`${pluginName}.`) ? toolName : `${pluginName}.${toolName}`;
}

export function validateEntrypoint(entrypoint: string): void {
  if (entrypoint.length === 0) {
    throw new Error("Plugin manifest entrypoint must not be empty.");
  }

  if (entrypoint.startsWith("/") || /^[A-Za-z]:[\\/]/.test(entrypoint)) {
    throw new Error("Plugin manifest entrypoint must be relative.");
  }

  const segments = entrypoint.split(/[\\/]+/);
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("Plugin manifest entrypoint must not contain traversal segments.");
  }
}

function validateTools(pluginName: string, values: readonly unknown[]): readonly NormalizedPluginToolManifest[] {
  if (values.length === 0) {
    throw new Error("Plugin manifest tools must be a non-empty list.");
  }

  const names = new Set<string>();
  return values.map((value) => {
    if (!isPlainObject(value)) {
      throw new Error("Plugin manifest tools entries must be plain objects.");
    }

    const declaredName = requireString(value, "name");
    const localName = declaredName.startsWith(`${pluginName}.`) ? declaredName.slice(pluginName.length + 1) : declaredName;
    const capability = requireString(value, "capability");
    const description = readOptionalString(value, "description");
    const permissions = readOptionalPermissions(value, "permissions");

    if (!toolNamePattern.test(localName)) {
      throw new Error("Plugin manifest tool names must be safe identifiers.");
    }

    validateCapability(capability);
    const namespacedName = normalizePluginToolName(pluginName, localName);
    if (names.has(namespacedName)) {
      throw new Error(`Plugin manifest tool name collision: ${namespacedName}.`);
    }
    names.add(namespacedName);

    return {
      name: namespacedName,
      localName,
      namespacedName,
      capability,
      ...(description === undefined ? {} : { description }),
      ...(permissions === undefined ? {} : { permissions })
    };
  });
}

function validatePermissions(values: readonly unknown[]): readonly PluginPermission[] {
  return values.map((value) => {
    if (typeof value !== "string") {
      throw new Error("Plugin manifest permissions must be strings.");
    }
    validateCapability(value);
    return value;
  });
}

function readOptionalPermissions(record: Record<string, unknown>, key: string): readonly PluginPermission[] | undefined {
  const value = record[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`Plugin manifest ${key} must be an array when provided.`);
  }
  return validatePermissions(value);
}

function validateCapability(value: string): void {
  if (!capabilityPattern.test(value)) {
    throw new Error("Plugin manifest permissions and capabilities must use capability syntax.");
  }
}

function validateCompatibility(value: string): void {
  if (!compatibilityPattern.test(value)) {
    throw new Error("Plugin manifest agentCompatibility must be a basic version or range string.");
  }
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") {
    throw new Error(`Plugin manifest ${key} must be a string.`);
  }
  return value;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value !== undefined && typeof value !== "string") {
    throw new Error(`Plugin manifest ${key} must be a string when provided.`);
  }
  return value;
}

function requireArray(record: Record<string, unknown>, key: string): readonly unknown[] {
  const value = record[key];
  if (!Array.isArray(value)) {
    throw new Error(`Plugin manifest ${key} must be an array.`);
  }
  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
