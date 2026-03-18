import { describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { active, load, remove, setActive, upsert } from "../src/store.ts"

describe("store", () => {
  it("upserts accounts and persists the active id", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "multi-auth-store-"))
    const file = path.join(dir, "auth.json")

    await upsert(file, {
      id: "a1",
      kind: "oauth",
      label: "Work",
      access: "a",
      refresh: "r",
      expires: 1,
      account_id: "acct-1",
      added_at: 1,
      last_used: 1,
    })
    await upsert(file, {
      id: "a2",
      kind: "oauth",
      label: "Personal",
      access: "b",
      refresh: "s",
      expires: 2,
      account_id: "acct-2",
      added_at: 2,
      last_used: 2,
    })
    await setActive(file, "a2")

    const state = await load(file)
    expect(state.accounts).toHaveLength(2)
    expect(state.active_account_id).toBe("a2")
    expect((await active(file))?.label).toBe("Personal")

    await remove(file, "a2")
    expect((await active(file))?.id).toBe("a1")
    rmSync(dir, { recursive: true, force: true })
  })

  it("keeps both saved logins when they share the same derived account id", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "multi-auth-store-"))
    const file = path.join(dir, "auth.json")

    await upsert(file, {
      id: "login-1",
      kind: "oauth",
      label: "Work",
      email: "one@example.com",
      access: "a",
      refresh: "r1",
      expires: 1,
      account_id: "org-shared",
      added_at: 1,
      last_used: 1,
    })
    await upsert(file, {
      id: "login-2",
      kind: "oauth",
      label: "Personal",
      email: "two@example.com",
      access: "b",
      refresh: "r2",
      expires: 2,
      account_id: "org-shared",
      added_at: 2,
      last_used: 2,
    })

    const state = await load(file)
    expect(state.accounts).toHaveLength(2)
    expect(state.accounts.map((x) => x.id)).toEqual(["login-1", "login-2"])
    expect(state.accounts.map((x) => x.email)).toEqual(["one@example.com", "two@example.com"])
    expect(state.active_account_id).toBe("login-2")
    rmSync(dir, { recursive: true, force: true })
  })

  it("does not change the active account when a new login is added without activation", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "multi-auth-store-"))
    const file = path.join(dir, "auth.json")

    await upsert(file, {
      id: "a1",
      kind: "oauth",
      label: "Work",
      email: "work@example.com",
      access: "a",
      refresh: "r1",
      expires: 1,
      account_id: "acct-1",
      added_at: 1,
      last_used: 1,
    })
    await setActive(file, "a1")
    await upsert(file, {
      id: "a2",
      kind: "oauth",
      label: "Personal",
      email: "personal@example.com",
      access: "b",
      refresh: "r2",
      expires: 2,
      account_id: "acct-2",
      added_at: 2,
      last_used: 2,
    }, { activate: false })

    const state = await load(file)
    expect(state.accounts).toHaveLength(2)
    expect(state.active_account_id).toBe("a1")
    expect((await active(file))?.label).toBe("Work")
    rmSync(dir, { recursive: true, force: true })
  })
})
