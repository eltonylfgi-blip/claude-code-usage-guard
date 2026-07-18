// Detect fresh Claude plan windows from consecutive local rate-limit snapshots.
// The detector is deliberately conservative: a first observation is only a baseline,
// small reset-time corrections are ignored, and each observed window is announced once.

const WINDOW_SPECS = {
  fiveHour: { label: "5h", seconds: 5 * 3600 },
  sevenDay: { label: "weekly", seconds: 7 * 24 * 3600 },
};

const FRESH_PCT = 5;
const LOW_AFTER_ADVANCE_PCT = 15;
const MIN_DROP_PCT = 15;
const MIN_PREVIOUS_USAGE_PCT = 20;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function observedWindow(raw) {
  if (!raw) return null;
  const usedPct = finite(raw.usedPct);
  if (usedPct === null) return null;
  const resetsAt = finite(raw.resetsAt);
  return {
    usedPct: Math.max(0, Math.min(100, usedPct)),
    ...(resetsAt === null ? {} : { resetsAt }),
  };
}

function celebrationKey(name, current, nowSec) {
  if (Number.isFinite(current.resetsAt)) return `${name}:${Math.round(current.resetsAt)}`;
  return `${name}:usage:${Math.floor(nowSec / WINDOW_SPECS[name].seconds)}`;
}

export function detectQuotaResets({ limits, previous = {}, nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const next = { ...(previous && typeof previous === "object" ? previous : {}) };
  const resetLabels = [];

  for (const [name, spec] of Object.entries(WINDOW_SPECS)) {
    const current = observedWindow(limits?.[name]);
    if (!current) continue;

    const before = observedWindow(previous?.[name]);
    const lastCelebratedKey =
      typeof previous?.[name]?.lastCelebratedKey === "string" ? previous[name].lastCelebratedKey : "";
    let isReset = false;

    if (before) {
      const drop = before.usedPct - current.usedPct;
      const usageReturnedNearZero =
        before.usedPct >= MIN_PREVIOUS_USAGE_PCT && current.usedPct <= FRESH_PCT && drop >= MIN_DROP_PCT;

      const resetAdvance =
        Number.isFinite(before.resetsAt) && Number.isFinite(current.resetsAt)
          ? current.resetsAt - before.resetsAt
          : 0;
      const windowAdvanced =
        resetAdvance >= spec.seconds / 2 &&
        (current.usedPct <= LOW_AFTER_ADVANCE_PCT || drop >= MIN_DROP_PCT);
      const crossedKnownBoundary =
        Number.isFinite(before.resetsAt) &&
        Number.isFinite(current.resetsAt) &&
        before.resetsAt <= nowSec + 60 &&
        current.resetsAt > nowSec + 60 &&
        resetAdvance >= 60 &&
        (current.usedPct <= LOW_AFTER_ADVANCE_PCT || drop >= MIN_DROP_PCT);

      isReset = usageReturnedNearZero || windowAdvanced || crossedKnownBoundary;
    }

    const key = celebrationKey(name, current, nowSec);
    if (isReset && key !== lastCelebratedKey) resetLabels.push(spec.label);

    next[name] = {
      ...current,
      ...(isReset ? { lastCelebratedKey: key } : lastCelebratedKey ? { lastCelebratedKey } : {}),
    };
  }

  return { resetLabels, next };
}

export function buildResetMessage(resetLabels) {
  const labels = Array.isArray(resetLabels) ? resetLabels.filter(Boolean) : [];
  const suffix = labels.length ? ` (${labels.join(" + ")})` : "";
  return `🎉 ¡Cuota fresca! Ventana nueva lista${suffix} — aprovéchala.`;
}

export function isValidNtfyTopic(topic) {
  return typeof topic === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(topic);
}

export async function sendNtfy(message, { topic, fetchImpl = globalThis.fetch, timeoutMs = 1500 } = {}) {
  if (!isValidNtfyTopic(topic) || typeof fetchImpl !== "function") return false;

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), Math.max(100, timeoutMs)) : null;
  try {
    const response = await fetchImpl(`https://ntfy.sh/${topic}`, {
      method: "POST",
      body: String(message),
      headers: { Title: "usage-guard", Tags: "tada" },
      ...(controller ? { signal: controller.signal } : {}),
    });
    return Boolean(response?.ok);
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
