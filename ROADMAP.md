# Roadmap

Direction-level and honest — no promised dates. Ordered by what users hit first. Suggest or vote via [Issues](../../issues).

## Shipped

- **Fresh-window coach (v0.4.0).** Detects newly observed 5-hour / weekly quota windows, celebrates once in-session, and can optionally send the same reset-only message to `ntfy.sh`. The phone path is off by default.

## Next

- **Battle-test real-quota mode.** The `rate_limits` capture follows the official status-line schema, but it's new — I want real-world setups (OS × plan × existing status-line configs). Each report becomes a fixture and a test.
- **Remove the manual path step.** Auto-detect the installed plugin path for the status-line shim, so the one-time wiring stops requiring an absolute path.

## Later

- **Localized warnings.** The fresh-window celebration is the first Spanish string; localize the warning set only after field reports show demand, with strings structured so other languages remain a small PR.

## Non-goals

- **Cloud state or mandatory network.** The core stays zero-dependency and local-only. Optional notification delivery must remain explicit, narrow, and off by default.
- **A dashboard.** usage-guard interrupts you when it matters; [ccusage](https://github.com/ryoppippi/ccusage) and the status-line monitors already do passive display well.

- **ETA-to-cutoff** *(suggested by an external review, 2026-07-06)*: beyond the even-pace readout, show "at this rate you run out in ~40m" — needs ≥2 quota snapshots to derive a real plan-burn rate (the current burn-rate proxy is transcript-weighted, not plan-%). Small pure function + state; high perceived value.
