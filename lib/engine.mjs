#!/usr/bin/env node
// claude-code-usage-guard — engine
// Zero-dependency reader of Claude Code session transcripts (~/.claude/projects/**/*.jsonl).
// Computes token totals, a single comparable "weight", and a burn rate over a time window.
//
// Usable two ways:
//   import { collect, summarize } from "./engine.mjs"
//   node lib/engine.mjs            -> prints a summary for the active session + last 5h

import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
export function collect({ sinceMs = 0, dir = projectsDir() } = {}) {
  const events = [];
  for (const { path, mtime } of listTranscripts(dir)) {
    // A file untouched since the window start can't hold events in the window. Skip it
    // (keeps the Stop hook fast even with hundreds of past sessions). 60s slack for safety.
    if (sinceMs && mtime < sinceMs - 60_000) continue;
    let text;
    try {
      text = readFileSync(path, "utf8");
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
  return events.sort((a, b) => a.ts - b.ts);
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
  const spanMin = events.length ? Math.max(1, (last - first) / 60000) : 0;
  return {
    ...t,
    sessions: sessions.size,
    models,
    firstTs: events.length ? first : null,
    lastTs: events.length ? last : null,
    spanMin,
    weightPerHour: spanMin ? (t.weight / spanMin) * 60 : 0,
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
  const sinceMs = Date.now() - WINDOW_H * 3600_000;
  const events = collect({ sinceMs });
  if (!events.length) {
    console.log("No usage found in the last " + WINDOW_H + "h (or no transcripts yet).");
    console.log("Looked in: " + projectsDir());
    return;
  }
  const s = summarize(events);
  console.log(`Claude Code usage — last ${WINDOW_H}h`);
  console.log(`  weighted spend : ${fmt(s.weight)}  (${fmt(s.weightPerHour)}/h burn rate)`);
  console.log(`  output tokens  : ${fmt(s.output)}`);
  console.log(`  input (fresh)  : ${fmt(s.input)}`);
  console.log(`  cache created  : ${fmt(s.cacheCreate)}   cache read: ${fmt(s.cacheRead)}`);
  console.log(`  turns          : ${s.turns} across ${s.sessions} session(s)`);
  const top = Object.entries(s.models).sort((a, b) => b[1] - a[1]);
  for (const [m, w] of top) console.log(`    ${m}: ${fmt(w)}`);
}

// Run main() only when executed directly, not when imported.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("engine.mjs")) {
  main();
}
