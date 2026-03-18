import type { Fail } from "./types.js"

export function normalizeStatus(status: number, body: string, code = "") {
  if (status !== 404) return status
  const text = `${code} ${body}`.toLowerCase()
  if (/usage_limit_reached|usage_not_included|rate_limit_exceeded|usage limit/i.test(text)) return 429
  return status
}

export function cooldownMs(headers: Headers) {
  const ms = headers.get("retry-after-ms")
  if (ms) {
    const value = Number.parseFloat(ms)
    if (!Number.isNaN(value)) return value
  }

  const sec = headers.get("retry-after")
  if (sec) {
    const value = Number.parseFloat(sec)
    if (!Number.isNaN(value)) return Math.ceil(value * 1000)
    const date = Date.parse(sec) - Date.now()
    if (!Number.isNaN(date) && date > 0) return Math.ceil(date)
  }

  const reset = headers.get("x-codex-primary-reset-after-seconds")
  if (!reset) return 0
  const value = Number.parseFloat(reset)
  return Number.isNaN(value) ? 0 : Math.ceil(value * 1000)
}

export function classify(input: { status: number; headers: Headers; code: string; body: string }, wait = 300_000): Fail {
  const status = normalizeStatus(input.status, input.body, input.code)
  if (status === 401 || status === 403) return { kind: "hard-switch" }
  if (input.code === "insufficient_quota" || input.code === "usage_not_included") return { kind: "hard-switch" }
  if (status !== 429) return { kind: "no-switch" }
  const ms = cooldownMs(input.headers)
  if (ms >= wait) return { kind: "cooldown-switch", wait: ms }
  if (ms > 0) return { kind: "same-account-retry", wait: ms }
  return { kind: "same-account-retry", wait: 2000 }
}
