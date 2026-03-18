import { describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import * as mod from "../src/index.ts"
import plugin from "../src/index.ts"
import { upsert } from "../src/store.ts"

describe("plugin", () => {
  it("only exports plugin initializers from the package root", () => {
    expect(Object.keys(mod).sort()).toEqual(["OpenAIMultiAuth", "default"])
  })

  it("exposes four auth methods for openai", async () => {
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
      "ChatGPT Pro/Plus (browser)",
      "ChatGPT Pro/Plus (headless)",
      "Manually enter API Key",
      "Manage Accounts",
    ])
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
      { label: "users1@gmail.com", value: "acc:a1", hint: "users1@gmail.com" },
      { label: "users2@gmail.com (Active)", value: "acc:a2", hint: "users2@gmail.com" },
    ])

    const actionPrompt = method && "prompts" in method ? method.prompts?.[1] : undefined
    const actionOpts = actionPrompt?.type === "select" ? actionPrompt.options : []
    expect(actionOpts).toEqual([
      { label: "Activate", value: "activate" },
      { label: "Delete", value: "delete" },
    ])
    expect(actionPrompt?.condition?.({ target: "acc:a2" })).toBe(true)
    expect(actionPrompt?.condition?.({ target: "add" })).toBe(false)
    expect(actionOpts.map((x) => x.value)).not.toContain("back")
    rmSync(dir, { recursive: true, force: true })
    delete process.env.OPENCODE_MULTI_AUTH_PATH
  })
})
