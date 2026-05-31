import type { Tool } from "../tools/index.js";

export type PluginPermission = string;

export interface PluginToolManifest {
  readonly name: string;
  readonly description?: string;
  readonly capability: PluginPermission;
  readonly permissions?: readonly PluginPermission[];
}

export interface NormalizedPluginToolManifest extends PluginToolManifest {
  readonly localName: string;
  readonly namespacedName: string;
}

export interface PluginManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly entrypoint: string;
  readonly tools: readonly NormalizedPluginToolManifest[];
  readonly permissions: readonly PluginPermission[];
  readonly agentCompatibility: string;
}

export interface PluginRegistrationContext {
  registerTool(tool: Tool): void;
}

export interface PluginEntrypoint {
  register(context: PluginRegistrationContext): void | Promise<void>;
}

export interface PluginPathConfig {
  readonly rootDir: string;
  readonly manifestPath: string;
}

export interface PluginLoaderConfig {
  readonly enabledPlugins: readonly string[];
  readonly pluginPaths: readonly PluginPathConfig[];
  readonly allowedRootDirs: readonly string[];
  readonly agentVersion?: string;
}
