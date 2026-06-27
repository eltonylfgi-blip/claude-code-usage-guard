#!/usr/bin/env node
// claude-code-usage-guard — Stop hook
// Fires after Claude finishes a turn. Reads your recent token usage, and if you are
// approaching your self-set budget OR burning unusually fast, emits ONE short warning line.
// Throttled so it never spams. Fully fail-safe: any error -> exit 0, no output, no harm.

import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { collect, summarize } from "../lib/engine.mjs";
import { loadConfig } from "../lib/config.mjs";

function fmt(n) {
  n = Math.round(n);
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function statePath() {
  const base = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  return join(base, ".usage-guard-state.json");
}
function readState() {
  try {
    return JSON.parse(readFileSync(statePath(), "utf8"));
  } catch {
    return {};
  }
}
function writeState(s) {
  try {
    writeFileSync(statePath(), JSON.stringify(s));
  } catch {}
}

async function main() {
  const cfg = loadConfig();
  if (cfg.quiet) return; // disabled by user

  const now = Date.now();
  const windowMs = cfg.windowHours * 3600_000;
  const events = collect({ sinceMs: now - windowMs });
  if (!events.length) return;

  const s = summarize(events);
  // current pace = weighted spend in the last hour (more honest than span-based rate)
  const hourCut = now - 3600_000;
  let rate = 0;
  for (const e of events) if (e.ts >= hourCut) rate += e.weight;

  // Build candidate warnings, most important first.
  const candidates = [];
  if (cfg.weightBudget > 0) {
    const pct = s.weight / cfg.weightBudget;
    if (pct >= cfg.warnPct) {
      const over = pct >= 1;
      candidates.push({
        kind: "budget",
        msg:
          (over ? "🛑 Tope superado: " : "⚠️ Cerca del tope: ") +
          `${Math.round(pct * 100)}% (${fmt(s.weight)} de ${fmt(cfg.weightBudget)}) en ${cfg.windowHours}h`,
      });
    }
  }
  if (cfg.burnRatePerHour > 0 && rate >= cfg.burnRatePerHour) {
    candidates.push({ kind: "rate", msg: `⚠️ Vas rápido: ritmo ${fmt(rate)}/h (límite ${fmt(cfg.burnRatePerHour)}/h)` });
  }
  if (!candidates.length) return;

  // Global throttle: after any warning, stay quiet for throttleMinutes so back-to-back
  // turns don't spam. candidates[0] is the highest-priority signal (budget over rate).
  const state = readState();
  const throttleMs = cfg.throttleMinutes * 60_000;
  if (now - (state.last || 0) < throttleMs) return;
  const pick = candidates[0];

  state.last = now;
  writeState(state);

  // Surface to the user. Exit 0 + JSON { systemMessage } shows a non-blocking line.
  process.stdout.write(JSON.stringify({ systemMessage: pick.msg, suppressOutput: false }));
}

// Read (and ignore) stdin so the pipe closes cleanly, then run. Never throw.
try {
  await main();
} catch {
  // fail-open: stay silent rather than ever disrupting the session
}
process.exit(0);
