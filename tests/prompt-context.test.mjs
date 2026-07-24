#!/usr/bin/env node
// UserPromptSubmit context tests. Runs the real hook in isolated config directories
// and verifies freshness, privacy, disable switches, structured output, and fail-open behavior.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

import { PROMPT_CONTEXT_MAX_AGE_SEC } from "../lib/quota-context.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const hookPath = join(repoRoot, "hooks", "usage-guard-prompt-context.mjs");
const roots = [];
let pass = 0;
const fail = [];

function check(name, fn) {
  try {
    fn();
    pass++;
  } catch (error) {
    fail.push(`${name}: ${error.message}`);
  }
}

function freshDir() {
  const dir = mkdtempSync(join(tmpdir(), "ug-prompt-context-"));
  roots.push(dir);
  return dir;
}

function writeSnapshot(dir, data) {
  writeFileSync(join(dir, ".usage-guard-limits.json"), JSON.stringify(data), "utf8");
}

function writeConfig(dir, data) {
  writeFileSync(join(dir, "usage-guard.json"), JSON.stringify(data), "utf8");
}

function runHook(dir, prompt = "ordinary prompt") {
  const result = spawnSync(process.execPath, [hookPath], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 5000,
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt }),
    env: { ...process.env, CLAUDE_CONFIG_DIR: dir },
  });
  return {
    status: result.status,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
  };
}

function validSnapshot(nowSec = Math.floor(Date.now() / 1000)) {
  return {
    capturedAt: nowSec,
    fiveHour: { usedPct: 62, resetsAt: nowSec + 2 * 3600 },
    sevenDay: { usedPct: 58, resetsAt: nowSec + 2 * 24 * 3600 },
  };
}

check("missing snapshot: silent and fail-open", () => {
  const result = runHook(freshDir());
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
});

check("malformed snapshot: silent and fail-open", () => {
  const dir = freshDir();
  writeFileSync(join(dir, ".usage-guard-limits.json"), "{broken", "utf8");
  const result = runHook(dir);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
});

check("missing capturedAt: rejected", () => {
  const dir = freshDir();
  const snapshot = validSnapshot();
  delete snapshot.capturedAt;
  writeSnapshot(dir, snapshot);
  assert.equal(runHook(dir).stdout, "");
});

check("snapshot older than 15 minutes: rejected", () => {
  const dir = freshDir();
  const nowSec = Math.floor(Date.now() / 1000);
  writeSnapshot(dir, validSnapshot(nowSec - PROMPT_CONTEXT_MAX_AGE_SEC - 5));
  assert.equal(runHook(dir).stdout, "");
});

check("snapshot more than 60 seconds in the future: rejected", () => {
  const dir = freshDir();
  const nowSec = Math.floor(Date.now() / 1000);
  // Keep a full minute beyond the boundary so process startup cannot erase the test condition.
  writeSnapshot(dir, validSnapshot(nowSec + 120));
  assert.equal(runHook(dir).stdout, "");
});

check("quiet mode: context disabled", () => {
  const dir = freshDir();
  writeSnapshot(dir, validSnapshot());
  writeConfig(dir, { quiet: true });
  assert.equal(runHook(dir).stdout, "");
});

check("promptContext false: context disabled", () => {
  const dir = freshDir();
  writeSnapshot(dir, validSnapshot());
  writeConfig(dir, { promptContext: false });
  assert.equal(runHook(dir).stdout, "");
});

check("fresh dual-window snapshot: emits structured UserPromptSubmit context", () => {
  const dir = freshDir();
  writeSnapshot(dir, validSnapshot());
  const result = runHook(dir);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const output = JSON.parse(result.stdout);
  assert.equal(output.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  const context = output.hookSpecificOutput.additionalContext;
  assert.match(context, /5h 62% used/);
  assert.match(context, /weekly 58% used/);
  assert.match(context, /Budget reasoning depth and new subagents/);
  assert.match(context, /never trade away correctness, safety, or user intent/);
});

check("prompt privacy: submitted text is never echoed", () => {
  const dir = freshDir();
  writeSnapshot(dir, validSnapshot());
  const secret = "DO-NOT-ECHO-secret-9472";
  const result = runHook(dir, secret);
  assert.ok(result.stdout.length > 0);
  assert.ok(!result.stdout.includes(secret));
});

check("single available quota window: still emits useful context", () => {
  const dir = freshDir();
  const nowSec = Math.floor(Date.now() / 1000);
  writeSnapshot(dir, {
    capturedAt: nowSec,
    sevenDay: { usedPct: 73, resetsAt: nowSec + 24 * 3600 },
  });
  const output = JSON.parse(runHook(dir).stdout);
  const context = output.hookSpecificOutput.additionalContext;
  assert.match(context, /weekly 73% used/);
  assert.ok(!context.includes("5h"));
});

for (const dir of roots) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
}

const total = pass + fail.length;
if (fail.length) {
  console.error(`usage-guard prompt context tests: ${pass} passed, ${fail.length} FAILED`);
  for (const message of fail) console.error("  x " + message);
  process.exit(1);
}

console.log(`usage-guard prompt context tests: ${pass}/${total} checks passed.`);
