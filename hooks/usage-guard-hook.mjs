#!/usr/bin/env node
// claude-code-usage-guard — Stop hook
// Fires after Claude finishes a turn. Reads your recent token usage, and if you are
// approaching your self-set budget OR burning unusually fast, emits ONE short warning line.
// Throttled so it never spams. Fully fail-safe: any error -> exit 0, no output, no harm.

import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function fmt(n) {
  n = Math.round(n);
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

// "in 2h 10m" / "in 45m" until an epoch-seconds reset. Returns "" if unknown/past.
function fmtReset(resetsAtSec) {
  if (!Number.isFinite(resetsAtSec)) return "";
  const sec = resetsAtSec - Math.floor(Date.now() / 1000);
  if (sec <= 0) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return ` · resets in ${h}h ${m}m`;
  return ` · resets in ${m}m`;
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
  // Write atomically (tmp + rename) so a concurrent session never reads a torn file.
  try {
    const p = statePath();
    const tmp = p + ".tmp";
    writeFileSync(tmp, JSON.stringify(s));
    renameSync(tmp, p);
  } catch {}
}

async function main() {
  // Import inside the try so an evaluation-time throw in a lib still fails open.
  const { collect, summarize, readLimits, pace, paceTag, WINDOW_SEC } = await import("../lib/engine.mjs");
  const { loadConfig } = await import("../lib/config.mjs");

  const cfg = loadConfig();
  if (cfg.quiet) return; // disabled by user

  const now = Date.now();

  // Build candidate warnings, most important first.
  const candidates = [];

  // ---- PRIMARY: real plan quota (5h / 7d), if the statusLine shim captured it -------------
  // This is Claude Code's actual `rate_limits`, not a hand-set proxy. When present it wins:
  // we warn on the real plan window(s) and skip the weighted-budget path entirely.
  const limits = readLimits();
  if (limits) {
    const planPct = Math.round(cfg.planWarnPct * 100);
    const consider = (label, win, winSec) => {
      if (!win || !Number.isFinite(win.usedPct)) return;
      if (win.usedPct < planPct) return;
      const over = win.usedPct >= 100;
      // Pace readout: the native heads-up says you're near the cliff; this says how to
      // pace the rest of the window ("ahead of even pace — slow down" / "under — push").
      const p = pace(win.usedPct, win.resetsAt, winSec);
      const paceStr = p ? ` · ${paceTag(p)}` : "";
      candidates.push({
        kind: "plan",
        msg:
          (over ? "🛑 " : "⚠️ ") +
          `Plan ${label} quota: ${Math.round(win.usedPct)}% used${fmtReset(win.resetsAt)}${paceStr}`,
      });
    };
    // 5h is the tighter/more urgent window, so consider it first (higher priority).
    consider("5h", limits.fiveHour, WINDOW_SEC.fiveHour);
    consider("weekly", limits.sevenDay, WINDOW_SEC.sevenDay);
  }

  // ---- FALLBACK: weighted-budget proxy from transcripts ----------------------------------
  // Used when there's no real-quota snapshot (statusLine not wired, or pre-first-response /
  // non-subscriber session). Also still honors an explicit burn-rate cap regardless.
  if (!candidates.length || cfg.burnRatePerHour > 0) {
    const windowMs = cfg.windowHours * 3600_000;
    const events = collect({ sinceMs: now - windowMs });
    if (events.length) {
      const s = summarize(events);
      // current pace = weighted spend in the last hour (more honest than span-based rate)
      const hourCut = now - 3600_000;
      let rate = 0;
      for (const e of events) if (e.ts >= hourCut) rate += e.weight;

      if (!candidates.length && cfg.weightBudget > 0) {
        const pct = s.weight / cfg.weightBudget;
        if (pct >= cfg.warnPct) {
          const over = pct >= 1;
          candidates.push({
            kind: "budget",
            msg:
              (over ? "🛑 Over budget: " : "⚠️ Near budget: ") +
              `${Math.round(pct * 100)}% (${fmt(s.weight)} of ${fmt(cfg.weightBudget)}) in ${cfg.windowHours}h`,
          });
        }
      }
      if (cfg.burnRatePerHour > 0 && rate >= cfg.burnRatePerHour) {
        candidates.push({ kind: "rate", msg: `⚠️ Burning fast: ${fmt(rate)}/h (limit ${fmt(cfg.burnRatePerHour)}/h)` });
      }
    }
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

// The hook derives everything it needs from the filesystem and intentionally ignores its
// stdin JSON payload; process.exit(0) below terminates without needing to drain it.
// Never throw: fail open so the guard can never disrupt the session.
try {
  await main();
} catch {
  // fail-open: stay silent rather than ever disrupting the session
}
process.exit(0);
