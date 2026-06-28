# usage-guard

A tiny [Claude Code](https://code.claude.com) plugin that **warns you in-session as you approach your real plan limits** (the 5-hour and weekly rolling quotas) — with concrete numbers, a burn-rate proxy, and a `/usage-guard:usage` command to check anytime.

It runs in two modes, automatically:

- **Primary — real plan quota.** If you wire up the tiny status-line shim (one line in your settings, below), Claude Code hands it your actual `rate_limits` (5-hour + weekly `used_percentage` and reset times). usage-guard snapshots that locally and warns when a window crosses your threshold: `⚠️ Plan 5h quota: 88% used · resets in 1h 29m`.
- **Fallback — weighted budget.** If the real quota isn't available (status-line not wired, or a session that hasn't had its first API response yet), it falls back to a budget **you** set against a "weighted spend" proxy read from local transcripts: `🛑 Over budget: 120% (6.0M of 5.0M) in 5h`.

Either way it's **quiet** (warns once, then a cooldown — no spam) and **safe** (zero dependencies; reads only local files; **no network calls**; fail-open with a 5s cap, so it can't disrupt your session).

> **Doesn't Claude Code already warn me about the 5-hour limit?** Yes — it shows a native heads-up near the limit. usage-guard's added value is **concrete numbers in-session** (exact % for *both* the 5h and weekly windows + reset countdown), the **weighted burn-rate** fallback when real quota isn't present, and `/usage-guard:usage` to pull the numbers on demand. If you only want the native nudge, you don't need this.

> **How is this different from [ccusage](https://github.com/ryoppippi/ccusage)?** ccusage is a great *reporting* CLI you run to see a breakdown. usage-guard is a *proactive guard*: it nudges you **in the moment**, inside the session, as you near a limit. Use both.

## Install

```
/plugin marketplace add eltonylfgi-blip/claude-code-usage-guard
/plugin install usage-guard@cc-guard
```

The `Stop` hook (the part that warns you) is active immediately. To unlock the **real plan quota** mode, do the one-time status-line wiring below.

### Enable real plan quota (one-time, ~30 seconds)

Claude Code only exposes your real `rate_limits` to a **status-line** command, never to a hook — so usage-guard ships a small status-line shim that snapshots them to a local file the hook reads. (This is a documented Claude Code limitation, not a workaround: a plugin can't auto-register a top-level `statusLine`, so you add the one line.)

Add a `statusLine` block to `~/.claude/settings.json` (Windows: `%USERPROFILE%\.claude\settings.json`). Use the path to your installed plugin (after install it lives under `~/.claude/plugins/`; the exact dir is shown by `/plugin`):

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"/ABSOLUTE/PATH/TO/usage-guard/hooks/usage-guard-statusline.mjs\""
  }
}
```

- **Already have a status line?** Don't lose it — set `USAGE_GUARD_STATUSLINE` to your existing command and the shim re-runs it after snapshotting, so your line still renders:
  ```json
  {
    "statusLine": {
      "type": "command",
      "command": "USAGE_GUARD_STATUSLINE='~/.claude/my-statusline.sh' node \"/ABSOLUTE/PATH/TO/usage-guard/hooks/usage-guard-statusline.mjs\""
    }
  }
  ```
  (On Windows, set the env var in the wrapping shell or a `.cmd`. See **[TUTORIAL.md](./TUTORIAL.md)**.)
- The shim makes **no network calls** — it only reads the JSON Claude Code already pipes to it on stdin, writes `~/.claude/.usage-guard-limits.json`, and reprints your status line. Fail-open: if anything goes wrong, your status line still renders. (If you set `USAGE_GUARD_STATUSLINE`, that command is run each turn through your shell — point it only at a command you trust.)
- Real quota appears only for **Claude.ai Pro/Max** sessions, and only after the first API response. Until then, the guard quietly uses the weighted-budget fallback.

> **Heads-up — this real-quota mode is new.** The `rate_limits` shape it reads follows the [official Claude Code status-line schema](https://code.claude.com/docs/en/statusline), but the end-to-end live capture hasn't been battle-tested across many setups yet. If a window doesn't surface for any reason, usage-guard simply falls back to the weighted proxy — it fails open and never breaks your session. Spotted something off? Issues/feedback welcome.

**Using the Claude Desktop app?** `/plugin` only exists in the terminal CLI. For the desktop app you wire the `Stop` hook (and optionally the status line) manually — see **[TUTORIAL.md](./TUTORIAL.md)**.

## Configure

usage-guard reads `~/.claude/usage-guard.json` (create it). All fields are optional:

```json
{
  "planWarnPct": 0.8,
  "windowHours": 5,
  "weightBudget": 8000000,
  "warnPct": 0.8,
  "burnRatePerHour": 2000000,
  "throttleMinutes": 10
}
```

| Field | Default | Meaning |
|-------|---------|---------|
| `planWarnPct` | `0.8` | **(Real-quota mode)** Warn once a real plan window (5h or weekly) crosses this fraction. |
| `windowHours` | `5` | *(Fallback)* Rolling window for the weighted-budget proxy. |
| `weightBudget` | `0` (off) | *(Fallback)* Your soft cap of **weighted spend**. Warns at `warnPct`. Only used when real quota is unavailable. |
| `warnPct` | `0.8` | *(Fallback)* Warn once you cross this fraction of `weightBudget`. |
| `burnRatePerHour` | `0` (off) | Warn if your weighted spend **in the last hour** exceeds this. Independent of the modes above. |
| `throttleMinutes` | `10` | Minimum gap between warnings. |
| `quiet` | `false` | `true` disables all warnings (still computable via `/usage-guard:usage`). |

In **real-quota mode** you don't need to guess a budget — `planWarnPct` is a fraction of your *actual* plan limit. The `weightBudget` proxy only matters as a fallback when real quota isn't present.

## Check usage anytime

Type `/usage-guard:usage` in Claude Code. When real quota is available it leads with your actual 5h/weekly percentages and reset times, then shows the weighted breakdown.

Or from a terminal:

```bash
node lib/engine.mjs
```

```
Real plan quota (from Claude Code rate_limits):
  plan 5h     : 88% used   (resets in 1h 30m)
  plan weekly : 41% used   (resets in 55h 33m)

Claude Code usage — last 5h (weighted proxy)
  weighted spend : 4.5M  (1.2M/h burn rate)
  output tokens  : 183.0k
  input (fresh)  : 416.9k
  cache created  : 3.1M   cache read: 8.4M
  turns          : 126 across 4 session(s)
    claude-opus-4-8: 4.5M
```

(The "Real plan quota" block appears only once the status-line shim has captured it.)

## What "weighted spend" means (the fallback proxy)

When real quota isn't available, usage-guard rolls your token counts into one comparable number:

```
weight = input + output + cache_creation + (cache_read × 0.1)
```

Cache reads are ~10× cheaper, so they count at 0.1. **It's a proxy for how much you're spending, not an exact bill, and not your plan quota** — it's the best you can do from the transcripts alone, which is why the real `rate_limits` mode is preferred. It reads the `usage` field Claude Code already writes to each turn in `~/.claude/projects/**/*.jsonl`.

## How it works

- `hooks/usage-guard-statusline.mjs` — runs as your status line; snapshots Claude Code's real `rate_limits` to `~/.claude/.usage-guard-limits.json` and reprints your status line. No network.
- `hooks/usage-guard-hook.mjs` — the `Stop` hook. Prefers the captured real quota; falls back to the weighted budget. Emits at most one warning, throttled, fail-open.
- `lib/engine.mjs` — scans local transcripts, sums tokens, computes the weighted proxy, and reads the captured limits. (Importable + a CLI.)
- `lib/config.mjs` — loads your `usage-guard.json` with safe defaults.
- `skills/usage/SKILL.md` — the `/usage-guard:usage` status command.

> State files live in your Claude config dir: `~/.claude/.usage-guard-limits.json` (latest real-quota snapshot) and `~/.claude/.usage-guard-state.json` (throttle memory). Both are best-effort and safe to delete.

## Uninstall / disable

- **Silence without removing:** set `"quiet": true` in `~/.claude/usage-guard.json`.
- **Terminal CLI:** `/plugin uninstall usage-guard@cc-guard` (and optionally `/plugin marketplace remove cc-guard`). Remove the `statusLine` block from `settings.json` if you added it.
- **Desktop app (manual):** delete the `Stop`-hook block (and the `statusLine` block) from `~/.claude/settings.json` and restart.
- **Cleanup (optional):** delete `~/.claude/.usage-guard-state.json`, `~/.claude/.usage-guard-limits.json`, and `~/.claude/usage-guard.json`.

## License

MIT
