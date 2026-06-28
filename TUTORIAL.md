# usage-guard — Beginner's Tutorial

A friendly, copy-paste guide to installing and using **usage-guard**, the little Claude Code plugin that taps you on the shoulder when you're burning through your usage too fast.

No prior plugin experience needed. We cover **both** places you might run Claude:

- **A. The terminal Claude Code CLI** (the `claude` command in your terminal) — easy `/plugin` install.
- **B. The Claude Desktop app** — `/plugin` isn't available there, so we wire it up by hand. Still copy-paste, still ~5 minutes.

---

## 1. What this plugin actually does

Every time Claude finishes a turn, usage-guard quietly looks at how many tokens you've used recently (it reads the local transcript files Claude Code already writes — no network, no accounts). If you've crossed a budget you set, or you're burning unusually fast, it prints **one short line** like:

```
🛑 Over budget: 120% (6.0M of 5.0M) in 5h
```

or

```
⚠️ Burning fast: 2.3M/h (limit 2.0M/h)
```

Then it stays quiet for a cooldown so it never spams you. You also get a command, **`/usage-guard:usage`**, to check your numbers whenever you want.

A few things worth knowing up front:

- **It's a guard, not a bill.** There is no public per-plan usage API, so the plugin computes a single comparable number called **weighted spend** (explained in §6) and compares it against a budget **you** choose. Think "reading your own meter."
- **It's silent until you give it a budget.** Out of the box `weightBudget` is `0`, which means *off*. The automatic warnings only start once you set a budget (§5). The `/usage-guard:usage` command works immediately, though.
- **It's safe.** Zero dependencies, reads only your local files, makes no network calls. If anything ever goes wrong it stays silent and exits cleanly (fail-open), and the hook is capped at a 5-second timeout — so in practice it won't disrupt your session.

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

That's it — the Stop hook is active immediately, and you now have the `/usage-guard:usage` command. It will stay quiet until you set a budget (§5).

**Sanity check:** type `/usage-guard:usage` and press Enter. You should get a usage summary back. If you do, the install worked. (Skip to §4.)

---

## 3B. Install — Route B: Claude Desktop app (no `/plugin`)

The desktop app doesn't have the `/plugin` command, so we wire the hook in manually. It's two steps: **(1)** get the plugin files onto your machine, **(2)** point a Stop hook at them in your settings file.

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

### Step 2 — Wire the Stop hook into `settings.json`

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
    ]
  }
}
```

**Windows note — backslashes.** JSON treats `\` as an escape character, so in a Windows path you must **double** every backslash:

```json
            "args": ["C:\\Users\\you\\claude-code-usage-guard\\hooks\\usage-guard-hook.mjs"],
```

**Why `"command": "node"` and a separate `"args"` array?** Two reasons. First, `settings.json` uses the *split* form (command + args) — that's different from the plugin's own `hooks/hooks.json`, which uses a single shell string. Second, on Windows the script's `#!/usr/bin/env node` shebang line is ignored, so you must invoke Node explicitly. Using `node` + the absolute path works identically on Windows, macOS, and Linux.

Save the file and **restart the Claude Desktop app** so it picks up the new hook.

### What you get (and don't) on the manual route

- You **do** get the automatic in-session warnings (the whole point).
- You **don't** get the `/usage-guard:usage` slash command — that only ships with the `/plugin` install. To check your numbers on demand, run the engine directly from your clone:

  ```bash
  node /ABSOLUTE/PATH/TO/claude-code-usage-guard/lib/engine.mjs
  ```

  (On Windows: `node C:\Users\you\claude-code-usage-guard\lib\engine.mjs`.)

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

## 5. Set your budget (the one bit of setup that matters)

The guard is silent until you tell it a budget. Here's the recipe.

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
  "windowHours": 5,
  "weightBudget": 6000000,
  "warnPct": 0.8,
  "burnRatePerHour": 2000000,
  "throttleMinutes": 10,
  "quiet": false
}
```

| Field | Default | What it does |
|-------|---------|--------------|
| `windowHours` | `5` | Rolling window the hook measures over. Claude's usage limits are rolling (~5h). |
| `weightBudget` | `0` (off) | Your soft cap of **weighted spend** in that window. Warns at `warnPct`. |
| `warnPct` | `0.8` | Warn once you cross this fraction of the budget (0.8 = 80%). |
| `burnRatePerHour` | `0` (off) | Warn if your weighted spend **in the last hour** exceeds this. |
| `throttleMinutes` | `10` | Minimum minutes between warnings — the anti-spam cooldown. |
| `quiet` | `false` | `true` = compute but never warn (handy off-switch; `/usage-guard:usage` still works). |

> **Note for desktop / custom-window users:** the `/usage-guard:usage` command (and the `node lib/engine.mjs` CLI) always reports a fixed **5-hour** view. If you set a different `windowHours`, that affects your *automatic warnings* but not what the command prints.

---

## 6. What "weighted spend" means

Instead of making you juggle five different token counts, usage-guard rolls them into one comparable number:

```
weight = input + output + cache_creation + (cache_read × 0.1)
```

Cache reads are roughly 10× cheaper than fresh input, so they only count at **0.1**. This is a **proxy for how much you're spending, not an exact bill** — there's no public per-plan usage API to get the real number, so this is the honest approximation. It's read straight from the `usage` field Claude Code already records for each turn in `~/.claude/projects/**/*.jsonl`.

---

## 7. Reading a warning (and tuning the noise)

When a warning fires, it's a single line. Two kinds:

- **Budget:** `🛑 Over budget: 120% (6.0M of 5.0M) in 5h` — you've passed your budget in the rolling window. (Below 100% it reads `⚠️ Near budget: 85% ...`.)
- **Burn rate:** `⚠️ Burning fast: 2.3M/h (limit 2.0M/h)` — your spend *in the last hour* is over your `burnRatePerHour` cap.

What to do when you see one? Usually one of: start a fresh session (drops the cache-read tail), batch your questions instead of many tiny turns, or stop re-reading huge files. You don't have to do anything — it's a nudge, not a wall.

**Too chatty?** Raise the cooldown so warnings come less often:

```json
{ "weightBudget": 6000000, "throttleMinutes": 30 }
```

**Want an earlier heads-up?** Lower `warnPct` (e.g. `0.6` warns at 60% of budget). **Want fewer false alarms?** Raise it toward `0.9`.

Config changes take effect on the **next** turn — no restart needed for the terminal plugin. (On the desktop manual route, a config edit is also picked up live; you only restart the app when you change `settings.json` itself.)

---

## 8. Disable or uninstall

**Just want the warnings to stop (keep the plugin):**
Set `quiet` in `~/.claude/usage-guard.json`:

```json
{ "quiet": true }
```

Warnings stop immediately; `/usage-guard:usage` still works.

**Uninstall — Route A (terminal plugin):**

```
/plugin uninstall usage-guard@cc-guard
```

and, if you also want to forget the marketplace entry:

```
/plugin marketplace remove cc-guard
```

**Uninstall — Route B (desktop manual hook):**
Open `~/.claude/settings.json` (Windows: `%USERPROFILE%\.claude\settings.json`), delete the `"Stop"` hook block you added in §3B Step 2, save, and **restart the app**.

**Optional cleanup (either route):** you can delete these two files — they'll be recreated only if you reinstall:

- `~/.claude/.usage-guard-state.json` (the throttle's memory)
- `~/.claude/usage-guard.json` (your config)

---

## 9. Troubleshooting

- **No warnings ever fire.** You probably haven't set a budget — `weightBudget` and `burnRatePerHour` are both `0` by default, which is *off*. See §5. Also check `quiet` isn't `true`.
- **`/usage-guard:usage` says "command not found."** That command only exists on the terminal `/plugin` install (Route A). On the desktop manual route, run `node .../lib/engine.mjs` from your clone instead.
- **Desktop hook does nothing.** Confirm `node --version` works in a terminal (Node 18+ on PATH), confirm the path in `settings.json` is **absolute** and (on Windows) uses **doubled backslashes** `\\`, and make sure you **restarted the app** after editing `settings.json`.
- **"No usage found in the last 5h."** You simply haven't used Claude in the window yet, or transcripts live in a custom `CLAUDE_CONFIG_DIR` — point that env var the same way Claude Code does.

That's the whole thing. Set a budget once, then forget it — usage-guard taps you on the shoulder only when it matters.
