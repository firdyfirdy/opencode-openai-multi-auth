import { describe, expect, it, mock } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import * as mod from "../src/index.ts"
import plugin from "../src/index.ts"
import { load, upsert } from "../src/store.ts"

describe("plugin", () => {
  it("only exports plugin initializers from the package root", () => {
    expect(Object.keys(mod).sort()).toEqual(["OpenAIMultiAuth", "default"])
  })

  it("exposes four auth methods for openai", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "multi-auth-plugin-"))
    const file = path.join(dir, "auth.json")
    process.env.OPENCODE_MULTI_AUTH_PATH = file

    const hooks = await plugin({
      client: {
        auth: {
          set: async () => undefined as never,
          remove: async () => undefined as never,
        },
      },
      project: { id: "p" },
      directory: process.cwd(),
      worktree: process.cwd(),
      serverUrl: new URL("http://localhost:4096"),
      $: {} as never,
    } as unknown as Parameters<typeof plugin>[0])

    expect(hooks.auth?.provider).toBe("openai")
    expect(hooks.auth?.methods.map((x) => x.label)).toEqual([
      "ChatGPT Pro/Plus (browser, loopback only)",
      "ChatGPT Pro/Plus (headless)",
      "Manually enter API Key",
      "Manage Accounts",
    ])

    rmSync(dir, { recursive: true, force: true })
    delete process.env.OPENCODE_MULTI_AUTH_PATH
  })

  it("uses a two-step native Manage Accounts prompt without Back", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "multi-auth-plugin-"))
    const file = path.join(dir, "auth.json")
    process.env.OPENCODE_MULTI_AUTH_PATH = file
    await upsert(file, {
      id: "a1",
      kind: "oauth",
      label: "users1@gmail.com",
      email: "users1@gmail.com",
      access: "a",
      refresh: "r1",
      expires: 1,
      account_id: "acct-1",
      added_at: 1,
      last_used: 1,
    })
    await upsert(file, {
      id: "a2",
      kind: "oauth",
      label: "users2@gmail.com",
      email: "users2@gmail.com",
      access: "b",
      refresh: "r2",
      expires: 2,
      account_id: "acct-2",
      added_at: 2,
      last_used: 2,
    })

    const hooks = await plugin({
      client: {
        auth: {
          set: async () => undefined as never,
          remove: async () => undefined as never,
        },
      },
      project: { id: "p" },
      directory: process.cwd(),
      worktree: process.cwd(),
      serverUrl: new URL("http://localhost:4096"),
      $: {} as never,
    } as unknown as Parameters<typeof plugin>[0])

    const method = hooks.auth?.methods.find((x) => x.label === "Manage Accounts")
    expect(method?.type).toBe("oauth")
    expect(method && "prompts" in method ? method.prompts?.map((x) => x.key) : []).toEqual(["target", "action"])
    const targetPrompt = method && "prompts" in method ? method.prompts?.[0] : undefined
    const targetOpts = targetPrompt?.type === "select" ? targetPrompt.options : []
    expect(targetOpts).toEqual([
      { label: "Add Account", value: "add", hint: "Login another OpenAI account" },
      { label: "Refresh All Accounts", value: "refresh-all", hint: "Refresh usage for every saved account" },
      { label: "users1@gmail.com", value: "acc:a1", hint: "users1@gmail.com" },
      { label: "users2@gmail.com (Active)", value: "acc:a2", hint: "users2@gmail.com" },
    ])

    const actionPrompt = method && "prompts" in method ? method.prompts?.[1] : undefined
    const actionOpts = actionPrompt?.type === "select" ? actionPrompt.options : []
    expect(actionOpts).toEqual([
      { label: "Activate", value: "activate" },
      { label: "Delete", value: "delete" },
      { label: "Refresh Usage", value: "refresh" },
    ])
    expect(actionPrompt?.condition?.({ target: "acc:a2" })).toBe(true)
    expect(actionPrompt?.condition?.({ target: "add" })).toBe(false)
    expect(actionOpts.map((x) => x.value)).not.toContain("back")
    rmSync(dir, { recursive: true, force: true })
    delete process.env.OPENCODE_MULTI_AUTH_PATH
  })

  it("shows primary usage in Manage Accounts when usage lookup succeeds", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "multi-auth-plugin-"))
    const file = path.join(dir, "auth.json")
    process.env.OPENCODE_MULTI_AUTH_PATH = file
    await upsert(file, {
      id: "a1",
      kind: "oauth",
      label: "users1@gmail.com",
      email: "users1@gmail.com",
      access: "a",
      refresh: "r1",
      expires: Date.now() + 60_000,
      account_id: "acct-1",
      added_at: 1,
      last_used: 1,
    })
    await upsert(file, {
      id: "a2",
      kind: "oauth",
      label: "users2@gmail.com",
      email: "users2@gmail.com",
      access: "b",
      refresh: "r2",
      expires: Date.now() + 60_000,
      account_id: "acct-2",
      added_at: 2,
      last_used: 2,
    })

    const old = globalThis.fetch
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      const account = headers.get("ChatGPT-Account-Id")
      const used = account === "acct-1" ? 12 : 89
      return new Response(
        JSON.stringify({
          rate_limit: {
            primary_window: {
              used_percent: used,
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }) as unknown as typeof fetch

    const hooks = await plugin({
      client: {
        auth: {
          set: async () => undefined as never,
          remove: async () => undefined as never,
        },
      },
      project: { id: "p" },
      directory: process.cwd(),
      worktree: process.cwd(),
      serverUrl: new URL("http://localhost:4096"),
      $: {} as never,
    } as unknown as Parameters<typeof plugin>[0])

    const method = hooks.auth?.methods.find((x) => x.label === "Manage Accounts")
    const targetPrompt = method && "prompts" in method ? method.prompts?.[0] : undefined
    const targetOpts = targetPrompt?.type === "select" ? targetPrompt.options : []

    expect(targetOpts).toEqual([
      { label: "Add Account", value: "add", hint: "Login another OpenAI account" },
      { label: "Refresh All Accounts", value: "refresh-all", hint: "Refresh usage for every saved account" },
      { label: "users1@gmail.com", value: "acc:a1", hint: "users1@gmail.com · Left 88%" },
      { label: "users2@gmail.com (Active)", value: "acc:a2", hint: "users2@gmail.com · Left 11%" },
    ])

    globalThis.fetch = old
    rmSync(dir, { recursive: true, force: true })
    delete process.env.OPENCODE_MULTI_AUTH_PATH
  })

  it("keeps Manage Accounts usable when usage lookups fail or accounts are expired", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "multi-auth-plugin-"))
    const file = path.join(dir, "auth.json")
    process.env.OPENCODE_MULTI_AUTH_PATH = file
    await upsert(file, {
      id: "fresh",
      kind: "oauth",
      label: "fresh@gmail.com",
      email: "fresh@gmail.com",
      access: "fresh-access",
      refresh: "fresh-refresh",
      expires: Date.now() + 60_000,
      account_id: "acct-fresh",
      added_at: 1,
      last_used: 1,
    })
    await upsert(file, {
      id: "expired",
      kind: "oauth",
      label: "expired@gmail.com",
      email: "expired@gmail.com",
      access: "expired-access",
      refresh: "expired-refresh",
      expires: 1,
      account_id: "acct-expired",
      added_at: 2,
      last_used: 2,
    })

    const old = globalThis.fetch
    let count = 0
    globalThis.fetch = mock(async () => {
      count++
      return new Response("boom", { status: 500 })
    }) as unknown as typeof fetch

    const hooks = await plugin({
      client: {
        auth: {
          set: async () => undefined as never,
          remove: async () => undefined as never,
        },
      },
      project: { id: "p" },
      directory: process.cwd(),
      worktree: process.cwd(),
      serverUrl: new URL("http://localhost:4096"),
      $: {} as never,
    } as unknown as Parameters<typeof plugin>[0])

    const method = hooks.auth?.methods.find((x) => x.label === "Manage Accounts")
    const targetPrompt = method && "prompts" in method ? method.prompts?.[0] : undefined
    const targetOpts = targetPrompt?.type === "select" ? targetPrompt.options : []

    expect(count).toBe(1)
    expect(targetOpts).toEqual([
      { label: "Add Account", value: "add", hint: "Login another OpenAI account" },
      { label: "Refresh All Accounts", value: "refresh-all", hint: "Refresh usage for every saved account" },
      { label: "fresh@gmail.com", value: "acc:fresh", hint: "fresh@gmail.com" },
      { label: "expired@gmail.com (Active)", value: "acc:expired", hint: "expired@gmail.com" },
    ])

    globalThis.fetch = old
    rmSync(dir, { recursive: true, force: true })
    delete process.env.OPENCODE_MULTI_AUTH_PATH
  })

  it("refreshes only the selected account usage without changing the active account", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "multi-auth-plugin-"))
    const file = path.join(dir, "auth.json")
    process.env.OPENCODE_MULTI_AUTH_PATH = file
    await upsert(file, {
      id: "a1",
      kind: "oauth",
      label: "users1@gmail.com",
      email: "users1@gmail.com",
      access: "a",
      refresh: "r1",
      expires: Date.now() + 60_000,
      account_id: "acct-1",
      added_at: 1,
      last_used: 1,
    })
    await upsert(file, {
      id: "a2",
      kind: "oauth",
      label: "users2@gmail.com",
      email: "users2@gmail.com",
      access: "b",
      refresh: "r2",
      expires: Date.now() + 60_000,
      account_id: "acct-2",
      added_at: 2,
      last_used: 2,
    })

    const old = globalThis.fetch
    const seen: string[] = []
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      const account = headers.get("ChatGPT-Account-Id")
      if (account) seen.push(account)
      return new Response(
        JSON.stringify({
          rate_limit: { primary_window: { used_percent: 33 } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }) as unknown as typeof fetch

    const set = mock(async () => undefined as never)
    const hooks = await plugin({
      client: {
        auth: {
          set,
          remove: async () => undefined as never,
        },
      },
      project: { id: "p" },
      directory: process.cwd(),
      worktree: process.cwd(),
      serverUrl: new URL("http://localhost:4096"),
      $: {} as never,
    } as unknown as Parameters<typeof plugin>[0])

    seen.length = 0
    const method = hooks.auth?.methods.find((x) => x.label === "Manage Accounts")
    const auth = method?.type === "oauth" ? await method.authorize({ target: "acc:a1", action: "refresh" }) : undefined
    if (auth && "callback" in auth) {
      await auth.callback("" as never)
    }

    expect(seen).toEqual(["acct-1"])
    expect(set).not.toHaveBeenCalled()
    const state = await load(file)
    expect(state.active_account_id).toBe("a2")
    expect(state.accounts.find((x) => x.id === "a1")?.usage?.primary_used_percent).toBe(33)

    globalThis.fetch = mock(async () => new Response("boom", { status: 500 })) as unknown as typeof fetch
    const reopened = await plugin({
      client: {
        auth: {
          set: async () => undefined as never,
          remove: async () => undefined as never,
        },
      },
      project: { id: "p" },
      directory: process.cwd(),
      worktree: process.cwd(),
      serverUrl: new URL("http://localhost:4096"),
      $: {} as never,
    } as unknown as Parameters<typeof plugin>[0])
    const reopenedMethod = reopened.auth?.methods.find((x) => x.label === "Manage Accounts")
    const reopenedTarget = reopenedMethod && "prompts" in reopenedMethod ? reopenedMethod.prompts?.[0] : undefined
    const reopenedOpts = reopenedTarget?.type === "select" ? reopenedTarget.options : []
    expect(reopenedOpts).toEqual([
      { label: "Add Account", value: "add", hint: "Login another OpenAI account" },
      { label: "Refresh All Accounts", value: "refresh-all", hint: "Refresh usage for every saved account" },
      { label: "users1@gmail.com", value: "acc:a1", hint: "users1@gmail.com · Left 67%" },
      { label: "users2@gmail.com (Active)", value: "acc:a2", hint: "users2@gmail.com · Left 67%" },
    ])

    globalThis.fetch = old
    rmSync(dir, { recursive: true, force: true })
    delete process.env.OPENCODE_MULTI_AUTH_PATH
  })

  it("refreshes all eligible account usage without changing the active account", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "multi-auth-plugin-"))
    const file = path.join(dir, "auth.json")
    process.env.OPENCODE_MULTI_AUTH_PATH = file
    await upsert(file, {
      id: "a1",
      kind: "oauth",
      label: "users1@gmail.com",
      email: "users1@gmail.com",
      access: "a",
      refresh: "r1",
      expires: Date.now() + 60_000,
      account_id: "acct-1",
      added_at: 1,
      last_used: 1,
    })
    await upsert(file, {
      id: "a2",
      kind: "oauth",
      label: "users2@gmail.com",
      email: "users2@gmail.com",
      access: "b",
      refresh: "r2",
      expires: 1,
      account_id: "acct-2",
      added_at: 2,
      last_used: 2,
    })

    const old = globalThis.fetch
    const seen: string[] = []
    globalThis.fetch = mock(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      const account = headers.get("ChatGPT-Account-Id")
      if (account) seen.push(account)
      return new Response(
        JSON.stringify({
          rate_limit: { primary_window: { used_percent: 44 } },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }) as unknown as typeof fetch

    const set = mock(async () => undefined as never)
    const hooks = await plugin({
      client: {
        auth: {
          set,
          remove: async () => undefined as never,
        },
      },
      project: { id: "p" },
      directory: process.cwd(),
      worktree: process.cwd(),
      serverUrl: new URL("http://localhost:4096"),
      $: {} as never,
    } as unknown as Parameters<typeof plugin>[0])

    seen.length = 0
    const method = hooks.auth?.methods.find((x) => x.label === "Manage Accounts")
    const auth = method?.type === "oauth" ? await method.authorize({ target: "refresh-all" }) : undefined
    if (auth && "callback" in auth) {
      await auth.callback("" as never)
    }

    expect(seen).toEqual(["acct-1"])
    expect(set).not.toHaveBeenCalled()
    const state = await load(file)
    expect(state.active_account_id).toBe("a2")
    expect(state.accounts.find((x) => x.id === "a1")?.usage?.primary_used_percent).toBe(44)
    expect(state.accounts.find((x) => x.id === "a2")?.usage).toBeUndefined()

    globalThis.fetch = mock(async () => new Response("boom", { status: 500 })) as unknown as typeof fetch
    const reopened = await plugin({
      client: {
        auth: {
          set: async () => undefined as never,
          remove: async () => undefined as never,
        },
      },
      project: { id: "p" },
      directory: process.cwd(),
      worktree: process.cwd(),
      serverUrl: new URL("http://localhost:4096"),
      $: {} as never,
    } as unknown as Parameters<typeof plugin>[0])
    const reopenedMethod = reopened.auth?.methods.find((x) => x.label === "Manage Accounts")
    const reopenedTarget = reopenedMethod && "prompts" in reopenedMethod ? reopenedMethod.prompts?.[0] : undefined
    const reopenedOpts = reopenedTarget?.type === "select" ? reopenedTarget.options : []
    expect(reopenedOpts).toEqual([
      { label: "Add Account", value: "add", hint: "Login another OpenAI account" },
      { label: "Refresh All Accounts", value: "refresh-all", hint: "Refresh usage for every saved account" },
      { label: "users1@gmail.com", value: "acc:a1", hint: "users1@gmail.com · Left 56%" },
      { label: "users2@gmail.com (Active)", value: "acc:a2", hint: "users2@gmail.com" },
    ])

    globalThis.fetch = old
    rmSync(dir, { recursive: true, force: true })
    delete process.env.OPENCODE_MULTI_AUTH_PATH
  })
})
