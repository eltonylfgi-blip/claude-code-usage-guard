# usage-guard

A tiny [Claude Code](https://code.claude.com) plugin that **warns you in-session when you're burning through your usage fast** — and gives you a `/usage-guard:usage` command to check your spend anytime.

- **Automatic.** A `Stop` hook checks your usage after each turn and drops one short line when you cross your budget or your burn rate spikes: `🛑 Over budget: 120% (6.0M of 5.0M) in 5h`.
- **Quiet.** It warns once, then stays silent for a cooldown window. No spam.
- **Safe.** Zero dependencies, reads only your local transcript files, makes no network calls. If anything goes wrong it stays silent — it can never disrupt your session.

> **How is this different from [ccusage](https://github.com/ryoppippi/ccusage)?** ccusage is a great *reporting* CLI you run to see a breakdown. usage-guard is a *proactive guard*: it nudges you **in the moment**, inside the session, before you blow your budget. Use both.

## Install

```
/plugin marketplace add eltonylfgi-blip/claude-code-usage-guard
/plugin install usage-guard@cc-guard
```

That's it. The hook is active immediately. By default there's no budget set, so it stays quiet until you configure one (below).

## Configure

usage-guard reads `~/.claude/usage-guard.json` (create it). All fields are optional:

```json
{
  "windowHours": 5,
  "weightBudget": 8000000,
  "warnPct": 0.8,
  "burnRatePerHour": 2000000,
  "throttleMinutes": 10
}
```

| Field | Default | Meaning |
|-------|---------|---------|
| `windowHours` | `5` | Rolling window to measure (Claude usage limits are rolling). |
| `weightBudget` | `0` (off) | Your soft cap of **weighted spend** in that window. Warns at `warnPct`. |
| `warnPct` | `0.8` | Warn once you cross this fraction of the budget. |
| `burnRatePerHour` | `0` (off) | Warn if your spend in the **last hour** exceeds this. |
| `throttleMinutes` | `10` | Minimum gap between warnings. |
| `quiet` | `false` | `true` disables all warnings (still computable via `/usage`). |

**There is no public per-plan usage API**, so you set your own budget — like reading your own meter. Run `/usage-guard:usage` (or `npx node lib/engine.mjs`) to see your current numbers, then pick a `weightBudget` a bit above a comfortable session.

## Check usage anytime

Type `/usage-guard:usage` in Claude Code. It reports weighted spend, burn rate, the token breakdown, and how close you are to your budget.

Or from a terminal:

```bash
node lib/engine.mjs
```

```
Claude Code usage — last 5h
  weighted spend : 4.5M  (1.2M/h burn rate)
  output tokens  : 183.0k
  input (fresh)  : 416.9k
  cache created  : 3.1M   cache read: 8.4M
  turns          : 126 across 4 session(s)
    claude-opus-4-8: 4.5M
```

## What "weighted spend" means

A single comparable number so you don't juggle five token counts:

```
weight = input + output + cache_creation + (cache_read × 0.1)
```

Cache reads are ~10× cheaper, so they count at 0.1. **It's a proxy for how much you're spending, not an exact bill.** It reads the `usage` field Claude Code already writes to each turn in `~/.claude/projects/**/*.jsonl`.

## How it works

- `lib/engine.mjs` — scans local transcripts, sums tokens, computes burn rate. (Importable + a CLI.)
- `lib/config.mjs` — loads your `usage-guard.json` with safe defaults.
- `hooks/usage-guard-hook.mjs` — the `Stop` hook. Reads recent usage, emits at most one warning, throttled, fail-open.
- `skills/usage/SKILL.md` — the `/usage-guard:usage` status command.

## License

MIT
