---
name: usage
description: Show your Claude Code token usage right now — weighted spend, burn rate, and how close you are to your self-set budget. Use when the user asks "how much have I used", "usage status", "am I burning fast", "cuánto llevo gastado", "/uso".
---

# Usage status

Report the user's current Claude Code usage by reading their local session transcripts.

## Steps

1. Run the engine to get the numbers for the last 5 hours (the rolling window):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/lib/engine.mjs"
   ```

   This prints weighted spend, burn rate, output/input/cache tokens, turn count, and models used.

2. If a config file exists at `~/.claude/usage-guard.json` with a `weightBudget`, compare the
   weighted spend against it and report the percentage used (e.g. "72% of your 8M budget").
   If there is no budget set, say so and suggest setting one to enable the automatic warnings.

3. Present a short, plain-language summary (define any jargon in-line). Example shape:
   - Spent (last 5h): **4.5M weighted** · burn rate **~1.2M/h**
   - Budget: **56% used** (or "no budget set yet")
   - Breakdown: output 183k · fresh input 417k · cache 3.1M created / 8.4M read

4. If usage is high or the burn rate is climbing, give ONE concrete tip to slow the spend
   (e.g. start a fresh session to drop the cache-read tail, batch questions, avoid re-reading
   large files). Keep it to one line — do not lecture.

## Notes

- "Weighted spend" = a single comparable number: input + output + cache-creation at face value,
  cache-read counted at 0.1 (it is ~10x cheaper). It is a proxy, not an exact bill — there is no
  public per-plan usage API.
- The engine has zero dependencies and only reads local files; it never makes network calls.
