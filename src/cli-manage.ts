import type { Account } from "./types.js"

type Option = {
  label: string
  value: string
  hint?: string
}

export function buildManageOptions(rows: Account[], cur: Account | undefined): Option[] {
  return [
    { label: "Add Account", value: "add", hint: "Login another OpenAI account" },
    { label: "Refresh All Accounts", value: "refresh-all", hint: "Refresh usage for every saved account" },
    ...rows.map((x) => ({
      label: x.id === cur?.id ? `${x.label} (Active)` : x.label,
      value: `acc:${x.id}`,
      hint: usageHint(x),
    })),
  ]
}

function usageHint(account: Account) {
  const base = account.email || account.account_id || "Saved account"
  if (typeof account.usage?.primary_used_percent !== "number") return base
  const left = Math.max(0, Math.min(100, Math.round(100 - account.usage.primary_used_percent)))
  return `${base} · Left ${left}%`
}
