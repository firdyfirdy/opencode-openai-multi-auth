import { mkdir, rename, unlink } from "node:fs/promises"
import path from "node:path"
import type { Account, Registry } from "./types.js"

const EMPTY: Registry = { version: 1, accounts: [] }

export function file() {
  const home = process.env.HOME || process.cwd()
  return process.env.OPENCODE_MULTI_AUTH_PATH || path.join(home, ".opencode", "openai-multi-auth.json")
}

export async function load(loc = file()): Promise<Registry> {
  const src = Bun.file(loc)
  if (!(await src.exists())) return structuredClone(EMPTY)
  const json = (await src.json()) as Partial<Registry>
  return {
    version: 1,
    active_account_id: json.active_account_id,
    accounts: Array.isArray(json.accounts) ? json.accounts as Account[] : [],
  }
}

export async function save(loc: string, state: Registry) {
  await mkdir(path.dirname(loc), { recursive: true })
  const tmp = `${loc}.tmp`
  await Bun.write(tmp, `${JSON.stringify(state, null, 2)}\n`)
  await rename(tmp, loc)
}

export async function list(loc = file()) {
  return (await load(loc)).accounts
}

export async function active(loc = file()) {
  const state = await load(loc)
  return state.accounts.find((x) => x.id === state.active_account_id) || state.accounts[0]
}

export async function setActive(loc: string, id?: string) {
  const state = await load(loc)
  state.active_account_id = state.accounts.some((x) => x.id === id) ? id : state.accounts[0]?.id
  await save(loc, state)
}

export async function upsert(loc: string, acc: Account, options?: { activate?: boolean }) {
  const state = await load(loc)
  const idx = state.accounts.findIndex((x) => x.id === acc.id || (!!x.sub && x.sub === acc.sub) || (!!x.email && x.email === acc.email))
  if (idx >= 0) {
    state.accounts[idx] = {
      ...state.accounts[idx],
      ...acc,
      id: state.accounts[idx].id,
      added_at: state.accounts[idx].added_at,
    }
  }
  if (idx < 0) state.accounts.push(acc)
  const nextID = idx >= 0 ? state.accounts[idx].id : acc.id
  const shouldActivate = options?.activate ?? true
  if (shouldActivate || !state.active_account_id || !state.accounts.some((x) => x.id === state.active_account_id)) {
    state.active_account_id = nextID
  }
  await save(loc, state)
  return idx >= 0 ? state.accounts[idx] : acc
}

export async function remove(loc: string, id: string) {
  const state = await load(loc)
  state.accounts = state.accounts.filter((x) => x.id !== id)
  if (state.active_account_id === id) state.active_account_id = state.accounts[0]?.id
  if (!state.accounts.length) {
    await unlink(loc).catch(() => undefined)
    return
  }
  await save(loc, state)
}

export async function mark(loc: string, id: string, patch: Partial<Account>) {
  const state = await load(loc)
  const idx = state.accounts.findIndex((x) => x.id === id)
  if (idx < 0) return
  state.accounts[idx] = { ...state.accounts[idx], ...patch }
  await save(loc, state)
}

export async function pick(loc: string, skip?: string | Set<string>) {
  const now = Date.now()
  const state = await load(loc)
  const skipped = typeof skip === "string" ? new Set(skip ? [skip] : []) : skip ?? new Set<string>()
  return state.accounts.find((x) => !skipped.has(x.id) && (!x.cooldown_until || x.cooldown_until <= now))
}
