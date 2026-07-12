#!/usr/bin/env node
// claude-code-usage-guard — agent quota gate (CLI)
// Reads the real-quota snapshot and exits 0 if the agent may run, 1 if it should pause.
// Usage: node hooks/usage-guard-check.mjs [--max-weekly N] [--max-5h N] [--max-age-hours N] [--quiet]
//        && my-agent-script
// Exit codes: 0 = OK to run, 1 = pause (prints reason unless --quiet)

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}
function limitsPath() {
  return join(configDir(), ".usage-guard-limits.json");
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { maxWeekly: 85, max5h: null, maxAgeHours: 24, quiet: false };
  // A malformed number must NOT silently disable the gate (NaN comparisons are
  // always false, i.e. "never stop") — keep the default instead.
  const num = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--max-weekly") opts.maxWeekly = num(args[++i], opts.maxWeekly);
    else if (a === "--max-5h") opts.max5h = num(args[++i], opts.max5h);
    else if (a === "--max-age-hours") opts.maxAgeHours = num(args[++i], opts.maxAgeHours);
    else if (a === "--quiet") opts.quiet = true;
  }
  return opts;
}

function readLimits(maxAgeSec) {
  try {
    const data = JSON.parse(readFileSync(limitsPath(), "utf8"));
    const nowSec = Math.floor(Date.now() / 1000);
    const cap = Number(data?.capturedAt);
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
    return { capturedAt: cap, fiveHour, sevenDay };
  } catch {
    return null;
  }
}

function fmtReset(resetsAtSec) {
  if (!Number.isFinite(resetsAtSec)) return "";
  const sec = resetsAtSec - Math.floor(Date.now() / 1000);
  if (sec <= 0) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? ` · resets in ${h}h ${m}m` : ` · resets in ${m}m`;
}

function main() {
  const opts = parseArgs();
  const maxAgeSec = opts.maxAgeHours * 3600;
  const limits = readLimits(maxAgeSec);

  if (!limits) {
    if (!opts.quiet) console.log("no quota data (fail-open)");
    return 0;
  }

  const checks = [];
  if (opts.max5h !== null && limits.fiveHour?.usedPct !== undefined) {
    checks.push({ label: "5h", pct: limits.fiveHour.usedPct, max: opts.max5h, reset: limits.fiveHour.resetsAt });
  }
  if (limits.sevenDay?.usedPct !== undefined) {
    checks.push({ label: "weekly", pct: limits.sevenDay.usedPct, max: opts.maxWeekly, reset: limits.sevenDay.resetsAt });
  }

  for (const c of checks) {
    if (c.pct >= c.max) {
      if (!opts.quiet) {
        const pct = Math.round(c.pct);
        console.log(`quota gate: ${c.label} ${pct}% used (limit ${c.max}%)${fmtReset(c.reset)}`);
      }
      return 1;
    }
  }
  return 0;
}

try {
  process.exit(main());
} catch {
  // fail-open: never break the calling script
  process.exit(0);
}