import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { PluginLoader, PluginRegistry, validatePluginManifest } from "../dist/index.js";

const validManifest = {
  name: "example.safe-tools",
  version: "0.1.0",
  description: "Safe example plugin.",
  entrypoint: "index.js",
  tools: [{ name: "echo", capability: "demo:echo", permissions: ["demo:echo"] }],
  permissions: ["demo:echo"],
  agentCompatibility: ">=0.0.0 <1.0.0"
};

test("plugin manifest validator rejects invalid manifests", () => {
  assert.throws(() => validatePluginManifest({ ...validManifest, entrypoint: "../index.js" }), /traversal/);
  assert.throws(() => validatePluginManifest({ ...validManifest, tools: [] }), /non-empty/);
});

test("plugin registry rejects duplicate tools", () => {
  const registry = new PluginRegistry();
  const manifest = validatePluginManifest(validManifest);
  const tool = {
    name: "example.safe-tools.echo",
    description: "echo",
    capability: "demo:echo",
    policyEnforced: true,
    async execute() {
      return { ok: true, output: {}, audit: { toolName: "echo", capability: "demo:echo", sideEffect: false } };
    }
  };

  registry.registerPlugin(manifest, [tool]);
  assert.throws(() => registry.registerPlugin({ ...manifest, name: "example.other" }, [tool]), /already registered/);
});

test("plugin loader validates manifest before importing and skips disabled plugins", async () => {
  const root = await mkdtemp(join(tmpdir(), "stride-showcase-plugin-"));
  try {
    const pluginRoot = join(root, "plugin");
    await mkdir(pluginRoot);
    const manifestPath = join(pluginRoot, "plugin.json");
    await writeFile(manifestPath, JSON.stringify(validManifest), "utf8");
    await writeFile(join(pluginRoot, "index.js"), "export default {};", "utf8");
    let imported = false;

    const registry = await new PluginLoader({
      config: {
        enabledPlugins: [],
        pluginPaths: [{ rootDir: pluginRoot, manifestPath }],
        allowedRootDirs: [root],
        agentVersion: "0.1.0"
      },
      importEntrypoint: async () => {
        imported = true;
        return {};
      }
    }).loadEnabledPlugins();

    assert.equal(imported, false);
    assert.equal(registry.listPlugins().length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("plugin loader loads enabled plugin tools through registration context", async () => {
  const root = await mkdtemp(join(tmpdir(), "stride-showcase-plugin-"));
  try {
    const pluginRoot = join(root, "plugin");
    await mkdir(pluginRoot);
    const manifestPath = join(pluginRoot, "plugin.json");
    await writeFile(manifestPath, JSON.stringify(validManifest), "utf8");
    await writeFile(join(pluginRoot, "index.js"), "export default {};", "utf8");

    const registry = await new PluginLoader({
      config: {
        enabledPlugins: ["example.safe-tools"],
        pluginPaths: [{ rootDir: pluginRoot, manifestPath }],
        allowedRootDirs: [root],
        agentVersion: "0.1.0"
      },
      importEntrypoint: async () => ({
        default: {
          register(context) {
            context.registerTool({
              name: "echo",
              description: "echo",
              capability: "demo:echo",
              policyEnforced: true,
              async execute() {
                return { ok: true, output: {}, audit: { toolName: "echo", capability: "demo:echo", sideEffect: false } };
              }
            });
          }
        }
      })
    }).loadEnabledPlugins();

    assert.equal(registry.listPlugins().length, 1);
    assert.equal(registry.getTool("example.safe-tools.echo")?.name, "example.safe-tools.echo");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
