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
      label: usageLabel(x, x.id === cur?.id),
      value: `acc:${x.id}`,
      hint: usageHint(x),
    })),
  ]
}

function usageHint(account: Account) {
  const base = account.email || account.account_id || "Saved account"
  if (typeof account.usage?.primary_used_percent !== "number") return base
  return undefined
}

function usageLabel(account: Account, active: boolean) {
  const base = active ? `${account.label} (Active)` : account.label
  if (typeof account.usage?.primary_used_percent !== "number") return base
  const daily = Math.max(0, Math.min(100, Math.round(account.usage.primary_used_percent)))
  const weekly = Math.max(0, Math.min(100, Math.round(account.usage.secondary_used_percent ?? 0)))
  return `${account.label} (Daily Usage: ${daily}% | Weekly Usage: ${weekly}%)${active ? " (Active)" : ""}`
}
