import { describe, expect, it } from "bun:test"
import { classify, cooldownMs, normalizeStatus } from "../src/fail.ts"

describe("fail", () => {
  it("maps usage-limit 404 responses to 429", () => {
    expect(normalizeStatus(404, JSON.stringify({ error: { code: "usage_limit_reached" } }))).toBe(429)
    expect(normalizeStatus(404, JSON.stringify({ error: { code: "other" } }))).toBe(404)
  })

  it("parses cooldown headers", () => {
    expect(cooldownMs(new Headers({ "retry-after-ms": "1200" }))).toBe(1200)
    expect(cooldownMs(new Headers({ "retry-after": "2" }))).toBe(2000)
    expect(cooldownMs(new Headers({ "x-codex-primary-reset-after-seconds": "4" }))).toBe(4000)
  })

  it("classifies hard failures and cooldown switches", () => {
    expect(classify({ status: 401, headers: new Headers(), code: "", body: "" }).kind).toBe("hard-switch")
    expect(
      classify({
        status: 429,
        headers: new Headers({ "retry-after": "600" }),
        code: "",
        body: "",
      }).kind,
    ).toBe("cooldown-switch")
    expect(classify({ status: 500, headers: new Headers(), code: "", body: "" }).kind).toBe("no-switch")
  })
})
