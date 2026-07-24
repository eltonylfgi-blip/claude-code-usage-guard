# Engineering principles

Six constraints every tool I publish is built under ([usage-guard](https://github.com/eltonylfgi-blip/claude-code-usage-guard), [session-triage](https://github.com/eltonylfgi-blip/claude-session-triage), [usage-pacer](https://github.com/eltonylfgi-blip/claude-usage-pacer)). None is aspirational — each one names where it's implemented, so you can check.

## 1. Local-first, zero dependencies

**Why it exists:** a tool that watches your usage or reads your sessions must not add hidden attack surface or phone home without an explicit opt-in.

**Where it appears:** usage-guard and session-triage have zero dependencies. usage-guard's core and status-line paths stay local; its single optional network path sends only a fixed reset message to `ntfy.sh` when the user configures an opaque topic. usage-pacer is a single local HTML file with strictly optional sync.

## 2. Fail-open

**Why it exists:** a helper must never break the thing it helps.

**Where it appears:** usage-guard's `Stop` hook is hard-capped at 5 seconds and its `UserPromptSubmit` hook at 2 seconds; both swallow their own errors, so a broken helper cannot break the session or prompt. The prompt hook also rejects missing, malformed, future, or >15-minute-old quota snapshots. Its status-line shim reprints your existing status line even when it fails.

## 3. Warn, don't block

**Why it exists:** the human stays in control — tools surface signal, they don't take decisions.

**Where it appears:** usage-guard's default path provides quota context and warnings, never a lock. Its separate per-spawn subagent gate is explicit opt-in for users who deliberately want enforcement. session-triage only reports; by design it cannot stop anything.

## 4. One real friction per tool

**Why it exists:** tools built from ideas rot; tools built from pain get maintained.

**Where it appears:** every README opens with the concrete friction (quota cutoffs mid-task, idle-session sprawl, weekly pacing). All three survived weeks of my own daily use before shipping.

## 5. Honest READMEs

**Why it exists:** trust compounds — oversell once and every later claim gets discounted.

**Where it appears:** usage-guard flags its own real-quota mode as new and not yet battle-tested, compares fairly against ccusage and status-line monitors (including when you *don't* need usage-guard), and keeps public non-goals in [ROADMAP.md](./ROADMAP.md).

## 6. Every lesson becomes a file, a test, or a tool

**Why it exists:** if it only lives in a chat, it doesn't exist — an improvement must survive the conversation that produced it.

**Where it appears:** usage-guard's 63 checks (`npm test`) pin weighting, anti-inflation dedup, fail-open parsing, real-quota handling, prompt privacy and freshness, reset detection, concurrent anti-repeat state, and opt-in-only notification behavior; session-triage has its fixture suite; every real field report is expected to become a fixture and test. These repos are the artifact.
