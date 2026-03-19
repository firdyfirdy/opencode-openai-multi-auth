export type OAuthAuth = {
  type: "oauth"
  refresh: string
  access: string
  expires: number
  accountId?: string
}

export type ApiAuth = {
  type: "api"
  key: string
}

export type CoreAuth = OAuthAuth | ApiAuth

export type Token = {
  id_token?: string
  access_token: string
  refresh_token: string
  expires_in?: number
}

export type Pkce = {
  verifier: string
  challenge: string
}

export type Claims = {
  sub?: string
  chatgpt_account_id?: string
  organizations?: Array<{ id: string }>
  email?: string
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string
  }
}

export type Account = {
  id: string
  sub?: string
  kind: "oauth"
  label: string
  email?: string
  access: string
  refresh: string
  expires: number
  account_id?: string
  added_at: number
  last_used: number
  cooldown_until?: number
  last_error?: string
  usage?: {
    primary_used_percent: number
    secondary_used_percent?: number
    fetched_at: number
    reset_at?: string
  }
}

export type Registry = {
  version: 1
  active_account_id?: string
  accounts: Account[]
}

export type Client = {
  auth: {
    set(input: { providerID: string; auth: CoreAuth }): Promise<unknown>
    remove(input: { providerID: string }): Promise<unknown>
  }
}

export type PluginInput = {
  client: Client
  project: unknown
  directory: string
  worktree: string
  serverUrl: URL
  $: unknown
}

export type OAuthSuccess =
  | {
      type: "success"
      refresh: string
      access: string
      expires: number
      accountId?: string
    }
  | {
      type: "failed"
    }

export type OAuthAuto = {
  type: "oauth"
  label: string
  authorize(inputs?: Record<string, string>): Promise<{
    url: string
    instructions: string
    method: "auto"
    callback(): Promise<OAuthSuccess>
  }>
}

export type ApiMethod = {
  type: "api"
  label: string
}

export type AuthHook = {
  provider: string
  loader?(getAuth: () => Promise<CoreAuth>, provider: { models?: Record<string, unknown> }): Promise<Record<string, unknown>>
  methods: Array<OAuthAuto | ApiMethod>
}

export type Hooks = {
  auth?: AuthHook
  "chat.headers"?: (
    input: { sessionID: string; model: { providerID: string } },
    output: { headers: Record<string, string> },
  ) => Promise<void>
}

export type Fail = {
  kind: "hard-switch" | "cooldown-switch" | "same-account-retry" | "no-switch"
  wait?: number
}
