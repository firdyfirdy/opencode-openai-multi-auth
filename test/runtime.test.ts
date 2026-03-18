import { afterEach, describe, expect, it, mock } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import plugin from "../src/index.ts"
import { applyManage } from "../src/manage-result.ts"
import { setActive, upsert } from "../src/store.ts"

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
})
