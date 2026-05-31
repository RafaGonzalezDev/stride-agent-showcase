#!/usr/bin/env node
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "win32") {
  process.exit(0);
}

const root = fileURLToPath(new URL("..", import.meta.url));
await chmod(join(root, "dist", "cli", "main.js"), 0o755);
