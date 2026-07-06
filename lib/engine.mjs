#!/usr/bin/env node
// claude-code-usage-guard — engine
// Zero-dependency reader of Claude Code session transcripts (~/.claude/projects/**/*.jsonl).
// Computes token totals, a single comparable "weight", and a burn rate over a time window.
//
// Usable two ways:
//   import { collect, summarize } from "./engine.mjs"
//   node lib/engine.mjs            -> prints a summary for the active session + last 5h

import { readdirSync, statSync, openSync, fstatSync, readSync, closeSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---- real plan quota, captured by the statusLine shim --------------------
// hooks/usage-guard-statusline.mjs snapshots Claude Code's `rate_limits` (the REAL 5h/7d plan
// quota, which is NOT in the transcripts) to ~/.claude/.usage-guard-limits.json. Reading it lets
// the guard warn on actual plan usage when available; absent file -> caller falls back to the
// weighted-budget proxy. Returns null if the file is missing, stale, or unusable (fail-open).
export function limitsPath() {
  const base = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  return join(base, ".usage-guard-limits.json");
}

// maxAgeSec: ignore a snapshot older than this (default 6h). The statusLine refreshes it on every
// turn, so a stale file means the statusLine isn't wired up (or the session lacks rate_limits) —
// in that case we'd rather fall back than warn on numbers from hours ago.
export function readLimits({ maxAgeSec = 6 * 3600 } = {}) {
  let data;
  try {
    data = JSON.parse(readFileSync(limitsPath(), "utf8"));
  } catch {
    return null; // no file yet, or unreadable -> fall back
  }
  if (!data || typeof data !== "object") return null;
  const nowSec = Math.floor(Date.now() / 1000);
  const cap = Number(data.capturedAt);
  if (Number.isFinite(cap) && nowSec - cap > maxAgeSec) return null; // too old -> fall back
  const win = (w) => {
    if (!w || typeof w !== "object") return null;
    const pct = Number(w.usedPct);
    if (!Number.isFinite(pct)) return null;
    const out = { usedPct: Math.max(0, Math.min(100, pct)) };
    const reset = Number(w.resetsAt);
    if (Number.isFinite(reset)) out.resetsAt = reset; // epoch seconds
    return out;
  };
  const fiveHour = win(data.fiveHour);
  const sevenDay = win(data.sevenDay);
  if (!fiveHour && !sevenDay) return null;
  const out = { capturedAt: Number.isFinite(cap) ? cap : null };
  if (fiveHour) out.fiveHour = fiveHour;
  if (sevenDay) out.sevenDay = sevenDay;
  return out;
}

// ---- even-pace check ------------------------------------------------------
// The native Claude Code heads-up tells you you're NEAR the cliff; this tells you how to
// PACE the window so you never reach it: given how much of the window has already elapsed,
// are you ahead of or behind an even spend rate? Pure function (testable, no I/O).
// Returns null when it can't be computed honestly (no reset timestamp, reset already past,
// or a reset further away than the window itself — alignment unknown).
export const WINDOW_SEC = { fiveHour: 5 * 3600, sevenDay: 7 * 24 * 3600 };
export function pace(usedPct, resetsAtSec, windowSec, nowSec = Math.floor(Date.now() / 1000)) {
  if (!Number.isFinite(usedPct) || !Number.isFinite(resetsAtSec) || !(windowSec > 0)) return null;
  const remaining = resetsAtSec - nowSec;
  if (remaining <= 0 || remaining > windowSec) return null;
  const expectedPct = ((windowSec - remaining) / windowSec) * 100;
  return { deltaPct: usedPct - expectedPct, expectedPct };
}
// Short human tag for a pace result. ±5% counts as "on pace" (the estimate isn't that precise).
export function paceTag(p) {
  if (!p) return "";
  const d = Math.round(p.deltaPct);
  if (d >= 5) return `${d}% ahead of even pace — slow down to make it last`;
  if (d <= -5) return `${-d}% under even pace — room to push`;
  return "on pace";
}

// ---- where Claude Code stores transcripts -------------------------------
export function projectsDir() {
  // CLAUDE_CONFIG_DIR overrides the default ~/.claude (respected by Claude Code itself).
  const base = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
  return join(base, "projects");
}

// List every *.jsonl transcript, newest first.
function listTranscripts(dir) {
  let out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // dir missing -> no data yet
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out = out.concat(listTranscripts(p));
    else if (e.isFile() && e.name.endsWith(".jsonl")) {
      try {
        out.push({ path: p, mtime: statSync(p).mtimeMs });
      } catch {}
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

// Read at most the last `maxBytes` of a file as UTF-8, dropping a leading partial line.
// Bounds per-turn work so the Stop hook stays fast even on huge histories.
function readTail(path, maxBytes = 1024 * 1024) {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const start = size > maxBytes ? size - maxBytes : 0;
    const len = size - start;
    if (len <= 0) return "";
    const buf = Buffer.allocUnsafe(len);
    readSync(fd, buf, 0, len, start);
    let text = buf.toString("utf8");
    if (start > 0) {
      const nl = text.indexOf("\n");
      text = nl >= 0 ? text.slice(nl + 1) : ""; // drop the partial first line
    }
    return text;
  } finally {
    closeSync(fd);
  }
}

// Strip control characters from a transcript-derived string before printing it.
function sanitize(s) {
  let out = "";
  for (const ch of String(s)) if (ch.charCodeAt(0) >= 32) out += ch;
  return out;
}

// A single comparable number. cache_read is ~10x cheaper than fresh input, so it
// counts at 0.1; everything else at face value. This is a proxy for "how much you
// are spending", not an exact bill — there is no public per-plan usage API.
export function weigh(u) {
  return (
    (u.input_tokens || 0) +
    (u.output_tokens || 0) +
    (u.cache_creation_input_tokens || 0) +
    (u.cache_read_input_tokens || 0) * 0.1
  );
}

// Read transcript events newer than `sinceMs` (epoch ms). One row per assistant turn.
// Claude Code streams an assistant message to the JSONL several times as it generates,
// each partial write sharing the SAME requestId/message.id and carrying the SAME final
// usage object — so we collapse to one row per requestId to avoid 2-4x inflation.
export function collect({ sinceMs = 0, dir = projectsDir() } = {}) {
  const events = [];
  for (const { path, mtime } of listTranscripts(dir)) {
    // A file untouched since the window start can't hold events in the window. Skip it
    // (keeps the Stop hook fast even with hundreds of past sessions). 60s slack for safety.
    if (sinceMs && mtime < sinceMs - 60_000) continue;
    let text;
    try {
      text = readTail(path);
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      if (!line || line[0] !== "{") continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        continue; // skip partial/corrupt lines, never crash
      }
      if (row.type !== "assistant" || !row.message?.usage) continue;
      const ts = Date.parse(row.timestamp);
      if (!Number.isFinite(ts) || ts < sinceMs) continue;
      const u = row.message.usage;
      events.push({
        ts,
        requestId: row.requestId || row.message?.id || null,
        sessionId: row.sessionId,
        model: row.message.model || "unknown",
        input: u.input_tokens || 0,
        output: u.output_tokens || 0,
        cacheCreate: u.cache_creation_input_tokens || 0,
        cacheRead: u.cache_read_input_tokens || 0,
        weight: weigh(u),
      });
    }
  }
  // Collapse duplicate streaming frames: keep the last row per requestId (frames are
  // identical anyway). Fall back to ts:sessionId for legacy rows with no requestId.
  const byReq = new Map();
  for (const ev of events) {
    const k = ev.requestId ?? `${ev.ts}:${ev.sessionId}`;
    byReq.set(k, ev);
  }
  return [...byReq.values()].sort((a, b) => a.ts - b.ts);
}

// Roll up a set of events into totals + a burn rate (weight per hour).
export function summarize(events) {
  const t = { input: 0, output: 0, cacheCreate: 0, cacheRead: 0, weight: 0, turns: events.length };
  const sessions = new Set();
  const models = {};
  let first = Infinity,
    last = 0;
  for (const e of events) {
    t.input += e.input;
    t.output += e.output;
    t.cacheCreate += e.cacheCreate;
    t.cacheRead += e.cacheRead;
    t.weight += e.weight;
    sessions.add(e.sessionId);
    models[e.model] = (models[e.model] || 0) + e.weight;
    if (e.ts < first) first = e.ts;
    if (e.ts > last) last = e.ts;
  }
  // Burn rate over the OBSERVED span. Only meaningful once the span is long enough —
  // annualizing a sub-10-minute span would wildly over-report (a single turn -> 60x).
  const spanMin = events.length ? (last - first) / 60000 : 0;
  const MIN_SPAN_MIN = 10;
  return {
    ...t,
    sessions: sessions.size,
    models,
    firstTs: events.length ? first : null,
    lastTs: events.length ? last : null,
    spanMin,
    weightPerHour: spanMin >= MIN_SPAN_MIN ? (t.weight / spanMin) * 60 : 0,
  };
}

function fmt(n) {
  n = Math.round(n);
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

// CLI: quick human summary of the last 5 hours (the typical rolling window).
function main() {
  const WINDOW_H = 5;

  // Lead with the REAL plan quota when the statusLine shim has captured it — that's the number
  // that actually gates you. It's independent of transcript activity, so print it first, even
  // when there's been no recent usage. The weighted view below is the proxy/fallback.
  const limits = readLimits();
  if (limits) {
    const line = (label, w, winSec) => {
      if (!w || !Number.isFinite(w.usedPct)) return;
      let s = `  plan ${label.padEnd(6)} : ${Math.round(w.usedPct)}% used`;
      if (Number.isFinite(w.resetsAt)) {
        const sec = w.resetsAt - Math.floor(Date.now() / 1000);
        if (sec > 0) s += `   (resets in ${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m)`;
      }
      const p = pace(w.usedPct, w.resetsAt, winSec);
      if (p) s += `   · ${paceTag(p)}`;
      console.log(s);
    };
    console.log("Real plan quota (from Claude Code rate_limits):");
    line("5h", limits.fiveHour, WINDOW_SEC.fiveHour);
    line("weekly", limits.sevenDay, WINDOW_SEC.sevenDay);
    console.log("");
  }

  const sinceMs = Date.now() - WINDOW_H * 3600_000;
  const events = collect({ sinceMs });
  if (!events.length) {
    console.log("No usage found in the last " + WINDOW_H + "h (or no transcripts yet).");
    console.log("Looked in: " + projectsDir());
    if (!limits) {
      console.log("");
      console.log("(No real plan quota captured yet — wire up the statusLine to enable it; see README.)");
    }
    return;
  }

  const s = summarize(events);
  const rate = s.weightPerHour ? `${fmt(s.weightPerHour)}/h burn rate` : "burn rate: n/a (window too short)";
  console.log(`Claude Code usage — last ${WINDOW_H}h (weighted proxy)`);
  console.log(`  weighted spend : ${fmt(s.weight)}  (${rate})`);
  console.log(`  output tokens  : ${fmt(s.output)}`);
  console.log(`  input (fresh)  : ${fmt(s.input)}`);
  console.log(`  cache created  : ${fmt(s.cacheCreate)}   cache read: ${fmt(s.cacheRead)}`);
  console.log(`  turns          : ${s.turns} across ${s.sessions} session(s)`);
  const top = Object.entries(s.models).sort((a, b) => b[1] - a[1]);
  for (const [m, w] of top) console.log(`    ${sanitize(m)}: ${fmt(w)}`);
}

// Run main() only when executed directly, not when imported. Compare real filesystem
// paths (normalizes Windows slashes/case) instead of string-templating a file:// URL.
const invokedDirectly =
  process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]);
if (invokedDirectly) main();
