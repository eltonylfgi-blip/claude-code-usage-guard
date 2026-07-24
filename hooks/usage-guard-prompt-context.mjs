#!/usr/bin/env node
// Inject a fresh, compact quota snapshot into Claude's context on each user prompt.
// Fail-open by design: stale, malformed, missing, or disabled data produces no output.

import { loadConfig } from "../lib/config.mjs";
import { readLimits } from "../lib/engine.mjs";
import { buildQuotaContext, PROMPT_CONTEXT_MAX_AGE_SEC } from "../lib/quota-context.mjs";

function main() {
  const config = loadConfig();
  if (config.quiet || !config.promptContext) return;

  const nowSec = Math.floor(Date.now() / 1000);
  const limits = readLimits({ maxAgeSec: PROMPT_CONTEXT_MAX_AGE_SEC });
  const capturedAt = Number(limits?.capturedAt);
  const ageSec = nowSec - capturedAt;

  // Reject snapshots without a trustworthy timestamp, including implausible future data.
  if (!limits || !Number.isFinite(capturedAt) || ageSec < -60 || ageSec > PROMPT_CONTEXT_MAX_AGE_SEC) return;

  const additionalContext = buildQuotaContext(limits, { nowSec });
  if (!additionalContext) return;

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext,
    },
  }));
}

try {
  main();
} catch {
  // Never block a user's prompt because quota context failed.
}

process.exitCode = 0;
