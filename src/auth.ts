import os from "node:os"
import { setTimeout as sleep } from "node:timers/promises"
import type { Claims, Pkce, Token } from "./types.js"

export const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"
export const ISSUER = "https://auth.openai.com"
export const CODEX_URL = "https://chatgpt.com/backend-api/codex/responses"
const PORT = 1455
const DEFAULT_PUBLIC_BASE_URL = `http://localhost:${PORT}`

export function callbackBaseUrl() {
  const raw = process.env.OPENCODE_MULTI_AUTH_PUBLIC_BASE_URL?.trim()
  if (!raw) return DEFAULT_PUBLIC_BASE_URL
  try {
    const url = new URL(raw)
    url.pathname = ""
    url.search = ""
    url.hash = ""
    return url.toString().replace(/\/$/, "")
  } catch {
    return DEFAULT_PUBLIC_BASE_URL
  }
}

export function redirectUri() {
  return `${callbackBaseUrl()}/auth/callback`
}

export function manageUri() {
  return `${callbackBaseUrl()}/manage`
}

export function isLoopbackCallbackHost() {
  const host = new URL(callbackBaseUrl()).hostname
  return host === "localhost" || host === "127.0.0.1" || host === "::1"
}

export function shouldAutoOpen() {
  return isLoopbackCallbackHost()
}

function rnd(len: number) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const bytes = crypto.getRandomValues(new Uint8Array(len))
  return Array.from(bytes)
    .map((x) => chars[x % chars.length])
    .join("")
}

function b64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf)
  const text = String.fromCharCode(...bytes)
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export async function createPkce(): Promise<Pkce> {
  const verifier = rnd(43)
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  return { verifier, challenge: b64(hash) }
}

export function createState() {
  return b64(crypto.getRandomValues(new Uint8Array(32)).buffer)
}

export function buildAuthorizeUrl(uri: string, pkce: Pkce, state: string) {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: uri,
    scope: "openid profile email offline_access",
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "opencode",
  })
  return `${ISSUER}/oauth/authorize?${query.toString()}`
}

export function parseAuthInput(input: string) {
  const text = input.trim()
  if (!text) return {}

  try {
    const url = new URL(text)
    return {
      code: url.searchParams.get("code") ?? undefined,
      state: url.searchParams.get("state") ?? undefined,
    }
  } catch {}

  if (text.includes("#")) {
    const [code, state] = text.split("#", 2)
    return { code, state }
  }

  if (text.includes("code=")) {
    const query = new URLSearchParams(text)
    return {
      code: query.get("code") ?? undefined,
      state: query.get("state") ?? undefined,
    }
  }

  return { code: text }
}

export function parseClaims(token: string): Claims | undefined {
  const parts = token.split(".")
  if (parts.length !== 3) return
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString()) as Claims
  } catch {
    return
  }
}

export function extractAccountId(tokens: Partial<Token>) {
  if (tokens.id_token) {
    const claims = parseClaims(tokens.id_token)
    const id = extractAccountIdFromClaims(claims)
    if (id) return id
  }
  if (!tokens.access_token) return
  return extractAccountIdFromClaims(parseClaims(tokens.access_token))
}

export function extractEmail(tokens: Partial<Token>) {
  if (tokens.id_token) {
    const claims = parseClaims(tokens.id_token)
    if (claims?.email) return claims.email
  }
  if (!tokens.access_token) return
  return parseClaims(tokens.access_token)?.email
}

export function extractSub(tokens: Partial<Token>) {
  if (tokens.id_token) {
    const claims = parseClaims(tokens.id_token)
    if (claims?.sub) return claims.sub
  }
  if (!tokens.access_token) return
  return parseClaims(tokens.access_token)?.sub
}

function extractAccountIdFromClaims(claims?: Claims) {
  return claims?.chatgpt_account_id || claims?.["https://api.openai.com/auth"]?.chatgpt_account_id || claims?.organizations?.[0]?.id
}

export async function exchangeCode(code: string, uri: string, pkce: Pkce) {
  const res = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: uri,
      client_id: CLIENT_ID,
      code_verifier: pkce.verifier,
    }).toString(),
  })
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`)
  return (await res.json()) as Token
}

export async function refreshToken(refresh: string) {
  const res = await fetch(`${ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: CLIENT_ID,
    }).toString(),
  })
  if (!res.ok) throw new Error(`token refresh failed: ${res.status}`)
  return (await res.json()) as Token
}

export async function open(url: string) {
  const cmd = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url]
  Bun.spawn(cmd, { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
}

export function rewrite(input: RequestInfo | URL) {
  const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url)
  if (url.pathname.includes("/v1/responses") || url.pathname.includes("/chat/completions")) return new URL(CODEX_URL)
  return url
}

export async function startBrowserAuth() {
  if (!isLoopbackCallbackHost()) {
    throw new Error("browser auth only supports loopback callbacks; use ChatGPT Pro/Plus (headless) for remote or VPS login")
  }
  const pkce = await createPkce()
  const state = createState()
  const uri = redirectUri()
  const url = buildAuthorizeUrl(uri, pkce, state)
  let resolve: ((value: Token) => void) | undefined
  let reject: ((reason?: unknown) => void) | undefined
  const wait = new Promise<Token>((res, rej) => {
    resolve = res
    reject = rej
  })
  const server = Bun.serve({
    port: PORT,
    fetch(req) {
      const url = new URL(req.url)
      if (url.pathname !== "/auth/callback") return new Response("not found", { status: 404 })
      const err = url.searchParams.get("error")
      const code = url.searchParams.get("code")
      const got = url.searchParams.get("state")
      if (err) {
        reject?.(new Error(err))
        return page("Authorization failed", err)
      }
      if (!code || got !== state) {
        reject?.(new Error("invalid callback"))
        return page("Authorization failed", "Invalid callback")
      }
      void exchangeCode(code, uri, pkce)
        .then((token) => resolve?.(token))
        .catch((err) => reject?.(err))
      return page("Authorization successful", "You can close this window.")
    },
  })
  return {
    url,
    async wait() {
      const timer = setTimeout(() => reject?.(new Error("oauth timeout")), 5 * 60 * 1000)
      try {
        return await wait
      } finally {
        clearTimeout(timer)
        server.stop(true)
      }
    },
  }
}

export async function startDeviceAuth() {
  const res = await fetch(`${ISSUER}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": `opencode-multi-auth (${os.platform()} ${os.release()}; ${os.arch()})`,
    },
    body: JSON.stringify({ client_id: CLIENT_ID }),
  })
  if (!res.ok) throw new Error(`device auth failed: ${res.status}`)
  return (await res.json()) as { device_auth_id: string; user_code: string; interval: string }
}

export async function pollDeviceAuth(info: { device_auth_id: string; user_code: string; interval: string }) {
  const wait = (Math.max(Number.parseInt(info.interval) || 5, 1) * 1000) + 3000
  while (true) {
    const res = await fetch(`${ISSUER}/api/accounts/deviceauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": `opencode-multi-auth (${os.platform()} ${os.release()}; ${os.arch()})`,
      },
      body: JSON.stringify({
        device_auth_id: info.device_auth_id,
        user_code: info.user_code,
      }),
    })

    if (res.ok) {
      const data = (await res.json()) as { authorization_code: string; code_verifier: string }
      return exchangeCode(data.authorization_code, `${ISSUER}/deviceauth/callback`, {
        verifier: data.code_verifier,
        challenge: "",
      })
    }

    if (res.status !== 403 && res.status !== 404) throw new Error(`device auth polling failed: ${res.status}`)
    await sleep(wait)
  }
}

function page(title: string, text: string) {
  return new Response(
    `<!doctype html><html><body style="font-family:system-ui;padding:40px"><h1>${title}</h1><p>${text}</p><script>setTimeout(()=>window.close(),1200)</script></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  )
}
