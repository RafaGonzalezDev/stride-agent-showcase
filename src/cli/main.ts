#!/usr/bin/env node
import { createDefaultCliDependencies } from "./composition.js";
import { runCli } from "./runner.js";

const result = await runCli(process.argv.slice(2), createDefaultCliDependencies(process.cwd()));

if (result.stdout.length > 0) {
  process.stdout.write(result.stdout);
}

if (result.stderr.length > 0) {
  process.stderr.write(result.stderr);
}

process.exitCode = result.exitCode;
