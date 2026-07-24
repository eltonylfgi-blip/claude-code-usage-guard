// claude-code-usage-guard — config loader
// Loads user settings from ~/.claude/usage-guard.json (or $CLAUDE_CONFIG_DIR), with safe defaults.
// There is no public per-plan usage API, so the BUDGET is user-set (like typing your % in a pacer).
// The guard's value is the automatic in-session reminder; the user calibrates the number once.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { isValidNtfyTopic } from "./reset-coach.mjs";

export const DEFAULTS = {
  windowHours: 5, // rolling window to measure (Claude usage limits are rolling, ~5h)
  weightBudget: 0, // your soft cap of "weighted spend" in that window. 0 = unset (rate-only mode)
  warnPct: 0.8, // warn when you cross this fraction of the budget
  burnRatePerHour: 0, // warn if burn rate exceeds this (weighted/hour). 0 = off
  throttleMinutes: 10, // never repeat the same warning more often than this
  quiet: false, // true = compute but never emit (useful for testing / disabling)
  // --- REAL plan quota (5h / 7d) -----------------------------------------
  // Active only when the statusLine shim has captured Claude Code's real `rate_limits`
  // (~/.claude/.usage-guard-limits.json). When present this is the PRIMARY signal and the
  // weighted budget above is only a fallback. Thresholds are a fraction of the plan limit (0..1).
  planWarnPct: 0.8, // warn once a real plan window crosses this fraction (5h or 7d)
  resetCelebration: true, // announce a newly observed 5h / weekly quota window once
  promptContext: true, // inject a fresh real-quota snapshot into Claude on each user prompt
  ntfyTopic: "", // optional mobile reset alert via ntfy.sh; empty = no network
};

export function configPath() {
  const base = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  return join(base, "usage-guard.json");
}

export function loadConfig() {
  let user = {};
  try {
    user = JSON.parse(readFileSync(configPath(), "utf8"));
  } catch {
    // no config file yet -> pure defaults
  }
  const cfg = { ...DEFAULTS, ...user };
  // clamp obviously-bad values so a typo can't break the hook
  cfg.windowHours = Number(cfg.windowHours) > 0 ? Number(cfg.windowHours) : DEFAULTS.windowHours;
  cfg.warnPct = Number(cfg.warnPct) > 0 && Number(cfg.warnPct) <= 1 ? Number(cfg.warnPct) : DEFAULTS.warnPct;
  cfg.throttleMinutes = Number(cfg.throttleMinutes) >= 0 ? Number(cfg.throttleMinutes) : DEFAULTS.throttleMinutes;
  cfg.weightBudget = Math.max(0, Number(cfg.weightBudget) || 0);
  cfg.burnRatePerHour = Math.max(0, Number(cfg.burnRatePerHour) || 0);
  cfg.planWarnPct = Number(cfg.planWarnPct) > 0 && Number(cfg.planWarnPct) <= 1 ? Number(cfg.planWarnPct) : DEFAULTS.planWarnPct;
  cfg.quiet = Boolean(cfg.quiet);
  cfg.resetCelebration = cfg.resetCelebration !== false;
  cfg.promptContext = cfg.promptContext !== false;
  const topic = String(process.env.NTFY_TOPIC ?? cfg.ntfyTopic ?? "").trim();
  cfg.ntfyTopic = isValidNtfyTopic(topic) ? topic : "";
  return cfg;
}
