import type { Hooks, Plugin, PluginInput } from "@opencode-ai/plugin"
import { classify } from "./fail.js"
import { active, file, list, mark, pick, remove, setActive, upsert } from "./store.js"
import { extractAccountId, extractEmail, extractSub, fetchUsage, open, pollDeviceAuth, refreshToken, rewrite, shouldAutoOpen, startBrowserAuth, startDeviceAuth } from "./auth.js"
import { buildManageOptions } from "./cli-manage.js"
import { startManage } from "./manage.js"
import { applyManage } from "./manage-result.js"
import type { Account, CoreAuth, Token } from "./types.js"

const DUMMY = "oauth_dummy_key"

export const OpenAIMultiAuth: Plugin = async (input) => {
  const loc = file()
  const current = await active(loc)
  const rows = await usageRows(loc, await list(loc))
  const cur = rows.find((row) => row.id === current?.id)

  return {
    auth: {
      provider: "openai",
      async loader(getAuth) {
        const auth = await getAuth()
        if (auth.type !== "oauth") return {}
        await seed(loc, auth)

        return {
          apiKey: DUMMY,
          async fetch(req: RequestInfo | URL, init?: RequestInit) {
            let acc = await active(loc)
            if (!acc) {
              const seeded = await seed(loc, auth)
              if (!seeded) return fetch(req, init)
              acc = seeded
            }

            const url = rewrite(req)
            const attempted = new Set<string>()

            while (true) {
              acc = await ready(input, loc, acc)
              attempted.add(acc.id)

              const headers = clone(init?.headers)
              headers.delete("authorization")
              headers.delete("Authorization")
              headers.set("authorization", `Bearer ${acc.access}`)
              if (acc.account_id) headers.set("ChatGPT-Account-Id", acc.account_id)

              const res = await fetch(url, { ...init, headers })
              if (res.ok) {
                await mark(loc, acc.id, { last_used: Date.now(), cooldown_until: undefined, last_error: undefined })
                return res
              }

              const body = await res.clone().text().catch(() => "")
              const code = parseCode(body)
              const usage = await fetchUsage(acc.access, acc.account_id)
              const usageLookupFailed = !usage
              if (usage) {
                acc = { ...acc, usage }
                await mark(loc, acc.id, { usage })
              }
              const result = classify({ status: res.status, headers: res.headers, code, body })
              const exhausted = leftUsageExhausted(acc)
              const shouldSwitch = usageLookupFailed || exhausted || result.kind === "hard-switch" || result.kind === "cooldown-switch"
              if (!shouldSwitch) return res

              await mark(loc, acc.id, {
                cooldown_until: result.kind === "cooldown-switch" && result.wait ? Date.now() + result.wait : undefined,
                last_error: code || `${res.status}`,
              })
              const next = await pick(loc, attempted)
              if (!next) return res
              await setActive(loc, next.id)
              await mirror(input, next)
              acc = next
            }
          },
        }
      },
      methods: [
        {
          label: "ChatGPT Pro/Plus (browser, loopback only)",
          type: "oauth",
          authorize: async () => {
            const flow = await startBrowserAuth()
            if (shouldAutoOpen()) await open(flow.url)
            return {
              url: flow.url,
              instructions: "Complete authorization in your browser. This window will close automatically.",
              method: "auto",
              callback: async () => {
                const token = await flow.wait()
                return saveOAuth(input, loc, token)
              },
            }
          },
        },
        {
          label: "ChatGPT Pro/Plus (headless)",
          type: "oauth",
          authorize: async () => {
            const info = await startDeviceAuth()
            return {
              url: `${new URL("/codex/device", "https://auth.openai.com")}`,
              instructions: `Enter code: ${info.user_code}`,
              method: "auto",
              callback: async () => {
                const token = await pollDeviceAuth(info)
                return saveOAuth(input, loc, token)
              },
            }
          },
        },
        {
          label: "Manually enter API Key",
          type: "api",
        },
        {
          label: "Manage Accounts",
          type: "oauth",
          prompts: [
            {
              type: "select",
              key: "target",
              message: "Manage Accounts",
              options: buildManageOptions(rows, cur),
            },
            {
              type: "select",
              key: "action",
              message: "Account Action",
              condition: (values) => !!values.target?.startsWith("acc:"),
              options: [
                { label: "Activate", value: "activate" },
                { label: "Delete", value: "delete" },
                { label: "Refresh Usage", value: "refresh" },
              ],
            },
          ],
          authorize: async (inputs) => {
            if (inputs?.target === "add") {
              return startAddAccount(input, loc)
            }
            if (inputs?.target === "refresh-all") {
              return {
                url: "",
                instructions: "Refreshing usage for all saved accounts...",
                method: "auto",
                callback: async () => refreshUsage(loc),
              }
            }
            if (inputs?.target?.startsWith("acc:")) {
              if (inputs.action === "refresh") {
                return {
                  url: "",
                  instructions: "Refreshing usage for the selected account...",
                  method: "auto",
                  callback: async () => refreshUsage(loc, inputs.target.replace(/^acc:/, "")),
                }
              }
              const acc = await manage(loc, { target: inputs.target, action: inputs.action })
              return {
                url: "",
                instructions: "Applying account selection...",
                method: "auto",
                callback: async () => applyManage(input, acc, mirror),
              }
            }

            const flow = await startManage(loc)
            return {
              url: flow.url,
              instructions: "Use the account manager page to generate an OpenAI link, then paste the returned callback URL or code back into that page.",
              method: "auto",
              callback: async () => applyManage(input, await flow.wait(), mirror),
            }
          },
        },
      ],
    },
    async "chat.headers"(input, output) {
      if (input.model.providerID !== "openai") return
      output.headers.originator = "opencode"
      output.headers.session_id = input.sessionID
    },
  }
}

export default OpenAIMultiAuth

async function usageRows(loc: string, rows: Account[]) {
  const now = Date.now()
  const next: Account[] = []
  for (const row of rows) {
    if (!row.access || row.expires <= now) {
      next.push(row)
      continue
    }
    const usage = await fetchUsage(row.access, row.account_id)
    if (usage) await mark(loc, row.id, { usage })
    next.push(usage ? { ...row, usage } : row)
  }
  return next
}

async function saveOAuth(input: PluginInput, loc: string, token: Token, options?: { activate?: boolean; mirror?: boolean; returnActive?: boolean }) {
  const now = Date.now()
  const email = extractEmail(token)
  const sub = extractSub(token)
  const accountId = extractAccountId(token)
  const acc = await upsert(loc, {
    id: crypto.randomUUID(),
    sub,
    kind: "oauth",
    label: email || accountId || `OpenAI ${now}`,
    email,
    access: token.access_token,
    refresh: token.refresh_token,
    expires: now + (token.expires_in ?? 3600) * 1000,
    account_id: accountId,
    added_at: now,
    last_used: now,
  }, { activate: options?.activate })
  if (options?.mirror ?? true) await mirror(input, acc)
  const out = options?.returnActive ? (await active(loc)) || acc : acc
  return result(out)
}

async function startAddAccount(input: PluginInput, loc: string) {
  const before = await active(loc)
  const flow = await startBrowserAuth()
  if (shouldAutoOpen()) await open(flow.url)
  return {
    url: flow.url,
    instructions: "Complete authorization in your browser. The new account will be saved without switching the current active account.",
    method: "auto" as const,
    callback: async () => {
      const token = await flow.wait()
      return saveOAuth(input, loc, token, {
        activate: !before,
        mirror: !before,
        returnActive: !!before,
      })
    },
  }
}

async function seed(loc: string, auth: CoreAuth) {
  const acc = await active(loc)
  if (acc) return acc
  if (auth.type !== "oauth") return
  const now = Date.now()
  const seed = await upsert(loc, {
    id: crypto.randomUUID(),
    kind: "oauth",
    label: auth.accountId || "OpenAI",
    access: auth.access,
    refresh: auth.refresh,
    expires: auth.expires,
    account_id: auth.accountId,
    added_at: now,
    last_used: now,
  })
  return seed
}

async function mirror(input: PluginInput, acc?: Account) {
  if (!acc) {
    await drop(input)
    return
  }
  await input.client.auth.set({
    path: { id: "openai" },
    body: {
      type: "oauth",
      refresh: acc.refresh,
      access: acc.access,
      expires: acc.expires,
      ...(acc.account_id && { accountId: acc.account_id }),
    },
  })
}

async function drop(input: PluginInput) {
  await fetch(new URL("/auth/openai", input.serverUrl), { method: "DELETE" })
}

async function fresh(input: PluginInput, loc: string, acc: Account) {
  if (acc.expires >= Date.now() && acc.access) return acc
  const token = await refreshToken(acc.refresh)
  const next: Account = {
    ...acc,
    sub: extractSub(token) || acc.sub,
    access: token.access_token,
    refresh: token.refresh_token,
    expires: Date.now() + (token.expires_in ?? 3600) * 1000,
    account_id: extractAccountId(token) || acc.account_id,
    email: extractEmail(token) || acc.email,
    last_used: Date.now(),
  }
  await upsert(loc, next)
  await mirror(input, next)
  return next
}

async function ready(input: PluginInput, loc: string, acc: Account) {
  try {
    return await fresh(input, loc, acc)
  } catch (err) {
    await mark(loc, acc.id, {
      last_error: err instanceof Error ? err.message : "refresh_failed",
    })
    const next = await pick(loc, acc.id)
    if (!next) throw err
    await setActive(loc, next.id)
    await mirror(input, next)
    return fresh(input, loc, next)
  }
}

function clone(input?: HeadersInit) {
  const headers = new Headers()
  if (!input) return headers
  if (input instanceof Headers) {
    input.forEach((value, key) => headers.set(key, value))
    return headers
  }
  if (Array.isArray(input)) {
    input.forEach(([key, value]) => headers.set(key, value))
    return headers
  }
  Object.entries(input).forEach(([key, value]) => {
    if (value !== undefined) headers.set(key, String(value))
  })
  return headers
}

function parseCode(body: string) {
  try {
    const json = JSON.parse(body) as { error?: { code?: string; type?: string } }
    return json.error?.code || json.error?.type || ""
  } catch {
    return ""
  }
}

function result(acc: Account) {
  return {
    type: "success" as const,
    refresh: acc.refresh,
    access: acc.access,
    expires: acc.expires,
    accountId: acc.account_id,
  }
}

function leftUsageExhausted(acc: Account) {
  return (
    (typeof acc.usage?.primary_used_percent === "number" && acc.usage.primary_used_percent >= 100) ||
    (typeof acc.usage?.secondary_used_percent === "number" && acc.usage.secondary_used_percent >= 100)
  )
}

async function refreshUsage(loc: string, id?: string) {
  const rows = await list(loc)
  const target = id ? rows.filter((row) => row.id === id) : rows
  await usageRows(loc, target)

  const acc = await active(loc)
  if (acc) return result(acc)

  const selected = id ? target[0] : undefined
  return selected ? result(selected) : { type: "failed" as const }
}

async function manage(loc: string, inputs: { target: string; action?: string }) {
  const id = inputs.target.replace(/^acc:/, "")
  if (!id) return active(loc)
  if (inputs.action === "delete") {
    const rows = await list(loc)
    if (rows.length <= 1) return active(loc)
    await remove(loc, id)
    return active(loc)
  }

  await setActive(loc, id)
  return active(loc)
}
