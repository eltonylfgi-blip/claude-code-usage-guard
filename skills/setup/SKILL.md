---
name: setup
description: One-command setup for usage-guard's real plan quota. Use this whenever the user runs /usage-guard:setup, asks to enable/activate/turn on the real 5-hour and weekly quota reading, asks to wire up the status line, or when /usage-guard:usage shows no "Real plan quota" block (only the weighted fallback). Detects the installed plugin and writes the status-line shim into the user's settings.json for them, preserving any existing status line, so they don't have to edit JSON by hand.
---

# usage-guard setup

Most people install usage-guard but never wire the one-time status-line shim, so the real plan quota never turns on and the guard stays silent. This skill does that wiring for them with as little friction as possible. Prefer doing the edit for the user (with a backup) over just printing instructions — the whole point is to remove the manual step.

## Steps

1. **Locate the installed status-line shim.** It lives under the user's Claude plugins dir. Run this (works on macOS, Linux and Windows):

   ```bash
   node -e "const fs=require('fs'),p=require('path'),os=require('os');const root=p.join(os.homedir(),'.claude','plugins');let hit;(function w(d){let es;try{es=fs.readdirSync(d,{withFileTypes:true})}catch(e){return}for(const x of es){if(x.name==='node_modules'||x.name==='.git')continue;const f=p.join(d,x.name);if(x.isDirectory())w(f);else if(x.name==='usage-guard-statusline.mjs')hit=f}})(root);console.log(hit||'NOT_FOUND')"
   ```

   If it prints `NOT_FOUND`, tell the user to run `/plugin install usage-guard@cc-guard` first, then retry.

2. **Open the user's settings.** Path: `~/.claude/settings.json` (Windows: `%USERPROFILE%\.claude\settings.json`). If it does not exist, create it as `{}`. **Always back it up first** (copy to `settings.json.bak`) before editing.

3. **Wire the `statusLine`, preserving any existing one:**
   - If there is NO existing `statusLine`, set it to run the shim directly:
     ```json
     "statusLine": { "type": "command", "command": "node \"<ABSOLUTE_PATH_FROM_STEP_1>\"" }
     ```
   - If a `statusLine.command` already exists, do NOT clobber it — chain it through the env var so their line still renders after the snapshot:
     ```json
     "statusLine": { "type": "command", "command": "USAGE_GUARD_STATUSLINE='<their existing command>' node \"<ABSOLUTE_PATH_FROM_STEP_1>\"" }
     ```
     (On Windows the env var is set in the wrapping shell — see TUTORIAL.md for the `.cmd` wrapper.)

4. **Confirm in one line.** Tell the user it's wired, and that after their next couple of Claude Code messages, `/usage-guard:usage` will start with a real `Real plan quota` block. Note that real quota only appears on Claude.ai Pro/Max sessions and only after the first API response; until then the weighted fallback is used.

## Rules
- **Idempotent.** If the `statusLine` already points at `usage-guard-statusline.mjs`, change nothing — just confirm it's set.
- **Only touch the `statusLine` key.** Never remove or overwrite unrelated settings. Keep the backup.
- **When in doubt, show don't guess.** If multiple installs are found or the settings look unusual, print the exact block for the user to paste instead of editing blindly.
- This wires the free real-quota reading. If it still doesn't surface after setup, the user's machine may not expose `rate_limits` yet — that is the case the optional hands-on setup service covers.
