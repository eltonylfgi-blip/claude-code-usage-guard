#!/usr/bin/env node
// claude-code-usage-guard — statusLine capture shim
//
// WHY THIS EXISTS
// ---------------
// The session transcripts (~/.claude/projects/**/*.jsonl) that lib/engine.mjs reads do NOT
// contain your real plan quota. Claude Code only exposes the real 5-hour / 7-day rate limits
// (`rate_limits` in the statusLine payload) to a statusLine command, via stdin. So this script
// runs AS your statusLine, snapshots `rate_limits` to a small file, and the Stop hook reads
// that file to warn you on your ACTUAL plan quota instead of a hand-set proxy budget.
//
// Verified field shape (Claude Code statusLine docs, v2.1.x+):
//   rate_limits.five_hour.used_percentage   number 0..100   (may be absent)
//   rate_limits.five_hour.resets_at         Unix epoch SECONDS
//   rate_limits.seven_day.used_percentage   number 0..100   (may be absent)
//   rate_limits.seven_day.resets_at         Unix epoch SECONDS
// `rate_limits` is present only for Claude.ai Pro/Max after the first API response, and each
// window may be independently absent. The statusLine makes NO network calls — it only reads the
// local JSON Claude Code already pipes to it.
//
// CONTRACT
// --------
// - FAIL-OPEN and FAST: this runs on every assistant message. It must never throw and must
//   never delay the status line. Any error -> we still print a status line and exit 0.
// - NON-DESTRUCTIVE: by default it re-prints whatever your previous statusLine command would
//   print, so chaining it in front of your existing status line keeps that line intact. You can
//   point it at your real statusLine via the USAGE_GUARD_STATUSLINE env var (a shell command),
//   or it falls back to a minimal "[model]" line.

import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}
function limitsPath() {
  return join(configDir(), ".usage-guard-limits.json");
}

// Read all of stdin (the statusLine JSON payload). Bounded + sync so we stay simple and fast.
function readStdin() {
  try {
    return readFileSync(0, "utf8"); // fd 0
  } catch {
    return "";
  }
}

// Pull just the rate-limit numbers we care about, defensively. Returns null if nothing usable.
function extractLimits(payload) {
  const rl = payload && payload.rate_limits;
  if (!rl || typeof rl !== "object") return null;
  const win = (w) => {
    if (!w || typeof w !== "object") return null;
    const pct = Number(w.used_percentage);
    const reset = Number(w.resets_at);
    const out = {};
    if (Number.isFinite(pct)) out.usedPct = pct;
    if (Number.isFinite(reset)) out.resetsAt = reset; // epoch SECONDS, as Claude Code sends
    return Object.keys(out).length ? out : null;
  };
  const fiveHour = win(rl.five_hour);
  const sevenDay = win(rl.seven_day);
  if (!fiveHour && !sevenDay) return null;
  const snapshot = { capturedAt: Math.floor(Date.now() / 1000) };
  if (fiveHour) snapshot.fiveHour = fiveHour;
  if (sevenDay) snapshot.sevenDay = sevenDay;
  return snapshot;
}

// Persist atomically (tmp + rename) so the Stop hook never reads a torn file.
function writeLimits(snapshot) {
  try {
    const p = limitsPath();
    mkdirSync(dirname(p), { recursive: true });
    const tmp = p + ".tmp";
    writeFileSync(tmp, JSON.stringify(snapshot));
    renameSync(tmp, p);
  } catch {
    // fail-open: a failed snapshot just means the Stop hook uses its fallback this turn
  }
}

// Print SOMETHING for the status line so chaining us in front of your real one is harmless.
// Priority: your real statusLine command (USAGE_GUARD_STATUSLINE) -> minimal model line -> "".
function passthrough(rawStdin, payload) {
  const inner = process.env.USAGE_GUARD_STATUSLINE;
  if (inner && inner.trim()) {
    try {
      const out = execSync(inner, {
        input: rawStdin,
        encoding: "utf8",
        timeout: 3000,
        stdio: ["pipe", "pipe", "ignore"],
      });
      process.stdout.write(out.endsWith("\n") ? out : out + "\n");
      return;
    } catch {
      // fall through to the minimal line
    }
  }
  const name = payload && payload.model && payload.model.display_name;
  process.stdout.write(name ? `[${name}]\n` : "\n");
}

function main() {
  const raw = readStdin();
  let payload = null;
  if (raw && raw.trim()) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
  }
  if (payload) {
    const snapshot = extractLimits(payload);
    if (snapshot) writeLimits(snapshot);
  }
  passthrough(raw, payload);
}

try {
  main();
} catch {
  // Last-resort fail-open: never break the user's status line.
  try {
    process.stdout.write("\n");
  } catch {}
}
process.exit(0);
