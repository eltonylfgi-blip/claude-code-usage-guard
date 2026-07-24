# usage-guard — Beginner's Tutorial

A friendly, copy-paste guide to installing and using **usage-guard**, the little Claude Code plugin that gives Claude your fresh quota while it works and taps you on the shoulder before a limit.

No prior plugin experience needed. We cover **both** places you might run Claude:

- **A. The terminal Claude Code CLI** (the `claude` command in your terminal) — easy `/plugin` install.
- **B. The Claude Desktop app** — `/plugin` isn't available there, so we wire it up by hand. Still copy-paste, still ~5 minutes.

---

## 1. What this plugin actually does

usage-guard has **two modes**, and it picks the best one available automatically.

**Mode 1 — real plan quota (the good one).** Claude Code knows your actual rolling limits: a **5-hour** window and a **weekly** window, each as a percentage used. It only hands those numbers to a *status-line* script, though — never to a hook. So usage-guard ships a tiny status-line shim that grabs them and saves them locally. Once you wire that up (§3.5, one line), the guard gives Claude the real numbers on every prompt and can warn you before the limit:

```
⚠️ Plan 5h quota: 88% used · resets in 1h 29m
```

Claude privately receives a compact line like this alongside each prompt, so it can budget reasoning depth and new subagents from what actually remains:

```text
Usage guard quota: 5h 62% used | reset 2h 0m | on pace; weekly 58% used | reset 2d 0h | 13% under even pace.
```

The prompt-context hook never reads or echoes your prompt, never makes a network call, rejects snapshots older than 15 minutes, and always fails open.

**Mode 2 — weighted budget (the fallback).** If the real quota isn't available yet (you didn't wire the status line, or the session hasn't made its first API call), the guard falls back to a budget **you** set, measured against a "weighted spend" proxy it reads from the local transcript files:

```
🛑 Over budget: 120% (6.0M of 5.0M) in 5h
```

Either mode prints **one short line**, then stays quiet for a cooldown so it never spams you. Once real quota is available, the guard also announces each newly observed 5-hour or weekly reset once: `🎉 Fresh quota! New window ready (5h) — make the most of it.` You also get a command, **`/usage-guard:usage`**, to check your numbers whenever you want.

A few things worth knowing up front:

- **Real quota beats the proxy.** Mode 1 uses your *actual* plan limit, so you don't have to guess a budget. Mode 2 is an honest approximation for when Mode 1 isn't there — there's no public per-plan usage *API*, only the status-line `rate_limits` field, which is why the wiring in §3.5 matters.
- **Real quota is Pro/Max only**, and only after the session's first API response. Before that (or on other plans) the guard quietly uses Mode 2.
- **Does Claude Code already warn me?** It shows a native heads-up near the 5-hour limit. usage-guard adds concrete numbers (both windows + reset countdown) and the burn-rate fallback. If the native nudge is enough for you, you don't need this.
- **It's safe.** Zero dependencies, reads local files, and makes **no network calls by default**. The only optional network path is an `ntfy` reset alert you must explicitly configure. If anything goes wrong it stays silent and exits cleanly (fail-open); the hook is capped at 5 seconds.

---

## 2. Before you start: where is "`~/.claude`"?

usage-guard keeps its config in your Claude config folder. You'll see `~/.claude/...` a lot below. That folder is:

| OS | Path | Paste this in a file dialog |
|----|------|------------------------------|
| macOS / Linux | `~/.claude` | `~/.claude` |
| Windows | `C:\Users\<you>\.claude` | `%USERPROFILE%\.claude` |

If you've used Claude Code before, this folder already exists. The config file `usage-guard.json` does **not** exist yet — you'll create it by hand in §5 (that's normal).

> If you set a custom `CLAUDE_CONFIG_DIR` environment variable, use *that* folder instead of `~/.claude` everywhere below.

---

## 3. Install — Route A: Terminal Claude Code CLI

This is the easy path. In a Claude Code terminal session, run these two slash commands:

```
/plugin marketplace add eltonylfgi-blip/claude-code-usage-guard
/plugin install usage-guard@cc-guard
```

- The first line tells Claude Code about the marketplace this plugin lives in (`cc-guard`).
- The second line installs the plugin named `usage-guard` from it.

That's it — the warning and prompt-context hooks are active immediately, and you now have the `/usage-guard:usage` command. Prompt context stays silent until real-quota capture is enabled (§3.5); warnings can also use a fallback budget (§5).

**Sanity check:** type `/usage-guard:usage` and press Enter. You should get a usage summary back. If you do, the install worked. (Skip to §4.)

---

## 3B. Install — Route B: Claude Desktop app (no `/plugin`)

The desktop app doesn't have the `/plugin` command, so we wire the hooks in manually. It's two steps: **(1)** get the plugin files onto your machine, **(2)** point the warning and prompt-context hooks at them in your settings file.

### Step 1 — Get the files

Clone (or download) the repo somewhere stable that you won't move later:

```bash
git clone https://github.com/eltonylfgi-blip/claude-code-usage-guard.git
```

Note the **absolute path** to it. For example:

- macOS/Linux: `/Users/you/claude-code-usage-guard`
- Windows: `C:\Users\you\claude-code-usage-guard`

You'll paste this path in Step 2. (No `npm install` is needed — the plugin has zero dependencies.)

You do need **Node.js 18+** on your PATH. Check with:

```bash
node --version
```

If that prints a version like `v20.x`, you're good.

### Step 2 — Wire the hooks into `settings.json`

Open your settings file:

- macOS/Linux: `~/.claude/settings.json`
- Windows: `%USERPROFILE%\.claude\settings.json`

If the file doesn't exist, create it. If it does exist and already has content, **merge** the `"hooks"` block below into it (don't blow away your existing settings).

Paste this, replacing `/ABSOLUTE/PATH/TO/claude-code-usage-guard` with the real path from Step 1:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["/ABSOLUTE/PATH/TO/claude-code-usage-guard/hooks/usage-guard-hook.mjs"],
            "timeout": 5
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node",
            "args": ["/ABSOLUTE/PATH/TO/claude-code-usage-guard/hooks/usage-guard-prompt-context.mjs"],
            "timeout": 2
          }
        ]
      }
    ]
  }
}
```

**Windows note — backslashes.** JSON treats `\` as an escape character, so in a Windows path you must **double** every backslash:

```json
            "args": ["C:\\Users\\you\\claude-code-usage-guard\\hooks\\usage-guard-hook.mjs"],
```

Do the same for `usage-guard-prompt-context.mjs` in the second hook block.

**Why `"command": "node"` and a separate `"args"` array?** Two reasons. First, `settings.json` uses the *split* form (command + args) — that's different from the plugin's own `hooks/hooks.json`, which uses a single shell string. Second, on Windows the script's `#!/usr/bin/env node` shebang line is ignored, so you must invoke Node explicitly. Using `node` + the absolute path works identically on Windows, macOS, and Linux.

Save the file and **restart the Claude Desktop app** so it picks up the new hooks.

### What you get (and don't) on the manual route

- You **do** get both automatic in-session warnings and fresh quota in Claude's context on every prompt.
- You **don't** get the `/usage-guard:usage` slash command — that only ships with the `/plugin` install. To check your numbers on demand, run the engine directly from your clone:

  ```bash
  node /ABSOLUTE/PATH/TO/claude-code-usage-guard/lib/engine.mjs
  ```

  (On Windows: `node C:\Users\you\claude-code-usage-guard\lib\engine.mjs`.)

---

## 3.5. Turn on real plan quota (the status-line shim)

This is what unlocks **Mode 1**. It's a one-time edit and takes about 30 seconds. If you skip it, the guard still works in Mode 2 (weighted budget, §5) — but you'll be guessing a budget instead of using your real plan limit, so it's worth doing.

**Why a status line and not just a hook?** Claude Code only puts your real `rate_limits` (the 5h and weekly percentages) into the JSON it sends to a **status-line** command. Hooks never receive those fields directly. A plugin also can't auto-register a top-level status line for you. So usage-guard ships a tiny script that runs *as* your status line: it reads that JSON, saves the numbers to `~/.claude/.usage-guard-limits.json`, and reprints your status line. The `Stop` and `UserPromptSubmit` hooks then read that local file. No network — it only reads what Claude Code already handed it.

**Step 1 — find the script path.** After a `/plugin` install, the plugin lives under `~/.claude/plugins/` (run `/plugin` to see the exact folder). The script is:

```
<that folder>/hooks/usage-guard-statusline.mjs
```

If you installed from a clone (desktop route), it's `<your clone>/hooks/usage-guard-statusline.mjs`.

**Step 2 — add a `statusLine` to `~/.claude/settings.json`** (Windows: `%USERPROFILE%\.claude\settings.json`). If the file has other settings, just merge in the `statusLine` block:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"/ABSOLUTE/PATH/TO/usage-guard/hooks/usage-guard-statusline.mjs\"",
    "refreshInterval": 30
  }
}
```

Keep `"refreshInterval": 30`: without it, status-line updates can pause while the coordinator waits on background subagents and the quota snapshot can become stale at the exact moment the guard matters. Thanks to [@davidsh7](https://github.com/davidsh7) for catching this.

On Windows, write the path with **forward slashes** (Git Bash eats backslashes): `node "C:/Users/you/.claude/plugins/.../hooks/usage-guard-statusline.mjs"`.

**Already have a status line you like?** Don't lose it. Point the shim at your existing command with the `USAGE_GUARD_STATUSLINE` environment variable — the shim snapshots the quota, then runs your command and prints its output, so your status line still renders exactly as before:

```json
{
  "statusLine": {
    "type": "command",
    "command": "USAGE_GUARD_STATUSLINE='~/.claude/my-statusline.sh' node \"/ABSOLUTE/PATH/TO/usage-guard/hooks/usage-guard-statusline.mjs\"",
    "refreshInterval": 30
  }
}
```

(That env-var syntax works in Git Bash on Windows too. If Claude Code routes your status line through PowerShell instead, set the variable in a small `.cmd`/`.ps1` wrapper and point `command` at that.)

**Step 3 — sanity check.** Send Claude a message. Then run `/usage-guard:usage` (or `node .../lib/engine.mjs`). If you're on Pro/Max, you should now see a **"Real plan quota"** block at the top with your 5h and weekly percentages. If you don't see it yet, send one more message (the field only appears after the first API response) — and if it never appears, you're likely not on a Pro/Max plan, so the guard will use Mode 2.

> **Tune the threshold.** By default the guard warns once a window crosses **80%** (`planWarnPct: 0.8`). Lower it for an earlier heads-up, e.g. `{ "planWarnPct": 0.6 }` in `~/.claude/usage-guard.json`.

### Optional: gate each new subagent spawn

`SubagentStart` is context-only and cannot block. If you run staggered orchestrations, the plugin includes a `PreToolUse` gate that re-checks the quota snapshot immediately before each `Agent` or `Workflow` tool call:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Agent|Workflow",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/usage-guard-pretool-gate.mjs\" --max-weekly 85"
          }
        ]
      }
    ]
  }
}
```

Add `--max-5h 85` if you also want a hard 5-hour threshold. The hook denies only new spawns after a limit is reached; it cannot cancel subagents already running. Missing or stale quota data fails open. Thanks to [@davidsh7](https://github.com/davidsh7) for documenting this hook boundary.

### Fresh-window alert and optional phone delivery

The first real-quota snapshot establishes a baseline and stays silent. Later snapshots are compared locally; small reset-time corrections are ignored, while a real window advance or usage returning near zero produces one celebration per 5-hour / weekly window.

The in-session celebration is on by default. Set `"resetCelebration": false` to disable it. Phone delivery is off by default; to enable it, choose an unguessable [ntfy](https://ntfy.sh) topic and set either `"ntfyTopic": "your_private_topic"` in `usage-guard.json` or the `NTFY_TOPIC` environment variable. The destination is fixed to `ntfy.sh`, invalid topic shapes are rejected, and only the cheerful reset text is sent. Treat the topic as a password.

---

## 4. See your current numbers

Before picking a budget, look at what a normal session actually costs you.

**Route A (terminal plugin):** type in Claude Code:

```
/usage-guard:usage
```

**Route B (desktop / from a clone):** run in a terminal:

```bash
node /ABSOLUTE/PATH/TO/claude-code-usage-guard/lib/engine.mjs
```

Either way you'll see something like:

```
Claude Code usage — last 5h
  weighted spend : 4.5M  (1.2M/h burn rate)
  output tokens  : 183.0k
  input (fresh)  : 416.9k
  cache created  : 3.1M   cache read: 8.4M
  turns          : 126 across 4 session(s)
    claude-opus-4-8: 4.5M
```

The number that matters for setting a budget is **weighted spend** — here, **4.5M** for the last 5 hours. (`M` = million, `k` = thousand.) Keep that number in mind for the next step.

---

## 5. Set a fallback budget (Mode 2)

If you wired up the status line in §3.5 and you're on Pro/Max, you can mostly skip this section — Mode 1 already warns you against your real plan limit, no budget guessing needed. This section is the **fallback** for when real quota isn't available. (It's also still useful if you want a hard "weighted spend" or burn-rate cap on top.)

The fallback is silent until you tell it a budget. Here's the recipe.

**1. Look at a real session.** Run `/usage-guard:usage` (or `node .../lib/engine.mjs`) *after* a normal working session, and note the **weighted spend** number. Say it was **4.5M**.

**2. Create the config file.** It does not exist until you make it:

- macOS/Linux: `~/.claude/usage-guard.json`
- Windows: `%USERPROFILE%\.claude\usage-guard.json`

**3. Pick a budget a bit above a comfortable session.** If a comfortable session is ~4.5M, give yourself headroom and set, say, **6M**. Put this in the file:

```json
{
  "weightBudget": 6000000
}
```

(That's 6 followed by six zeros = 6 million.) You can optionally also cap your hourly pace:

```json
{
  "weightBudget": 6000000,
  "burnRatePerHour": 2000000
}
```

**4. That's it.** From now on, once your weighted spend in the rolling window crosses **80%** of the budget (the default `warnPct`), you'll get one warning, then quiet for the cooldown.

> **Key rule:** until `weightBudget` **or** `burnRatePerHour` is greater than `0`, the guard is intentionally silent. Setting either one (or both) is what turns the warnings on.

### All the config fields

The full file, with every field (all optional except that you need at least one of `weightBudget`/`burnRatePerHour` to get warnings):

```json
{
  "planWarnPct": 0.8,
  "windowHours": 5,
  "weightBudget": 6000000,
  "warnPct": 0.8,
  "burnRatePerHour": 2000000,
  "throttleMinutes": 10,
  "resetCelebration": true,
  "promptContext": true,
  "ntfyTopic": "",
  "quiet": false
}
```

| Field | Default | What it does |
|-------|---------|--------------|
| `planWarnPct` | `0.8` | **(Mode 1)** Warn once a real plan window (5h or weekly) crosses this fraction of the limit. |
| `windowHours` | `5` | *(Mode 2)* Rolling window the fallback measures over. Claude's usage limits are rolling (~5h). |
| `weightBudget` | `0` (off) | *(Mode 2)* Your soft cap of **weighted spend** in that window. Warns at `warnPct`. Only used when real quota is unavailable. |
| `warnPct` | `0.8` | Warn once you cross this fraction of the budget (0.8 = 80%). |
| `burnRatePerHour` | `0` (off) | Warn if your weighted spend **in the last hour** exceeds this. |
| `throttleMinutes` | `10` | Minimum minutes between warnings — the anti-spam cooldown. |
| `resetCelebration` | `true` | Announce a newly observed 5h / weekly window once. |
| `promptContext` | `true` | Give Claude fresh real-quota context on every prompt; set `false` to disable only this feature. |
| `ntfyTopic` | `""` (off) | Optional reset alert through `ntfy.sh`; `NTFY_TOPIC` overrides the file. |
| `quiet` | `false` | `true` = record state but emit no prompt context, warning, celebration, or phone alert; `/usage-guard:usage` still works. |

> **Note for desktop / custom-window users:** the `/usage-guard:usage` command (and the `node lib/engine.mjs` CLI) always reports a fixed **5-hour** view. If you set a different `windowHours`, that affects your *automatic warnings* but not what the command prints.

---

## 6. What "weighted spend" means

Instead of making you juggle five different token counts, usage-guard rolls them into one comparable number:

```
weight = input + output + cache_creation + (cache_read × 0.1)
```

Cache reads are roughly 10× cheaper than fresh input, so they only count at **0.1**. This is a **proxy for how much you're spending — not an exact bill, and not your plan quota.** It's the best you can do from the transcripts alone, which is exactly why Mode 1 (the real `rate_limits` from the status line, §3.5) is preferred when you can get it. The proxy is read straight from the `usage` field Claude Code already records for each turn in `~/.claude/projects/**/*.jsonl`.

---

## 7. Reading a warning (and tuning the noise)

When an alert fires, it's a single line. Four kinds:

- **Plan quota (Mode 1):** `⚠️ Plan 5h quota: 88% used · resets in 1h 29m` — a real plan window (5h or weekly) crossed `planWarnPct`. `🛑` instead of `⚠️` once you're at 100%.
- **Budget (Mode 2 fallback):** `🛑 Over budget: 120% (6.0M of 5.0M) in 5h` — you've passed your weighted budget in the rolling window. (Below 100% it reads `⚠️ Near budget: 85% ...`.)
- **Burn rate:** `⚠️ Burning fast: 2.3M/h (limit 2.0M/h)` — your spend *in the last hour* is over your `burnRatePerHour` cap.
- **Fresh window:** `🎉 Fresh quota! New window ready (weekly) — make the most of it.` — a new real-quota window was observed and will not be announced twice.

What to do when you see one? Usually one of: start a fresh session (drops the cache-read tail), batch your questions instead of many tiny turns, or stop re-reading huge files. You don't have to do anything — it's a nudge, not a wall.

**Too chatty?** Raise the cooldown so warnings come less often:

```json
{ "weightBudget": 6000000, "throttleMinutes": 30 }
```

**Want an earlier heads-up?** Lower `warnPct` (e.g. `0.6` warns at 60% of budget). **Want fewer false alarms?** Raise it toward `0.9`.

Config changes take effect on the **next** turn — no restart needed for the terminal plugin. (On the desktop manual route, a config edit is also picked up live; you only restart the app when you change `settings.json` itself.)

---

## 8. Disable or uninstall

**Just want all automatic output to stop (keep the plugin):**
Set `quiet` in `~/.claude/usage-guard.json`:

```json
{ "quiet": true }
```

Prompt context, warnings, celebrations, and phone alerts stop immediately; `/usage-guard:usage` still works.

**Uninstall — Route A (terminal plugin):**

```
/plugin uninstall usage-guard@cc-guard
```

and, if you also want to forget the marketplace entry:

```
/plugin marketplace remove cc-guard
```

**Uninstall — Route B (desktop manual hook):**
Open `~/.claude/settings.json` (Windows: `%USERPROFILE%\.claude\settings.json`), delete the `"Stop"` and `"UserPromptSubmit"` hook blocks you added in §3B Step 2, save, and **restart the app**.

Also remove the `statusLine` block from `settings.json` if you added it in §3.5.

**Optional cleanup (either route):** you can delete these files — they'll be recreated only if you reinstall:

- `~/.claude/.usage-guard-state.json` (the throttle's memory)
- `~/.claude/.usage-guard-limits.json` (the last real-quota snapshot)
- `~/.claude/usage-guard.json` (your config)

---

## 9. Troubleshooting

- **No warnings ever fire.** You probably haven't set a budget — `weightBudget` and `burnRatePerHour` are both `0` by default, which is *off*. See §5. Also check `quiet` isn't `true`. Fresh-window alerts additionally require the real-quota status-line shim and one earlier snapshot as a baseline.
- **Claude gets no quota context.** Confirm the real-quota sanity check in §3.5 works, `promptContext` isn't `false`, and the snapshot refresh is no older than 15 minutes. The hook intentionally stays silent on missing or stale data.
- **`/usage-guard:usage` says "command not found."** That command only exists on the terminal `/plugin` install (Route A). On the desktop manual route, run `node .../lib/engine.mjs` from your clone instead.
- **Desktop hook does nothing.** Confirm `node --version` works in a terminal (Node 18+ on PATH), confirm the path in `settings.json` is **absolute** and (on Windows) uses **doubled backslashes** `\\`, and make sure you **restarted the app** after editing `settings.json`.
- **"No usage found in the last 5h."** You simply haven't used Claude in the window yet, or transcripts live in a custom `CLAUDE_CONFIG_DIR` — point that env var the same way Claude Code does.

That's the whole thing. Enable real quota once, then forget it — Claude sees what remains and usage-guard taps you on the shoulder only when it matters.
