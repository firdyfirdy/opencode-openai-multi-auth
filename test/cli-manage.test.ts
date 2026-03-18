import { describe, expect, it } from "bun:test"
import { buildManageOptions } from "../src/cli-manage.ts"
import type { Account } from "../src/types.ts"

const one: Account = {
  id: "a1",
  kind: "oauth",
  label: "users1@gmail.com",
  email: "users1@gmail.com",
  access: "a1",
  refresh: "r1",
  expires: 1,
  account_id: "acct-1",
  added_at: 1,
  last_used: 1,
}

const two: Account = {
  id: "a2",
  kind: "oauth",
  label: "users2@gmail.com",
  email: "users2@gmail.com",
  access: "a2",
  refresh: "r2",
  expires: 2,
  account_id: "acct-2",
  added_at: 2,
  last_used: 2,
}

describe("cli-manage", () => {
  it("builds the account target list without duplicating actions", () => {
    expect(buildManageOptions([one, two], two)).toEqual([
      { label: "Add Account", value: "add", hint: "Login another OpenAI account" },
      { label: "users1@gmail.com", value: "acc:a1", hint: "users1@gmail.com" },
      { label: "users2@gmail.com (Active)", value: "acc:a2", hint: "users2@gmail.com" },
    ])
  })
})
