import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import type { PluginEntrypoint, PluginLoaderConfig, PluginRegistrationContext, PluginToolManifest } from "./types.js";
import { normalizePluginToolName, validateEntrypoint, validatePluginManifest } from "./manifest.js";
import { PluginRegistry } from "./registry.js";
import type { Tool } from "../tools/index.js";

export interface PluginLoaderOptions {
  readonly config: PluginLoaderConfig;
  readonly registry?: PluginRegistry;
  readonly importEntrypoint?: (entrypointUrl: string) => Promise<unknown>;
}

export class PluginLoader {
  private readonly config: PluginLoaderConfig;
  private readonly registry: PluginRegistry;
  private readonly importEntrypoint: (entrypointUrl: string) => Promise<unknown>;

  public constructor(options: PluginLoaderOptions) {
    this.config = options.config;
    this.registry = options.registry ?? new PluginRegistry();
    this.importEntrypoint = options.importEntrypoint ?? ((entrypointUrl) => import(entrypointUrl));
  }

  public async loadEnabledPlugins(): Promise<PluginRegistry> {
    const enabledPlugins = new Set(this.config.enabledPlugins);
    const allowedRoots = await Promise.all(this.config.allowedRootDirs.map((root) => realpath(root)));

    if (allowedRoots.length === 0) {
      throw new Error("Plugin loader requires at least one allowed root directory.");
    }

    for (const pluginPath of this.config.pluginPaths) {
      const rootDir = await realpath(pluginPath.rootDir);
      const manifestPath = await realpath(pluginPath.manifestPath);

      if (!isPathUnderAnyRoot(rootDir, allowedRoots) || !isPathUnderRoot(manifestPath, rootDir)) {
        throw new Error("Plugin paths must stay under configured allowed roots.");
      }

      const manifest = validatePluginManifest(JSON.parse(await readFile(manifestPath, "utf8")));
      if (!enabledPlugins.has(manifest.name)) {
        continue;
      }

      assertAgentCompatible(manifest.agentCompatibility, this.config.agentVersion ?? "0.0.0");
      const entrypointPath = await resolveEntrypointPath(rootDir, manifest.entrypoint);
      const tools: Tool[] = [];
      const declaredTools = new Map(manifest.tools.map((tool) => [tool.name, tool]));
      const context: PluginRegistrationContext = {
        registerTool(tool: Tool): void {
          validateRegisteredTool(tool, manifest.name);
          const namespacedName = normalizePluginToolName(manifest.name, tool.name);
          const declaredTool = declaredTools.get(namespacedName);
          if (declaredTool === undefined) {
            throw new Error(`Plugin registered undeclared tool: ${namespacedName}.`);
          }
          validateRegisteredToolCapability(tool, declaredTool, manifest.permissions);
          tools.push({ ...tool, name: namespacedName });
        }
      };

      const module = await this.importEntrypoint(pathToFileURL(entrypointPath).href);
      const entrypoint = readEntrypoint(module);
      await entrypoint.register(context);
      this.registry.registerPlugin(manifest, tools);
    }

    return this.registry;
  }
}

async function resolveEntrypointPath(rootDir: string, entrypoint: string): Promise<string> {
  validateEntrypoint(entrypoint);
  const entrypointPath = await realpath(join(rootDir, entrypoint));
  if (!isPathUnderRoot(entrypointPath, rootDir)) {
    throw new Error("Plugin entrypoint must resolve under the plugin rootDir.");
  }
  return entrypointPath;
}

function validateRegisteredTool(tool: Tool, pluginName: string): void {
  if (typeof tool.name !== "string" || tool.name.length === 0) {
    throw new Error(`Plugin registered tool name must be a string: ${pluginName}.`);
  }
  if (typeof tool.description !== "string") {
    throw new Error(`Plugin registered tool description must be a string: ${tool.name}.`);
  }
  if (typeof tool.capability !== "string") {
    throw new Error(`Plugin registered tool capability must be a string: ${tool.name}.`);
  }
  if (tool.policyEnforced !== true || typeof tool.execute !== "function") {
    throw new Error(`Plugin registered tool must be executable and policy-enforced: ${tool.name}.`);
  }
}

function validateRegisteredToolCapability(tool: Tool, declaredTool: PluginToolManifest, manifestPermissions: readonly string[]): void {
  if (tool.capability !== declaredTool.capability) {
    throw new Error(`Plugin registered tool capability does not match manifest declaration: ${tool.name}.`);
  }

  const permissions = new Set([...(declaredTool.permissions ?? []), ...manifestPermissions]);
  if (!permissions.has(tool.capability)) {
    throw new Error(`Plugin registered tool capability is not covered by declared permissions: ${tool.name}.`);
  }
}

function assertAgentCompatible(range: string, agentVersion: string): void {
  if (range === "*") {
    return;
  }
  if (range.startsWith(">=")) {
    const [minimum = "0.0.0", maximum] = range.slice(2).split(/\s+<\s*/);
    if (compareSemver(agentVersion, minimum) >= 0 && (maximum === undefined || compareSemver(agentVersion, maximum) < 0)) {
      return;
    }
  } else if (range.startsWith("^")) {
    const base = range.slice(1);
    if (compareSemver(agentVersion, base) >= 0 && semverParts(agentVersion)[0] === semverParts(base)[0]) {
      return;
    }
  } else if (compareSemver(agentVersion, range) === 0) {
    return;
  }

  throw new Error(`Plugin agentCompatibility ${range} is incompatible with agent version ${agentVersion}.`);
}

function compareSemver(left: string, right: string): number {
  const leftParts = semverParts(left);
  const rightParts = semverParts(right);
  for (const index of [0, 1, 2] as const) {
    const delta = leftParts[index] - rightParts[index];
    if (delta !== 0) {
      return delta > 0 ? 1 : -1;
    }
  }
  return 0;
}

function semverParts(version: string): readonly [number, number, number] {
  const [major = "0", minor = "0", patch = "0"] = version.split(/[+-]/, 1)[0]!.split(".");
  return [Number(major), Number(minor), Number(patch)];
}

function readEntrypoint(module: unknown): PluginEntrypoint {
  const candidate = readExport(module, "default") ?? module;
  if (typeof candidate !== "object" || candidate === null || typeof (candidate as { register?: unknown }).register !== "function") {
    throw new Error("Plugin entrypoint must export a register(context) function.");
  }
  return candidate as PluginEntrypoint;
}

function readExport(module: unknown, key: string): unknown {
  return typeof module === "object" && module !== null ? (module as Record<string, unknown>)[key] : undefined;
}

function isPathUnderAnyRoot(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => isPathUnderRoot(path, root));
}

function isPathUnderRoot(path: string, root: string): boolean {
  const relativePath = relative(root, path);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}
