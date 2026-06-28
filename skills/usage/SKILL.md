---
name: usage
description: Show your Claude Code usage right now — your real plan quota (5h + weekly) when available, plus a weighted-spend proxy, burn rate, and how close you are to your budget. Use when the user asks "how much have I used", "usage status", "am I burning fast", "cuánto llevo gastado", "/uso".
---

# Usage status

Report the user's current Claude Code usage by reading the locally-captured plan quota and their
local session transcripts.

## Steps

1. Run the engine:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/lib/engine.mjs"
   ```

   - If the status-line shim has been wired up (see README §3.5), the output LEADS with a
     **"Real plan quota"** block: the actual 5-hour and weekly `used_percentage` and reset times.
     This is the number that truly gates the user — report it first.
   - Below that it prints the weighted-spend proxy for the last 5 hours: burn rate,
     output/input/cache tokens, turn count, and models used.

2. If the "Real plan quota" block is present, report those percentages and reset countdowns as
   the headline. If it is ABSENT, tell the user real quota isn't being captured yet and that they
   can enable it by wiring the status line (README §3.5) — until then, fall back to the proxy.

3. If a config file exists at `~/.claude/usage-guard.json` with a `weightBudget`, also compare the
   weighted spend against it (e.g. "72% of your 8M fallback budget"). If no budget is set and no
   real quota is captured, say so and point to the two ways to enable warnings.

4. Present a short, plain-language summary (define any jargon in-line). Example shape:
   - Plan quota: **5h 88% used** (resets in 1h 29m) · **weekly 41%** — when available
   - Spent (last 5h, proxy): **4.5M weighted** · burn rate **~1.2M/h**
   - Breakdown: output 183k · fresh input 417k · cache 3.1M created / 8.4M read

5. If usage is high or the burn rate is climbing, give ONE concrete tip to slow the spend
   (e.g. start a fresh session to drop the cache-read tail, batch questions, avoid re-reading
   large files). Keep it to one line — do not lecture.

## Notes

- **Real plan quota** comes from Claude Code's `rate_limits` (5h + weekly), captured by the
  status-line shim to `~/.claude/.usage-guard-limits.json`. It's the actual plan limit, not a
  guess. Present only for Claude.ai Pro/Max after the first API response.
- **"Weighted spend"** is the FALLBACK proxy: input + output + cache-creation at face value,
  cache-read counted at 0.1 (it is ~10x cheaper). A proxy, not an exact bill and not the plan
  quota — used when real `rate_limits` aren't available.
- The engine has zero dependencies and only reads local files; it never makes network calls.
