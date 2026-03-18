import type { Account } from "./types.js"

type Option = {
  label: string
  value: string
  hint?: string
}

export function buildManageOptions(rows: Account[], cur: Account | undefined): Option[] {
  return [
    { label: "Add Account", value: "add", hint: "Login another OpenAI account" },
    ...rows.map((x) => ({
      label: x.id === cur?.id ? `${x.label} (Active)` : x.label,
      value: `acc:${x.id}`,
      hint: x.email || x.account_id || "Saved account",
    })),
  ]
}
