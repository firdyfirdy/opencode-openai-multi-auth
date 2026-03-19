import { afterEach, describe, expect, it, mock } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import plugin from "../src/index.ts"
import { applyManage } from "../src/manage-result.ts"
import { active, setActive, upsert } from "../src/store.ts"

type Input = Parameters<typeof plugin>[0]

describe("runtime", () => {
  afterEach(() => {
    delete process.env.OPENCODE_MULTI_AUTH_PATH
  })

  it("clears mirrored auth when manage ends with no active account", async () => {
    const old = globalThis.fetch
    const calls: Array<{ url: string; method: string | undefined }> = []
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url,
        method: init?.method,
      })
      return new Response("true", { status: 200 })
    }) as unknown as typeof fetch

    const result = await applyManage(
      {
        client: {
          auth: {
            set: async () => undefined as never,
            remove: async () => undefined as never,
          },
        },
        project: {},
        directory: process.cwd(),
        worktree: process.cwd(),
        serverUrl: new URL("http://localhost:4096"),
        $: {},
      } as unknown as Input,
      undefined,
      async (input) => {
        await fetch(new URL("/auth/openai", input.serverUrl), { method: "DELETE" })
      },
    )

    expect(result).toEqual({ type: "failed" })
    expect(calls).toEqual([{ url: "http://localhost:4096/auth/openai", method: "DELETE" }])
    globalThis.fetch = old
  })

  it("switches to another saved account when refresh fails", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "multi-auth-runtime-"))
    const file = path.join(dir, "auth.json")
    process.env.OPENCODE_MULTI_AUTH_PATH = file
    await upsert(file, {
      id: "a1",
      kind: "oauth",
      label: "A1",
      access: "stale",
      refresh: "bad-refresh",
      expires: 0,
      account_id: "acct-1",
      added_at: 1,
      last_used: 1,
    })
    await upsert(file, {
      id: "a2",
      kind: "oauth",
      label: "A2",
      access: "good-access",
      refresh: "good-refresh",
      expires: Date.now() + 60_000,
      account_id: "acct-2",
      added_at: 2,
      last_used: 2,
    })
    await setActive(file, "a1")

    const sets: Array<unknown> = []
    const hooks = await plugin({
      client: {
        auth: {
          set: async (input: unknown) => {
            sets.push(input)
            return undefined as never
          },
          remove: async () => undefined as never,
        },
      },
      project: {},
      directory: process.cwd(),
      worktree: process.cwd(),
      serverUrl: new URL("http://localhost:4096"),
      $: {},
    } as unknown as Input)
    const cfg = await hooks.auth?.loader?.(
      async () => ({
        type: "oauth",
        refresh: "root-refresh",
        access: "root-access",
        expires: Date.now() + 60_000,
        accountId: "acct-root",
      }),
      {} as never,
    )

    const old = globalThis.fetch
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url
      if (url.includes("/oauth/token")) return new Response("bad", { status: 401 })
      return new Response(JSON.stringify({ ok: true, auth: new Headers(init?.headers).get("authorization") }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as unknown as typeof fetch

    const res = await (cfg?.fetch as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>)(
      "https://api.openai.com/v1/responses",
      { headers: { authorization: "Bearer old" } },
    )
    const json = await res.json() as { auth: string }

    expect(json.auth).toBe("Bearer good-access")
    expect(sets.length).toBeGreaterThan(0)
    globalThis.fetch = old
    rmSync(dir, { recursive: true, force: true })
  })

  it("refreshes live usage before looping across exhausted accounts", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "multi-auth-runtime-"))
    const file = path.join(dir, "auth.json")
    process.env.OPENCODE_MULTI_AUTH_PATH = file
    await upsert(file, {
      id: "a1",
      kind: "oauth",
      label: "A1",
      access: "a1-access",
      refresh: "a1-refresh",
      expires: Date.now() + 60_000,
      account_id: "acct-1",
      added_at: 1,
      last_used: 1,
        usage: { primary_used_percent: 10, fetched_at: 1 },
    })
    await upsert(file, {
      id: "a2",
      kind: "oauth",
      label: "A2",
      access: "a2-access",
      refresh: "a2-refresh",
      expires: Date.now() + 60_000,
      account_id: "acct-2",
      added_at: 2,
      last_used: 2,
        usage: { primary_used_percent: 10, fetched_at: 2 },
    })
    await upsert(file, {
      id: "a3",
      kind: "oauth",
      label: "A3",
      access: "a3-access",
      refresh: "a3-refresh",
      expires: Date.now() + 60_000,
      account_id: "acct-3",
      added_at: 3,
      last_used: 3,
      usage: { primary_used_percent: 10, fetched_at: 3 },
    })
    await setActive(file, "a1")

    const sets: Array<unknown> = []
    const hooks = await plugin({
      client: {
        auth: {
          set: async (input: unknown) => {
            sets.push(input)
            return undefined as never
          },
          remove: async () => undefined as never,
        },
      },
      project: {},
      directory: process.cwd(),
      worktree: process.cwd(),
      serverUrl: new URL("http://localhost:4096"),
      $: {},
    } as unknown as Input)
    const cfg = await hooks.auth?.loader?.(
      async () => ({
        type: "oauth",
        refresh: "root-refresh",
        access: "root-access",
        expires: Date.now() + 60_000,
        accountId: "acct-root",
      }),
      {} as never,
    )

    const old = globalThis.fetch
    let phase: "init" | "request" = "init"
    const apiCalls: Array<{ auth: string | null; account: string | null }> = []
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url
      if (url.includes("/backend-api/wham/usage")) {
        const account = new Headers(init?.headers).get("ChatGPT-Account-Id")
        const used = phase === "init"
          ? 10
          : account === "acct-1" || account === "acct-2"
            ? 100
            : 10
        return new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: used } } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      if (url.includes("/oauth/token")) return new Response("unexpected", { status: 500 })

      const headers = new Headers(init?.headers)
      const auth = headers.get("authorization")
      const account = headers.get("ChatGPT-Account-Id")
      apiCalls.push({ auth, account })

      if (auth === "Bearer a3-access") {
        return new Response(JSON.stringify({ ok: true, auth, account }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }

      return new Response("server", { status: 500 })
    }) as unknown as typeof fetch

    phase = "request"
    const res = await (cfg?.fetch as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>)(
      "https://api.openai.com/v1/responses",
      { headers: { authorization: "Bearer old" } },
    )
    const json = await res.json() as { ok: true; auth: string; account: string }

    expect(apiCalls).toEqual([
      { auth: "Bearer a1-access", account: "acct-1" },
      { auth: "Bearer a2-access", account: "acct-2" },
      { auth: "Bearer a3-access", account: "acct-3" },
    ])
    expect(json).toEqual({ ok: true, auth: "Bearer a3-access", account: "acct-3" })
    expect((await active(file))?.id).toBe("a3")
    expect(sets.length).toBeGreaterThan(0)

    globalThis.fetch = old
    rmSync(dir, { recursive: true, force: true })
  })
})
