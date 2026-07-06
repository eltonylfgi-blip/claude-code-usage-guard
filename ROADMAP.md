# Roadmap

Direction-level and honest — no promised dates. Ordered by what users hit first. Suggest or vote via [Issues](../../issues).

## Next

- **Battle-test real-quota mode.** The `rate_limits` capture follows the official status-line schema, but it's new — I want real-world setups (OS × plan × existing status-line configs). Each report becomes a fixture and a test.
- **Remove the manual path step.** Auto-detect the installed plugin path for the status-line shim, so the one-time wiring stops requiring an absolute path.

## Later

- **Optional notification channel.** Fire the same threshold warning to a desktop/phone notifier (e.g. [ntfy](https://ntfy.sh)) for long-running sessions you're not watching. Off by default — the core stays no-network.
- **Localized warnings.** Spanish first (my own daily language), with the strings structured so other languages are a small PR.

## Non-goals

- **Cloud anything.** The core stays zero-dependency, local-only, no network calls.
- **A dashboard.** usage-guard interrupts you when it matters; [ccusage](https://github.com/ryoppippi/ccusage) and the status-line monitors already do passive display well.

- **ETA-to-cutoff** *(suggested by an external review, 2026-07-06)*: beyond the even-pace readout, show "at this rate you run out in ~40m" — needs ≥2 quota snapshots to derive a real plan-burn rate (the current burn-rate proxy is transcript-weighted, not plan-%). Small pure function + state; high perceived value.
