# Design principles

Six rules that hold across every tool I publish ([usage-guard](https://github.com/eltonylfgi-blip/claude-code-usage-guard), [session-triage](https://github.com/eltonylfgi-blip/claude-session-triage), [usage-pacer](https://github.com/eltonylfgi-blip/claude-usage-pacer)). None of them is aspirational — each one is checkable against the code and READMEs today.

1. **Local-first, zero dependencies.** Nothing that runs inside your session phones home. usage-guard and session-triage make no network calls at all; usage-pacer is a single local HTML file with sync strictly optional.

2. **Fail-open, always.** A helper tool must never break the thing it helps. usage-guard's hook is hard-capped at 5 seconds and swallows its own errors; if anything goes wrong, your session continues as if the tool weren't there.

3. **Warn, don't block.** Surface the signal and keep the human in control. session-triage never stops you from doing anything — it only reports. usage-guard interrupts with a message, not a lock.

4. **One real friction per tool.** A tool gets built only after the friction has survived weeks of my own daily use — not because an idea sounded good. If the pain stops being real, the tool doesn't ship.

5. **Honest READMEs.** Say what's new and untested (usage-guard's real-quota mode carries an explicit heads-up), compare fairly with alternatives (ccusage, status-line monitors — including when you *don't* need my tool), and keep a public list of non-goals.

6. **Every lesson becomes a file, a test, or a tool.** If it only lives in a chat, it doesn't exist. This is the house rule the whole workflow runs on — it's why these repos exist at all.
