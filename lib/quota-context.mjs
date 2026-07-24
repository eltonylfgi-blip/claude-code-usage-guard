// Compact quota context for Claude Code hooks.
// Pure formatting only: no filesystem reads, prompt reads, or network calls.

import { pace, WINDOW_SEC } from "./engine.mjs";

export const PROMPT_CONTEXT_MAX_AGE_SEC = 15 * 60;

function formatReset(resetsAtSec, nowSec) {
  if (!Number.isFinite(resetsAtSec)) return "";
  const remaining = Math.floor(resetsAtSec - nowSec);
  if (remaining <= 0) return "";
  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  if (days > 0) return `reset ${days}d ${hours}h`;
  if (hours > 0) return `reset ${hours}h ${minutes}m`;
  return `reset ${Math.max(1, minutes)}m`;
}

function formatPace(window, windowSec, nowSec) {
  const result = pace(window.usedPct, window.resetsAt, windowSec, nowSec);
  if (!result) return "";
  const delta = Math.round(result.deltaPct);
  if (delta >= 5) return `${delta}% ahead of even pace`;
  if (delta <= -5) return `${Math.abs(delta)}% under even pace`;
  return "on pace";
}

function formatWindow(label, window, windowSec, nowSec) {
  if (!window || !Number.isFinite(window.usedPct)) return null;
  const fields = [`${label} ${Math.round(window.usedPct)}% used`];
  const reset = formatReset(window.resetsAt, nowSec);
  const paceText = formatPace(window, windowSec, nowSec);
  if (reset) fields.push(reset);
  if (paceText) fields.push(paceText);
  return fields.join(" | ");
}

export function buildQuotaContext(limits, { nowSec = Math.floor(Date.now() / 1000) } = {}) {
  if (!limits || typeof limits !== "object") return null;
  const parts = [
    formatWindow("5h", limits.fiveHour, WINDOW_SEC.fiveHour, nowSec),
    formatWindow("weekly", limits.sevenDay, WINDOW_SEC.sevenDay, nowSec),
  ].filter(Boolean);
  if (!parts.length) return null;
  return `Usage guard quota: ${parts.join("; ")}. Budget reasoning depth and new subagents from this quota; never trade away correctness, safety, or user intent.`;
}
