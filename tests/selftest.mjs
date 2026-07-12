#!/usr/bin/env node
// usage-guard — self-test. Zero dependencies (node:assert + node:fs only).
// Each check backs a specific claim made in the README / ENGINEERING_PRINCIPLES:
// the weighting formula, the anti-inflation dedup, fail-open parsing, the burn-rate
// guard, real-quota clamping/staleness, and config clamping. Run: npm test
//
// Uses only the public exports of lib/engine.mjs and lib/config.mjs against
// throwaway fixtures under the OS temp dir, so it never touches your real ~/.claude.

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";

import { weigh, collect, summarize, readLimits, limitsPath, pace, paceTag, WINDOW_SEC } from "../lib/engine.mjs";
import { loadConfig, DEFAULTS } from "../lib/config.mjs";

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

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const tmpRoots = [];
function freshConfigDir() {
  const d = mkdtempSync(join(tmpdir(), "ug-test-"));
  tmpRoots.push(d);
  return d;
}
// Build a transcripts dir with one .jsonl file holding the given raw lines.
function transcriptsDir(lines) {
  const root = freshConfigDir();
  const proj = join(root, "projects", "demo");
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, "session.jsonl"), lines.join("\n") + "\n", "utf8");
  return join(root, "projects");
}
const turn = (o) =>
  JSON.stringify({
    type: "assistant",
    timestamp: o.ts,
    requestId: o.requestId,
    sessionId: o.sessionId || "s1",
    message: { model: o.model || "claude-opus-4-8", usage: o.usage },
  });

// 1. weigh(): cache_read counts at 0.1, everything else at face value.
check("weigh: documented weighting formula", () => {
  const w = weigh({ input_tokens: 100, output_tokens: 200, cache_creation_input_tokens: 50, cache_read_input_tokens: 1000 });
  assert.equal(w, 100 + 200 + 50 + 1000 * 0.1); // 450
});

// 2. collect(): duplicate streaming frames (same requestId) collapse to ONE row.
//    This is the anti-2-4x-inflation claim — the load-bearing correctness property.
check("collect: dedupes streaming frames by requestId", () => {
  const usage = { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const dir = transcriptsDir([
    turn({ ts: iso(60_000), requestId: "req1", usage }),
    turn({ ts: iso(50_000), requestId: "req1", usage }), // same request, later frame
    turn({ ts: iso(40_000), requestId: "req2", usage }),
  ]);
  const events = collect({ sinceMs: Date.now() - 3600_000, dir });
  assert.equal(events.length, 2, "expected 2 unique requests, got " + events.length);
});

// 3. collect(): corrupt / partial / non-assistant lines are skipped, never crash (fail-open).
check("collect: skips corrupt lines without throwing", () => {
  const usage = { input_tokens: 5, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const dir = transcriptsDir([
    "this is not json",
    '{"partial": ',
    JSON.stringify({ type: "user", message: { content: "hi" } }),
    turn({ ts: iso(10_000), requestId: "reqOK", usage }),
  ]);
  const events = collect({ sinceMs: Date.now() - 3600_000, dir });
  assert.equal(events.length, 1, "only the one valid assistant turn should survive");
});

// 4. collect(): events older than the window are excluded.
check("collect: respects the sinceMs window", () => {
  const usage = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  const dir = transcriptsDir([
    turn({ ts: iso(3 * 3600_000), requestId: "old", usage }), // 3h ago
    turn({ ts: iso(1 * 3600_000), requestId: "new", usage }), // 1h ago
  ]);
  const events = collect({ sinceMs: Date.now() - 2 * 3600_000, dir }); // last 2h
  assert.equal(events.length, 1);
  assert.equal(events[0].requestId, "new");
});

// 5. summarize(): burn rate is suppressed for spans under 10 minutes (anti over-report guard).
check("summarize: burn rate guarded on short spans", () => {
  const mk = (tsAgo) => ({ ts: Date.now() - tsAgo, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, weight: 1000, sessionId: "s", model: "m" });
  const short = summarize([mk(5 * 60_000), mk(0)]); // 5 min span
  assert.equal(short.weightPerHour, 0, "sub-10-min span must not annualize");
  const long = summarize([mk(30 * 60_000), mk(0)]); // 30 min span
  assert.ok(long.weightPerHour > 0, "30-min span should produce a burn rate");
});

// 6. summarize(): totals and per-model weights roll up.
check("summarize: rolls up totals and per-model weight", () => {
  const s = summarize([
    { ts: 1, input: 10, output: 20, cacheCreate: 0, cacheRead: 0, weight: 30, sessionId: "a", model: "opus" },
    { ts: 2, input: 5, output: 5, cacheCreate: 0, cacheRead: 0, weight: 10, sessionId: "a", model: "haiku" },
  ]);
  assert.equal(s.turns, 2);
  assert.equal(s.input, 15);
  assert.equal(s.weight, 40);
  assert.equal(s.sessions, 1);
  assert.equal(s.models.opus, 30);
});

// 7. readLimits(): missing snapshot file -> null (fail-open to the weighted proxy).
check("readLimits: missing file returns null", () => {
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = freshConfigDir(); // empty
  try {
    assert.equal(readLimits(), null);
  } finally {
    process.env.CLAUDE_CONFIG_DIR = prev;
  }
});

// 8. readLimits(): a valid fresh snapshot is parsed and usedPct is clamped to 0..100.
check("readLimits: parses fresh snapshot and clamps usedPct", () => {
  const prev = process.env.CLAUDE_CONFIG_DIR;
  const dir = freshConfigDir();
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    writeFileSync(
      limitsPath(),
      JSON.stringify({ capturedAt: nowSec, fiveHour: { usedPct: 150 }, sevenDay: { usedPct: -5 } }),
      "utf8"
    );
    const lim = readLimits();
    assert.ok(lim, "expected a parsed object");
    assert.equal(lim.fiveHour.usedPct, 100, "150 must clamp to 100");
    assert.equal(lim.sevenDay.usedPct, 0, "-5 must clamp to 0");
  } finally {
    process.env.CLAUDE_CONFIG_DIR = prev;
  }
});

// 9. readLimits(): a stale snapshot (older than maxAge) -> null.
check("readLimits: stale snapshot returns null", () => {
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = freshConfigDir();
  try {
    const staleSec = Math.floor(Date.now() / 1000) - 7 * 3600; // 7h old, default maxAge 6h
    writeFileSync(limitsPath(), JSON.stringify({ capturedAt: staleSec, fiveHour: { usedPct: 50 } }), "utf8");
    assert.equal(readLimits(), null);
  } finally {
    process.env.CLAUDE_CONFIG_DIR = prev;
  }
});

// 10. loadConfig(): no file -> pure defaults.
check("loadConfig: no file yields defaults", () => {
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = freshConfigDir();
  try {
    const cfg = loadConfig();
    assert.equal(cfg.windowHours, DEFAULTS.windowHours);
    assert.equal(cfg.planWarnPct, DEFAULTS.planWarnPct);
  } finally {
    process.env.CLAUDE_CONFIG_DIR = prev;
  }
});

// 11. loadConfig(): bad values are clamped so a typo can't break the hook.
check("loadConfig: clamps bad values", () => {
  const prev = process.env.CLAUDE_CONFIG_DIR;
  const dir = freshConfigDir();
  process.env.CLAUDE_CONFIG_DIR = dir;
  try {
    writeFileSync(join(dir, "usage-guard.json"), JSON.stringify({ warnPct: 5, weightBudget: -100, throttleMinutes: -3 }), "utf8");
    const cfg = loadConfig();
    assert.equal(cfg.warnPct, DEFAULTS.warnPct, "out-of-range warnPct falls back to default");
    assert.equal(cfg.weightBudget, 0, "negative budget clamps to 0");
    assert.equal(cfg.throttleMinutes, DEFAULTS.throttleMinutes, "negative throttle falls back to default");
  } finally {
    process.env.CLAUDE_CONFIG_DIR = prev;
  }
});

// ---- pace: even-pace math (backs the "should I slow down or push?" readout) ----
check("pace: ahead of even split is flagged with the right delta", () => {
  // weekly window, half elapsed (reset in 3.5d), 68% used -> expected 50%, delta +18
  const now = 1_000_000_000;
  const p = pace(68, now + 3.5 * 24 * 3600, WINDOW_SEC.sevenDay, now);
  assert.ok(p, "pace computable");
  assert.equal(Math.round(p.expectedPct), 50);
  assert.equal(Math.round(p.deltaPct), 18);
  assert.ok(paceTag(p).includes("ahead"), "tag says ahead / slow down");
});
check("pace: under even split says there is room to push", () => {
  const now = 1_000_000_000;
  // 5h window, 80% elapsed (resets in 1h), only 40% used -> expected 80%, delta -40
  const p = pace(40, now + 3600, WINDOW_SEC.fiveHour, now);
  assert.equal(Math.round(p.expectedPct), 80);
  assert.ok(paceTag(p).includes("under"), "tag says under / room to push");
});
check("pace: within ±5% reads as on pace", () => {
  const now = 1_000_000_000;
  const p = pace(52, now + 3.5 * 24 * 3600, WINDOW_SEC.sevenDay, now); // expected 50, delta +2
  assert.equal(paceTag(p), "on pace");
});
check("pace: returns null when it cannot be honest (no reset, past reset, misaligned)", () => {
  const now = 1_000_000_000;
  assert.equal(pace(50, NaN, WINDOW_SEC.sevenDay, now), null, "no reset timestamp");
  assert.equal(pace(50, now - 10, WINDOW_SEC.sevenDay, now), null, "reset already past");
  assert.equal(pace(50, now + 10 * 24 * 3600, WINDOW_SEC.sevenDay, now), null, "reset beyond window");
  assert.equal(paceTag(null), "", "null pace renders as empty string");
});

// ---- usage-guard-check.mjs ------------------------------------------------
// Run the CLI gate script with a temp CLAUDE_CONFIG_DIR.
function runCheck(args, { CLAUDE_CONFIG_DIR } = {}) {
  const env = { ...process.env };
  if (CLAUDE_CONFIG_DIR) env.CLAUDE_CONFIG_DIR = CLAUDE_CONFIG_DIR;
  try {
    const out = execSync(`node hooks/usage-guard-check.mjs ${args}`, { encoding: "utf8", env, timeout: 5000 });
    return { code: 0, out: out.trim() };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").trim() };
  }
}

// 12. usage-guard-check.mjs: missing file -> exit 0, prints fail-open line
check("check: missing file -> exit 0 + fail-open line", () => {
  const dir = freshConfigDir();
  const r = runCheck("", { CLAUDE_CONFIG_DIR: dir });
  assert.equal(r.code, 0);
  assert.ok(r.out.includes("no quota data (fail-open)"));
});

// 13. usage-guard-check.mjs: fresh data under thresholds -> exit 0
check("check: fresh data under threshold -> exit 0", () => {
  const dir = freshConfigDir();
  const nowSec = Math.floor(Date.now() / 1000);
  writeFileSync(join(dir, ".usage-guard-limits.json"), JSON.stringify({
    capturedAt: nowSec,
    fiveHour: { usedPct: 50, resetsAt: nowSec + 3600 },
    sevenDay: { usedPct: 40, resetsAt: nowSec + 7 * 24 * 3600 }
  }), "utf8");
  const r = runCheck("--max-weekly 85 --max-5h 85", { CLAUDE_CONFIG_DIR: dir });
  assert.equal(r.code, 0);
  assert.equal(r.out, "");
});

// 14. usage-guard-check.mjs: fresh data over weekly threshold -> exit 1 + line
check("check: fresh data over weekly threshold -> exit 1 + reason line", () => {
  const dir = freshConfigDir();
  const nowSec = Math.floor(Date.now() / 1000);
  writeFileSync(join(dir, ".usage-guard-limits.json"), JSON.stringify({
    capturedAt: nowSec,
    sevenDay: { usedPct: 90, resetsAt: nowSec + 7 * 24 * 3600 }
  }), "utf8");
  const r = runCheck("--max-weekly 85", { CLAUDE_CONFIG_DIR: dir });
  assert.equal(r.code, 1);
  assert.ok(r.out.includes("weekly") && r.out.includes("90"));
});

// 15. usage-guard-check.mjs: fresh data over 5h threshold -> exit 1 + line
check("check: fresh data over 5h threshold -> exit 1 + reason line", () => {
  const dir = freshConfigDir();
  const nowSec = Math.floor(Date.now() / 1000);
  writeFileSync(join(dir, ".usage-guard-limits.json"), JSON.stringify({
    capturedAt: nowSec,
    fiveHour: { usedPct: 95, resetsAt: nowSec + 3600 }
  }), "utf8");
  const r = runCheck("--max-5h 85", { CLAUDE_CONFIG_DIR: dir });
  assert.equal(r.code, 1);
  assert.ok(r.out.includes("5h") && r.out.includes("95"));
});

// 16. usage-guard-check.mjs: stale data -> fail-open (exit 0 + line)
check("check: stale snapshot -> exit 0 + fail-open line", () => {
  const dir = freshConfigDir();
  const staleSec = Math.floor(Date.now() / 1000) - 25 * 3600; // 25h old, default max-age 24h
  writeFileSync(join(dir, ".usage-guard-limits.json"), JSON.stringify({
    capturedAt: staleSec,
    fiveHour: { usedPct: 99, resetsAt: Math.floor(Date.now() / 1000) + 3600 }
  }), "utf8");
  const r = runCheck("--max-5h 85", { CLAUDE_CONFIG_DIR: dir });
  assert.equal(r.code, 0);
  assert.ok(r.out.includes("no quota data (fail-open)"));
});

// 17. usage-guard-check.mjs: --quiet suppresses output on exit 1
check("check: --quiet suppresses output on exit 1", () => {
  const dir = freshConfigDir();
  const nowSec = Math.floor(Date.now() / 1000);
  writeFileSync(join(dir, ".usage-guard-limits.json"), JSON.stringify({
    capturedAt: nowSec,
    sevenDay: { usedPct: 90, resetsAt: nowSec + 7 * 24 * 3600 }
  }), "utf8");
  const r = runCheck("--max-weekly 85 --quiet", { CLAUDE_CONFIG_DIR: dir });
  assert.equal(r.code, 1);
  assert.equal(r.out, "");
});

// 17b. usage-guard-check.mjs: malformed flag value must NOT disable the gate
check("check: malformed --max-weekly keeps the default (gate still stops)", () => {
  const dir = freshConfigDir();
  const nowSec = Math.floor(Date.now() / 1000);
  writeFileSync(join(dir, ".usage-guard-limits.json"), JSON.stringify({
    capturedAt: nowSec,
    sevenDay: { usedPct: 90, resetsAt: nowSec + 7 * 24 * 3600 }
  }), "utf8");
  const r = runCheck("--max-weekly abc", { CLAUDE_CONFIG_DIR: dir }); // typo -> default 85 applies
  assert.equal(r.code, 1);
  assert.ok(r.out.includes("weekly") && r.out.includes("90"));
});

// ---- usage-guard-sessionstart.mjs -----------------------------------------
function runSessionStart({ CLAUDE_CONFIG_DIR } = {}) {
  const env = { ...process.env };
  if (CLAUDE_CONFIG_DIR) env.CLAUDE_CONFIG_DIR = CLAUDE_CONFIG_DIR;
  try {
    const out = execSync(`node hooks/usage-guard-sessionstart.mjs`, { encoding: "utf8", env, timeout: 5000 });
    return { code: 0, out: out.trim() };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "").trim() };
  }
}

// 18. sessionstart: missing file -> exit 0, no output
check("sessionstart: missing file -> exit 0, silent", () => {
  const dir = freshConfigDir();
  const r = runSessionStart({ CLAUDE_CONFIG_DIR: dir });
  assert.equal(r.code, 0);
  assert.equal(r.out, "");
});

// 19. sessionstart: fresh data under watch threshold (70) -> exit 0, silent
check("sessionstart: fresh data under watch threshold -> exit 0, silent", () => {
  const dir = freshConfigDir();
  const nowSec = Math.floor(Date.now() / 1000);
  writeFileSync(join(dir, ".usage-guard-limits.json"), JSON.stringify({
    capturedAt: nowSec,
    fiveHour: { usedPct: 50, resetsAt: nowSec + 3600 },
    sevenDay: { usedPct: 40, resetsAt: nowSec + 7 * 24 * 3600 }
  }), "utf8");
  const r = runSessionStart({ CLAUDE_CONFIG_DIR: dir });
  assert.equal(r.code, 0);
  assert.equal(r.out, "");
});

// 20. sessionstart: fresh data at watch threshold (70) -> prints watch line
check("sessionstart: fresh data at watch threshold (70%) -> prints watch line", () => {
  const dir = freshConfigDir();
  const nowSec = Math.floor(Date.now() / 1000);
  writeFileSync(join(dir, ".usage-guard-limits.json"), JSON.stringify({
    capturedAt: nowSec,
    fiveHour: { usedPct: 70, resetsAt: nowSec + 3600 }
  }), "utf8");
  const r = runSessionStart({ CLAUDE_CONFIG_DIR: dir });
  assert.equal(r.code, 0);
  assert.ok(r.out.includes("⚠️") && r.out.includes("70%") && r.out.includes("5h"));
});

// 21. sessionstart: fresh data at critical threshold (85) -> prints critical line
check("sessionstart: fresh data at critical threshold (85%) -> prints critical line", () => {
  const dir = freshConfigDir();
  const nowSec = Math.floor(Date.now() / 1000);
  writeFileSync(join(dir, ".usage-guard-limits.json"), JSON.stringify({
    capturedAt: nowSec,
    sevenDay: { usedPct: 85, resetsAt: nowSec + 7 * 24 * 3600 }
  }), "utf8");
  const r = runSessionStart({ CLAUDE_CONFIG_DIR: dir });
  assert.equal(r.code, 0);
  assert.ok(r.out.includes("🛑") && r.out.includes("85%") && r.out.includes("weekly"));
});

// 22. sessionstart: stale data -> exit 0, silent
check("sessionstart: stale snapshot -> exit 0, silent", () => {
  const dir = freshConfigDir();
  const staleSec = Math.floor(Date.now() / 1000) - 25 * 3600; // 25h old, max-age 24h
  writeFileSync(join(dir, ".usage-guard-limits.json"), JSON.stringify({
    capturedAt: staleSec,
    fiveHour: { usedPct: 99, resetsAt: Math.floor(Date.now() / 1000) + 3600 }
  }), "utf8");
  const r = runSessionStart({ CLAUDE_CONFIG_DIR: dir });
  assert.equal(r.code, 0);
  assert.equal(r.out, "");
});

// 23. sessionstart: pace tag shows ahead/under/on-pace
check("sessionstart: pace tag reflects even-pace delta", () => {
  const dir = freshConfigDir();
  const nowSec = Math.floor(Date.now() / 1000);
  // 5h window, 80% elapsed (resets in 1h), 75% used -> expected 80%, delta -5 -> "under"
  writeFileSync(join(dir, ".usage-guard-limits.json"), JSON.stringify({
    capturedAt: nowSec,
    fiveHour: { usedPct: 75, resetsAt: nowSec + 3600 }
  }), "utf8");
  const r = runSessionStart({ CLAUDE_CONFIG_DIR: dir });
  assert.ok(r.out.includes("under even pace") || r.out.includes("room to push"));
});

// ---- report --------------------------------------------------------------
for (const root of tmpRoots) {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {}
}

if (fail.length) {
  console.error(`usage-guard self-test: ${pass} passed, ${fail.length} FAILED`);
  for (const f of fail) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(`usage-guard self-test: ${pass}/${pass} checks passed.`);
