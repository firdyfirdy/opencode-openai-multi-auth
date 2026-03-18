import { describe, expect, it, mock } from "bun:test"
import {
  buildAuthorizeUrl,
  callbackBaseUrl,
  createPkce,
  exchangeCode,
  extractAccountId,
  parseAuthInput,
  parseClaims,
  redirectUri,
  refreshToken,
  startBrowserAuth,
} from "../src/auth.ts"

describe("auth", () => {
  it("builds the authorize url with pkce and state", async () => {
    const pkce = await createPkce()
    const url = new URL(buildAuthorizeUrl("http://localhost:1455/auth/callback", pkce, "state-1"))

    expect(url.origin + url.pathname).toBe("https://auth.openai.com/oauth/authorize")
    expect(url.searchParams.get("response_type")).toBe("code")
    expect(url.searchParams.get("client_id")).toBe("app_EMoamEEZ73f0CkXaXp7hrann")
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:1455/auth/callback")
    expect(url.searchParams.get("state")).toBe("state-1")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("code_challenge")).toBe(pkce.challenge)
  })

  it("parses auth input from url, query string, and raw code", () => {
    expect(parseAuthInput("http://localhost:1455/auth/callback?code=abc&state=def")).toEqual({
      code: "abc",
      state: "def",
    })
    expect(parseAuthInput("code=abc&state=def")).toEqual({ code: "abc", state: "def" })
    expect(parseAuthInput("abc")).toEqual({ code: "abc" })
  })

  it("extracts account id from id token claims or access token claims", () => {
    const one = makeJwt({ chatgpt_account_id: "acc-1" })
    const two = makeJwt({ organizations: [{ id: "org-2" }] })

    expect(parseClaims(one)?.chatgpt_account_id).toBe("acc-1")
    expect(extractAccountId({ id_token: one, access_token: two, refresh_token: "r", expires_in: 3600 })).toBe("acc-1")
    expect(extractAccountId({ access_token: two, refresh_token: "r", expires_in: 3600 })).toBe("org-2")
  })

  it("exchanges codes and refreshes tokens", async () => {
    const old = globalThis.fetch
    globalThis.fetch = mock(async () => {
      return new Response(
        JSON.stringify({ access_token: "a", refresh_token: "r", expires_in: 60, id_token: makeJwt({}) }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }) as unknown as typeof fetch

    const pkce = await createPkce()
    const one = await exchangeCode("code-1", "http://localhost:1455/auth/callback", pkce)
    const two = await refreshToken("refresh-1")

    expect(one.access_token).toBe("a")
    expect(two.refresh_token).toBe("r")
    globalThis.fetch = old
  })

  it("uses a configured non-localhost callback host", async () => {
    process.env.OPENCODE_MULTI_AUTH_PUBLIC_BASE_URL = "http://203.0.113.10:1455/"
    const pkce = await createPkce()
    const url = new URL(buildAuthorizeUrl(redirectUri(), pkce, "state-2"))

    expect(callbackBaseUrl()).toBe("http://203.0.113.10:1455")
    expect(redirectUri()).toBe("http://203.0.113.10:1455/auth/callback")
    expect(url.searchParams.get("redirect_uri")).toBe("http://203.0.113.10:1455/auth/callback")

    delete process.env.OPENCODE_MULTI_AUTH_PUBLIC_BASE_URL
  })

  it("rejects browser auth when the callback host is non-loopback", async () => {
    process.env.OPENCODE_MULTI_AUTH_PUBLIC_BASE_URL = "http://203.0.113.10:1455/"

    await expect(startBrowserAuth()).rejects.toThrow("loopback")

    delete process.env.OPENCODE_MULTI_AUTH_PUBLIC_BASE_URL
  })
})

function makeJwt(body: Record<string, unknown>) {
  const head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")
  const pay = Buffer.from(JSON.stringify(body)).toString("base64url")
  return `${head}.${pay}.sig`
}
