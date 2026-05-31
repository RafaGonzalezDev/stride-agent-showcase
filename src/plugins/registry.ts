import type { PluginManifest } from "./types.js";
import type { Tool } from "../tools/index.js";

export class PluginRegistry {
  private readonly plugins = new Map<string, PluginManifest>();
  private readonly tools = new Map<string, Tool>();

  public registerPlugin(manifest: PluginManifest, tools: readonly Tool[]): void {
    if (this.plugins.has(manifest.name)) {
      throw new Error(`Plugin already registered: ${manifest.name}`);
    }

    for (const tool of tools) {
      if (this.tools.has(tool.name)) {
        throw new Error(`Plugin tool already registered: ${tool.name}`);
      }
    }

    this.plugins.set(manifest.name, manifest);
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  public getTool(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  public listTools(): readonly Tool[] {
    return [...this.tools.values()];
  }

  public listPlugins(): readonly PluginManifest[] {
    return [...this.plugins.values()];
  }
}
