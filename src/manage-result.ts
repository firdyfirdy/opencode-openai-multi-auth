import type { PluginInput } from "@opencode-ai/plugin"
import type { Account } from "./types.js"

export async function applyManage(input: PluginInput, acc: Account | undefined, mirror: (input: PluginInput, acc?: Account) => Promise<void>) {
  await mirror(input, acc)
  if (!acc) return { type: "failed" as const }
  return {
    type: "success" as const,
    refresh: acc.refresh,
    access: acc.access,
    expires: acc.expires,
    accountId: acc.account_id,
  }
}
