#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildResetMessage,
  detectQuotaResets,
  isValidNtfyTopic,
  sendNtfy,
} from "../lib/reset-coach.mjs";

let passed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    failures.push(`${name}: ${error.message}`);
  }
}

const NOW = 2_000_000_000;
const FIVE_H = 5 * 3600;
const WEEK = 7 * 24 * 3600;
const HOOK = fileURLToPath(new URL("../hooks/usage-guard-hook.mjs", import.meta.url));

function runHook(configDir) {
  return execFileSync(process.execPath, [HOOK], {
    encoding: "utf8",
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, NTFY_TOPIC: "" },
    timeout: 5000,
  }).trim();
}

function writeLimits(configDir, limits) {
  writeFileSync(
    join(configDir, ".usage-guard-limits.json"),
    JSON.stringify({ capturedAt: Math.floor(Date.now() / 1000), ...limits }),
    "utf8"
  );
}

await check("first observation establishes a silent baseline", () => {
  const result = detectQuotaResets({
    limits: {
      fiveHour: { usedPct: 82, resetsAt: NOW + 1200 },
      sevenDay: { usedPct: 44, resetsAt: NOW + 3 * 24 * 3600 },
    },
    previous: {},
    nowSec: NOW,
  });
  assert.deepEqual(result.resetLabels, []);
  assert.equal(result.next.fiveHour.usedPct, 82);
  assert.equal(result.next.sevenDay.usedPct, 44);
});

await check("a new 5h window with a usage drop celebrates", () => {
  const result = detectQuotaResets({
    limits: { fiveHour: { usedPct: 3, resetsAt: NOW + FIVE_H } },
    previous: { fiveHour: { usedPct: 91, resetsAt: NOW - 10 } },
    nowSec: NOW,
  });
  assert.deepEqual(result.resetLabels, ["5h"]);
});

await check("a new weekly window celebrates", () => {
  const result = detectQuotaResets({
    limits: { sevenDay: { usedPct: 2, resetsAt: NOW + WEEK } },
    previous: { sevenDay: { usedPct: 87, resetsAt: NOW - 30 } },
    nowSec: NOW,
  });
  assert.deepEqual(result.resetLabels, ["weekly"]);
});

await check("simultaneous windows produce one combined event", () => {
  const result = detectQuotaResets({
    limits: {
      fiveHour: { usedPct: 1, resetsAt: NOW + FIVE_H },
      sevenDay: { usedPct: 1, resetsAt: NOW + WEEK },
    },
    previous: {
      fiveHour: { usedPct: 100, resetsAt: NOW - 1 },
      sevenDay: { usedPct: 100, resetsAt: NOW - 1 },
    },
    nowSec: NOW,
  });
  assert.deepEqual(result.resetLabels, ["5h", "weekly"]);
  assert.match(buildResetMessage(result.resetLabels), /5h \+ weekly/);
});

await check("the same reset window never celebrates twice", () => {
  const first = detectQuotaResets({
    limits: { fiveHour: { usedPct: 2, resetsAt: NOW + FIVE_H } },
    previous: { fiveHour: { usedPct: 95, resetsAt: NOW - 1 } },
    nowSec: NOW,
  });
  const second = detectQuotaResets({
    limits: { fiveHour: { usedPct: 4, resetsAt: NOW + FIVE_H } },
    previous: first.next,
    nowSec: NOW + 60,
  });
  assert.deepEqual(second.resetLabels, []);
});

await check("small reset-time jitter without a usage drop stays silent", () => {
  const result = detectQuotaResets({
    limits: { fiveHour: { usedPct: 63, resetsAt: NOW + 1900 } },
    previous: { fiveHour: { usedPct: 61, resetsAt: NOW + 1800 } },
    nowSec: NOW,
  });
  assert.deepEqual(result.resetLabels, []);
});

await check("usage returning near zero can identify a provider reset", () => {
  const result = detectQuotaResets({
    limits: { fiveHour: { usedPct: 1, resetsAt: NOW + 1800 } },
    previous: { fiveHour: { usedPct: 70, resetsAt: NOW + 1800 } },
    nowSec: NOW,
  });
  assert.deepEqual(result.resetLabels, ["5h"]);
});

await check("missing live windows preserve their prior baseline", () => {
  const previous = {
    fiveHour: { usedPct: 10, resetsAt: NOW + 1000 },
    sevenDay: { usedPct: 20, resetsAt: NOW + 2000 },
  };
  const result = detectQuotaResets({
    limits: { fiveHour: { usedPct: 11, resetsAt: NOW + 1000 } },
    previous,
    nowSec: NOW,
  });
  assert.deepEqual(result.next.sevenDay, previous.sevenDay);
});

await check("ntfy topics reject URL injection and accept opaque topic names", () => {
  assert.equal(isValidNtfyTopic("usage_guard-267"), true);
  assert.equal(isValidNtfyTopic("https://evil.example/x"), false);
  assert.equal(isValidNtfyTopic("bad/topic"), false);
  assert.equal(isValidNtfyTopic(""), false);
});

await check("ntfy stays completely off when no topic is configured", async () => {
  let calls = 0;
  const sent = await sendNtfy("hello", {
    topic: "",
    fetchImpl: async () => {
      calls += 1;
      return { ok: true };
    },
  });
  assert.equal(sent, false);
  assert.equal(calls, 0);
});

await check("ntfy posts only to the fixed ntfy.sh origin", async () => {
  let request;
  const sent = await sendNtfy("fresh quota", {
    topic: "usage_guard-267",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true };
    },
  });
  assert.equal(sent, true);
  assert.equal(request.url, "https://ntfy.sh/usage_guard-267");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.body, "fresh quota");
});

await check("Stop hook establishes a baseline, celebrates once, then stays silent", () => {
  const dir = mkdtempSync(join(tmpdir(), "ug-reset-hook-"));
  try {
    const now = Math.floor(Date.now() / 1000);
    writeLimits(dir, { fiveHour: { usedPct: 70, resetsAt: now - 10 } });
    assert.equal(runHook(dir), "", "the first observed snapshot must not celebrate");

    writeLimits(dir, { fiveHour: { usedPct: 2, resetsAt: now + FIVE_H } });
    const output = JSON.parse(runHook(dir));
    assert.equal(output.systemMessage, buildResetMessage(["5h"]));
    assert.equal(runHook(dir), "", "the same window must be announced only once");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await check("reset celebration bypasses the ordinary warning throttle", () => {
  const dir = mkdtempSync(join(tmpdir(), "ug-reset-throttle-"));
  try {
    const now = Math.floor(Date.now() / 1000);
    writeFileSync(
      join(dir, ".usage-guard-state.json"),
      JSON.stringify({
        last: Date.now(),
        resetWindows: { fiveHour: { usedPct: 95, resetsAt: now - 1 } },
      }),
      "utf8"
    );
    writeLimits(dir, { fiveHour: { usedPct: 1, resetsAt: now + FIVE_H } });
    const output = JSON.parse(runHook(dir));
    assert.match(output.systemMessage, /Cuota fresca/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await check("quiet mode records the reset but emits nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "ug-reset-quiet-"));
  try {
    const now = Math.floor(Date.now() / 1000);
    writeFileSync(join(dir, "usage-guard.json"), JSON.stringify({ quiet: true }), "utf8");
    writeFileSync(
      join(dir, ".usage-guard-state.json"),
      JSON.stringify({ resetWindows: { sevenDay: { usedPct: 85, resetsAt: now - 1 } } }),
      "utf8"
    );
    writeLimits(dir, { sevenDay: { usedPct: 1, resetsAt: now + WEEK } });
    assert.equal(runHook(dir), "");
    const state = JSON.parse(readFileSync(join(dir, ".usage-guard-state.json"), "utf8"));
    assert.match(state.resetWindows.sevenDay.lastCelebratedKey, /^sevenDay:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await check("an active state lock prevents concurrent duplicate celebrations", () => {
  const dir = mkdtempSync(join(tmpdir(), "ug-reset-lock-"));
  try {
    const now = Math.floor(Date.now() / 1000);
    writeFileSync(
      join(dir, ".usage-guard-state.json"),
      JSON.stringify({ resetWindows: { fiveHour: { usedPct: 90, resetsAt: now - 1 } } }),
      "utf8"
    );
    writeLimits(dir, { fiveHour: { usedPct: 1, resetsAt: now + FIVE_H } });
    const lock = join(dir, ".usage-guard-state.json.lock");
    writeFileSync(lock, String(Date.now()), "utf8");

    assert.equal(runHook(dir), "", "a second hook must let the lock owner handle the reset");
    rmSync(lock, { force: true });
    assert.match(JSON.parse(runHook(dir)).systemMessage, /Cuota fresca/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

if (failures.length) {
  console.error(`reset coach tests: ${passed} passed, ${failures.length} FAILED`);
  for (const failure of failures) console.error(`  x ${failure}`);
  process.exit(1);
}

console.log(`reset coach tests: ${passed}/${passed} checks passed.`);
