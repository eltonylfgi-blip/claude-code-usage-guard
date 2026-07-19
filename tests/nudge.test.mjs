#!/usr/bin/env node
// usage-guard — activation-nudge tests. Zero dependencies (node:assert only).
// Runs the REAL Stop hook against throwaway temp config dirs and pins the one-time
// "installed but not active yet" nudge behavior shipped in 56ed63a. Run: npm test
// (wired after selftest.mjs and reset-coach.test.mjs). Never touches your real ~/.claude.

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

let pass = 0;
const fail = [];
function check(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail.push(`${name}: ${e.message}`);
  }
}

const roots = [];
function freshDir() {
  const d = mkdtempSync(join(tmpdir(), "ug-nudge-"));
  roots.push(d);
  return d;
}
// Run the Stop hook with an isolated CLAUDE_CONFIG_DIR; return trimmed stdout.
function runHook(dir) {
  try {
    return execSync("node hooks/usage-guard-hook.mjs", {
      encoding: "utf8",
      timeout: 5000,
      env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
    }).trim();
  } catch (e) {
    return (e.stdout ?? "").trim();
  }
}
const NUDGE = "installed but not active";

// 1. A fresh silent install (no real-quota snapshot, no fallback budget/rate) shows the nudge.
check("nudge: fires on a fresh silent install", () => {
  const out = runHook(freshDir());
  assert.ok(out.includes(NUDGE), "expected the activation nudge, got: " + JSON.stringify(out));
});

// 2. It never repeats — the state flag remembers it was shown.
check("nudge: does not repeat on the second run", () => {
  const d = freshDir();
  runHook(d); // first: shows
  const out2 = runHook(d); // second: must be silent
  assert.equal(out2, "", "nudge must not repeat, got: " + JSON.stringify(out2));
});

// 3. It never fires when a real-quota snapshot exists (below warn threshold -> just silent).
check("nudge: silent when a real-quota snapshot is present", () => {
  const d = freshDir();
  const nowSec = Math.floor(Date.now() / 1000);
  writeFileSync(
    join(d, ".usage-guard-limits.json"),
    JSON.stringify({
      capturedAt: nowSec,
      fiveHour: { usedPct: 40, resetsAt: nowSec + 3600 },
      sevenDay: { usedPct: 30, resetsAt: nowSec + 7 * 24 * 3600 },
    }),
    "utf8"
  );
  const out = runHook(d);
  assert.equal(out, "", "must stay silent when real quota is present, got: " + JSON.stringify(out));
});

// 4. It never fires when a fallback budget is configured.
check("nudge: silent when a fallback budget is set", () => {
  const d = freshDir();
  writeFileSync(join(d, "usage-guard.json"), JSON.stringify({ weightBudget: 8_000_000 }), "utf8");
  const out = runHook(d);
  assert.equal(out, "", "must stay silent when a fallback budget is set, got: " + JSON.stringify(out));
});

for (const r of roots) {
  try {
    rmSync(r, { recursive: true, force: true });
  } catch {}
}

if (fail.length) {
  console.error(`usage-guard nudge tests: ${pass} passed, ${fail.length} FAILED`);
  for (const f of fail) console.error("  x " + f);
  process.exit(1);
}
console.log(`usage-guard nudge tests: ${pass}/${pass} checks passed.`);
