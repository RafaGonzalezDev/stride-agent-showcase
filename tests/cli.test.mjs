import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createDefaultCliDependencies, parseCliArgs, runCli } from "../dist/cli/index.js";

const execFileAsync = promisify(execFile);

test("CLI parser supports print and json", () => {
  const parsed = parseCliArgs(["--print", "list files", "--json"]);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.options.mode, "print");
  assert.equal(parsed.options.json, true);
});

test("CLI runs fake-provider print workflow", async () => {
  const result = await runCli(["--print", "summarize"], createDefaultCliDependencies(process.cwd()));

  assert.equal(result.ok, true);
  assert.match(result.stdout, /fake-provider/);
});

test("CLI returns needs-approval for bash demo in json mode", async () => {
  const result = await runCli(["--print", "try bash", "--json"], createDefaultCliDependencies(process.cwd()));
  const envelope = JSON.parse(result.stdout);

  assert.equal(result.ok, false);
  assert.equal(envelope.status, "needs-approval");
  assert.equal(envelope.error.code, "NEEDS_APPROVAL");
});

test("compiled CLI help works", async () => {
  const result = await execFileAsync(process.execPath, ["dist/cli/main.js", "--help"], { cwd: process.cwd() });

  assert.match(result.stdout, /Usage: stride-showcase/);
  assert.equal(result.stderr, "");
});
