import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  BashCommandPolicy,
  BashTool,
  EditTool,
  ListTool,
  PolicyGate,
  ReadTool,
  SearchTool,
  ToolRegistry,
  WriteTool
} from "../dist/index.js";

function allowGate() {
  return new PolicyGate({
    rules: [
      {
        id: "allow-all",
        decision: "allow",
        source: "global",
        scope: "tool",
        reason: "Test allow."
      }
    ]
  });
}

function askGate() {
  return new PolicyGate();
}

function denyGate() {
  return new PolicyGate({
    rules: [
      {
        id: "deny-all",
        decision: "deny",
        source: "global",
        scope: "tool",
        reason: "Test deny."
      }
    ]
  });
}

async function withWorkspace(callback) {
  const root = await mkdtemp(join(tmpdir(), "stride-showcase-tools-"));
  try {
    await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("list returns workspace entries without shell execution", async () => {
  await withWorkspace(async (workspace) => {
    await mkdir(join(workspace, "src"));
    await writeFile(join(workspace, "src", "index.ts"), "export {};\n", "utf8");
    await writeFile(join(workspace, ".env"), "SECRET=value\n", "utf8");

    const result = await new ListTool().execute({ path: "." }, { workspaceRoot: workspace, policyGate: allowGate() });

    assert.equal(result.ok, true);
    assert.deepEqual(result.output.entries, [
      { path: "src", type: "directory" },
      { path: "src/index.ts", type: "file" }
    ]);
    assert.deepEqual(result.output.skipped, [{ path: ".env", reason: "sensitive-file" }]);
  });
});

test("read blocks path traversal and symlink escapes", async () => {
  const outside = await mkdtemp(join(tmpdir(), "stride-showcase-outside-"));
  try {
    await writeFile(join(outside, "secret.txt"), "private", "utf8");
    await withWorkspace(async (workspace) => {
      const traversal = await new ReadTool().execute(
        { path: join(outside, "secret.txt") },
        { workspaceRoot: workspace, policyGate: allowGate() }
      );
      assert.equal(traversal.ok, false);
      assert.equal(traversal.code, "outside-workspace");

      await symlink(join(outside, "secret.txt"), join(workspace, "linked-secret.txt"));
      const symlinkResult = await new ReadTool().execute(
        { path: "linked-secret.txt" },
        { workspaceRoot: workspace, policyGate: allowGate() }
      );
      assert.equal(symlinkResult.ok, false);
      assert.equal(symlinkResult.code, "outside-workspace");
    });
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test("read requires policy allow before exposing content", async () => {
  await withWorkspace(async (workspace) => {
    await writeFile(join(workspace, "file.txt"), "visible", "utf8");

    const asked = await new ReadTool().execute({ path: "file.txt" }, { workspaceRoot: workspace, policyGate: askGate() });
    assert.equal(asked.ok, false);
    assert.equal(asked.code, "policy-required");
    assert.equal("output" in asked, false);

    const denied = await new ReadTool().execute({ path: "file.txt" }, { workspaceRoot: workspace, policyGate: denyGate() });
    assert.equal(denied.ok, false);
    assert.equal(denied.code, "policy-denied");
  });
});

test("read and search redact secret-like content", async () => {
  await withWorkspace(async (workspace) => {
    await writeFile(join(workspace, ".env.example"), "API_TOKEN=example-secret\nplain", "utf8");
    await writeFile(join(workspace, "app.txt"), "API_TOKEN=runtime-secret\nplain", "utf8");

    const read = await new ReadTool().execute({ path: ".env.example" }, { workspaceRoot: workspace, policyGate: allowGate() });
    assert.equal(read.ok, true);
    assert.match(read.output.content, /API_TOKEN=<redacted>/);
    assert.equal(read.output.redacted, true);

    const search = await new SearchTool().execute({ query: "API_TOKEN" }, { workspaceRoot: workspace, policyGate: allowGate() });
    assert.equal(search.ok, true);
    assert.equal(search.output.redacted, true);
    assert.match(search.output.matches[0].text, /API_TOKEN=<redacted>/);
  });
});

test("write and edit require allow before side effects", async () => {
  await withWorkspace(async (workspace) => {
    const askWrite = await new WriteTool().execute(
      { path: "file.txt", content: "new" },
      { workspaceRoot: workspace, policyGate: askGate() }
    );
    assert.equal(askWrite.ok, false);
    assert.equal(askWrite.code, "policy-required");

    await assert.rejects(readFile(join(workspace, "file.txt"), "utf8"));

    await writeFile(join(workspace, "file.txt"), "old", "utf8");
    const denyEdit = await new EditTool().execute(
      { path: "file.txt", oldText: "old", newText: "new" },
      { workspaceRoot: workspace, policyGate: denyGate() }
    );
    assert.equal(denyEdit.ok, false);
    assert.equal(denyEdit.code, "policy-denied");
    assert.equal(await readFile(join(workspace, "file.txt"), "utf8"), "old");
  });
});

test("write and edit return redacted diffs", async () => {
  await withWorkspace(async (workspace) => {
    const write = await new WriteTool().execute(
      { path: "file.txt", content: "API_TOKEN=new-secret" },
      { workspaceRoot: workspace, policyGate: allowGate() }
    );
    assert.equal(write.ok, true);
    assert.equal(write.output.redacted, true);
    assert.match(write.output.diff, /API_TOKEN=<redacted>/);

    const edit = await new EditTool().execute(
      { path: "file.txt", oldText: "API_TOKEN=new-secret", newText: "API_TOKEN=edited-secret" },
      { workspaceRoot: workspace, policyGate: allowGate() }
    );
    assert.equal(edit.ok, true);
    assert.equal(edit.output.redacted, true);
    assert.match(edit.output.diff, /API_TOKEN=<redacted>/);
    assert.equal(await readFile(join(workspace, "file.txt"), "utf8"), "API_TOKEN=edited-secret");
  });
});

test("tool registry rejects duplicate tool names", () => {
  const registry = new ToolRegistry();
  const tool = new ReadTool();

  registry.register(tool);
  assert.throws(() => registry.register(tool), /already registered/);
});

test("bash ask and deny decisions do not invoke executor", async () => {
  await withWorkspace(async (workspace) => {
    let executions = 0;
    const executor = {
      async execute() {
        executions += 1;
        throw new Error("should not execute");
      }
    };

    const ask = await new BashTool(executor).execute(
      { command: "echo safe" },
      { workspaceRoot: workspace, policyGate: askGate() }
    );
    assert.equal(ask.ok, false);
    assert.equal(ask.code, "policy-required");

    const denied = await new BashTool(executor).execute(
      { command: "echo safe" },
      { workspaceRoot: workspace, policyGate: denyGate() }
    );
    assert.equal(denied.ok, false);
    assert.equal(denied.code, "policy-denied");
    assert.equal(executions, 0);
  });
});

test("bash blocks compound commands with generic allow policy", async () => {
  await withWorkspace(async (workspace) => {
    let executions = 0;
    const executor = {
      async execute() {
        executions += 1;
        return {
          command: "echo should-not-run",
          exitCode: 0,
          signal: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          truncated: false,
          redacted: false
        };
      }
    };
    const policyGate = new PolicyGate({
      rules: [
        {
          id: "allow-echo",
          decision: "allow",
          source: "global",
          scope: "command",
          reason: "Allow echo.",
          target: { kind: "glob", value: "echo *" }
        }
      ]
    });

    const result = await new BashTool(executor).execute(
      { command: "echo safe && echo unsafe" },
      { workspaceRoot: workspace, policyGate }
    );

    assert.equal(result.ok, false);
    assert.equal(result.code, "policy-denied");
    assert.equal(executions, 0);
  });
});

test("bash executes explicitly allowed compound commands and redacts output", async () => {
  await withWorkspace(async (workspace) => {
    const executor = {
      async execute(request) {
        assert.equal(request.timeoutMs, 1234);
        assert.equal(request.maxOutputBytes, 20);
        return {
          command: request.command,
          exitCode: 0,
          signal: null,
          stdout: "API_TOKEN=runtime-secret",
          stderr: "",
          timedOut: false,
          truncated: false,
          redacted: false
        };
      }
    };
    const policyGate = new BashCommandPolicy({
      rules: [
        {
          id: "allow-compound",
          decision: "allow",
          source: "explicit",
          reason: "Explicit test allow.",
          command: { kind: "exact", value: "echo safe && echo done" },
          allowCompound: true
        }
      ]
    });

    const result = await new BashTool(executor).execute(
      { command: "echo safe && echo done", timeoutMs: 1234, maxOutputBytes: 20 },
      { workspaceRoot: workspace, policyGate }
    );

    assert.equal(result.ok, true);
    assert.equal(result.output.redacted, true);
    assert.match(result.output.stdout, /API_TOKEN=<redacted>/);
  });
});
