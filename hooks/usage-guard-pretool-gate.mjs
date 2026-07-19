#!/usr/bin/env node
// Optional Claude Code PreToolUse gate for Agent|Workflow spawns.
// Reuses usage-guard-check.mjs and emits a blocking hook decision only when
// the configured quota threshold is reached. Missing/stale quota fails open.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const checkPath = fileURLToPath(new URL("./usage-guard-check.mjs", import.meta.url));
const args = [checkPath, ...process.argv.slice(2), "--quiet"];
const result = spawnSync(process.execPath, args, {
  encoding: "utf8",
  env: process.env,
  timeout: 5000,
  windowsHide: true
});

if (result.status === 1) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Usage guard: quota threshold reached; pause this spawn."
    }
  }));
}

// Hook commands communicate the decision through JSON. Always exit cleanly so
// a missing runtime, stale snapshot, or internal checker error remains fail-open.
process.exit(0);
