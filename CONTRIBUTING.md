# Contributing

The single most useful contribution right now is a **real-world `rate_limits` report**, especially whether fresh quota context changed a useful pacing decision Claude made. The in-session capture is new and hasn't been battle-tested across many setups, so concrete data is what moves it forward.

## Report a rate_limits setup

Open an issue with:

- your OS and Claude plan (Pro / Max 5x / Max 20x),
- whether the `plan 5h` / `plan weekly` lines appeared in `/usage-guard:usage` (or `node lib/engine.mjs`),
- if a window didn't surface, the shape of your `~/.claude/.usage-guard-limits.json` (redact numbers if you like — the structure is what matters).

Each report becomes a fixture in `tests/selftest.mjs`, so the behavior you hit is locked in for everyone after you.

## Code changes

- Keep the [engineering principles](./ENGINEERING_PRINCIPLES.md): local-first, zero dependencies, fail-open, warn-don't-block.
- Run `npm test` before opening a PR — the full zero-dependency suite must stay green.
- New behavior needs a check in `tests/selftest.mjs` or a focused test file under `tests/`. If it can fail, it needs a test.

Small, focused PRs are easiest to review. Bug reports and ideas are just as welcome as code.
