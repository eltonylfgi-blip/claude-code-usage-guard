#!/usr/bin/env node
// claude-code-usage-guard — SessionStart hook
// Runs when a new Claude Code session starts. Reads the captured real-quota snapshot
// and prints ONE contextual line so the user sees their quota at session start.
// Exit code is always 0; never breaks session startup (fail-open).

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function limitsPath() {
  const base = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  return join(base, ".usage-guard-limits.json");
}

function fmtReset(resetsAtSec) {
  if (!Number.isFinite(resetsAtSec)) return "";
  const sec = resetsAtSec - Math.floor(Date.now() / 1000);
  if (sec <= 0) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return ` · resets in ${h}h ${m}m`;
  return ` · resets in ${m}m`;
}

function paceTag(usedPct, resetsAtSec, windowSec) {
  if (!Number.isFinite(usedPct) || !Number.isFinite(resetsAtSec) || !(windowSec > 0)) return "";
  const nowSec = Math.floor(Date.now() / 1000);
  const remaining = resetsAtSec - nowSec;
  if (remaining <= 0 || remaining > windowSec) return "";
  const expectedPct = ((windowSec - remaining) / windowSec) * 100;
  const d = Math.round(usedPct - expectedPct);
  if (d >= 5) return ` · ${d}% ahead of even pace — slow down to make it last`;
  if (d <= -5) return ` · ${-d}% under even pace — room to push`;
  return " · on pace";
}

function readLimits({ maxAgeSec = 24 * 3600 } = {}) {
  let data;
  try {
    data = JSON.parse(readFileSync(limitsPath(), "utf8"));
  } catch {
    return null;
  }
  if (!data || typeof data !== "object") return null;
  const nowSec = Math.floor(Date.now() / 1000);
  const cap = Number(data.capturedAt);
  // Same strictness as usage-guard-check.mjs: no capturedAt = not trustworthy.
  if (!Number.isFinite(cap) || nowSec - cap > maxAgeSec) return null;
  const win = (w) => {
    if (!w || typeof w !== "object") return null;
    const pct = Number(w.usedPct);
    if (!Number.isFinite(pct)) return null;
    const out = { usedPct: Math.max(0, Math.min(100, pct)) };
    const reset = Number(w.resetsAt);
    if (Number.isFinite(reset)) out.resetsAt = reset;
    return out;
  };
  const fiveHour = win(data.fiveHour);
  const sevenDay = win(data.sevenDay);
  if (!fiveHour && !sevenDay) return null;
  const out = { capturedAt: cap };
  if (fiveHour) out.fiveHour = fiveHour;
  if (sevenDay) out.sevenDay = sevenDay;
  return out;
}

function main() {
  const limits = readLimits({ maxAgeSec: 24 * 3600 });
  if (!limits) {
    return;
  }

  const parts = [];
  const WARN = 85;
  const WATCH = 70;
  const W5 = 5 * 3600;
  const W7 = 7 * 24 * 3600;

  if (limits.fiveHour && Number.isFinite(limits.fiveHour.usedPct)) {
    const pct = Math.round(limits.fiveHour.usedPct);
    if (pct >= WATCH) {
      const tag = paceTag(pct, limits.fiveHour.resetsAt, W5);
      const prefix = pct >= WARN ? "🛑" : "⚠️";
      parts.push(`${prefix} Plan 5h quota: ${pct}% used${fmtReset(limits.fiveHour.resetsAt)}${tag}`);
    }
  }
  if (limits.sevenDay && Number.isFinite(limits.sevenDay.usedPct)) {
    const pct = Math.round(limits.sevenDay.usedPct);
    if (pct >= WATCH) {
      const tag = paceTag(pct, limits.sevenDay.resetsAt, W7);
      const prefix = pct >= WARN ? "🛑" : "⚠️";
      parts.push(`${prefix} Plan weekly quota: ${pct}% used${fmtReset(limits.sevenDay.resetsAt)}${tag}`);
    }
  }

  if (parts.length) {
    console.log(parts.join("  |  "));
  }
}

try {
  main();
} catch {
  // fail-open: never break session start
}
process.exit(0);