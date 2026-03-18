import { buildAuthorizeUrl, createPkce, createState, exchangeCode, extractAccountId, extractEmail, extractSub, manageUri, open, parseAuthInput, redirectUri, shouldAutoOpen } from "./auth.js"
import { active, list, remove, setActive, upsert } from "./store.js"
import type { Account } from "./types.js"

type PendingAdd = {
  url: string
  state: string
  pkce: Awaited<ReturnType<typeof createPkce>>
  input?: string
  error?: string
}

export async function startManage(loc: string) {
  let pending: PendingAdd | undefined
  let resolve: ((value: Account | undefined) => void) | undefined
  const wait = new Promise<Account | undefined>((res) => {
    resolve = res
  })

  const server = Bun.serve({
    port: 1455,
    async fetch(req) {
      const url = new URL(req.url)

      if (url.pathname === "/manage" && req.method === "GET") return page(loc, pending)

      if (url.pathname === "/manage/use" && req.method === "POST") {
        const form = await req.formData()
        const id = String(form.get("id") ?? "") || undefined
        await setActive(loc, id)
        return bounce("/manage")
      }

      if (url.pathname === "/manage/remove" && req.method === "POST") {
        const form = await req.formData()
        const id = String(form.get("id") ?? "")
        if (id) await remove(loc, id)
        return bounce("/manage")
      }

      if (url.pathname === "/manage/add" && req.method === "POST") {
        const pkce = await createPkce()
        const state = createState()
        pending = {
          pkce,
          state,
          url: buildAuthorizeUrl(redirectUri(), pkce, state),
        }
        return bounce("/manage")
      }

      if (url.pathname === "/manage/confirm" && req.method === "POST") {
        const form = await req.formData()
        const input = String(form.get("callback") ?? "").trim()
        if (!pending) {
          pending = {
            pkce: await createPkce(),
            state: createState(),
            url: "",
            input,
            error: "Start a new account authorization before submitting a callback.",
          }
          return bounce("/manage")
        }

        const current = pending
        pending.input = input
        const parsed = parseAuthInput(input)
        if (!parsed.code) {
          pending.error = "Paste the full callback URL, a code/state query string, or at least the authorization code."
          return bounce("/manage")
        }
        if (parsed.state && parsed.state !== current.state) {
          pending.error = "The pasted callback does not match the active authorization link. Start again and use the newest link."
          return bounce("/manage")
        }

        try {
          const token = await exchangeCode(parsed.code, redirectUri(), current.pkce)
          const now = Date.now()
          const email = extractEmail(token)
          const sub = extractSub(token)
          const accountId = extractAccountId(token)
          const currentActive = await active(loc)
          await upsert(loc, {
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
          }, { activate: !currentActive })
          pending = undefined
          return bounce("/manage")
        } catch (error) {
          current.error = error instanceof Error ? error.message : "Token exchange failed."
          pending = current
          return bounce("/manage")
        }
      }

      if (url.pathname === "/auth/callback") {
        return callbackPage(req.url)
      }

      if (url.pathname === "/manage/done" && req.method === "POST") {
        resolve?.(await active(loc))
        return html("Ready", "You can close this page and return to OpenCode.")
      }

      if (url.pathname === "/manage/cancel" && req.method === "POST") {
        resolve?.(undefined)
        return html("Cancelled", "No account changes were applied to OpenCode.")
      }

      return text("not found", 404)
    },
  })

  const url = manageUri()
  if (shouldAutoOpen()) await open(url)

  return {
    url,
    async wait() {
      try {
        return await wait
      } finally {
        server.stop(true)
      }
    },
  }
}

async function page(loc: string, pending?: PendingAdd) {
  const cur = await active(loc)
  const accounts = await list(loc)
  const items = accounts.length
    ? accounts
        .map((x) => accountCard(x, x.id === cur?.id))
        .join("")
    : '<li class="empty">No saved accounts yet. Add one to start rotating between OpenAI accounts.</li>'

  const pendingBlock = pending
    ? `<section class="panel accent"><div class="eyebrow">Add account</div><h2>Manual callback flow</h2><p class="lead">Open the authorization page in a new tab, finish the OpenAI login, then paste the full callback URL or the returned code here.</p><div class="steps"><a class="button primary" href="${escAttr(pending.url)}" target="_blank" rel="noreferrer">Open OpenAI authorization</a><p class="hint">Use the newest authorization link only. The expected state token ends with <code>${esc(mask(pending.state))}</code>.</p></div>${pending.error ? `<p class="alert">${esc(pending.error)}</p>` : ""}<form class="stack" method="post" action="/manage/confirm"><label class="field"><span>Paste callback URL or code</span><textarea name="callback" rows="5" placeholder="${escAttr(`${redirectUri()}?code=...&state=...`)}">${esc(pending.input ?? "")}</textarea></label><div class="row"><button class="button primary" type="submit">Store account</button><button class="button ghost" type="submit" formaction="/manage/add">Generate new link</button></div></form></section>`
    : `<section class="panel accent"><div class="eyebrow">Add account</div><h2>Headless by default</h2><p class="lead">Generate an OpenAI authorization link, complete the login in any browser, then paste the callback URL back here.</p><form method="post" action="/manage/add"><button class="button primary" type="submit">Generate authorization link</button></form></section>`

  const current = cur
    ? `<p class="status">Active now: <strong>${esc(cur.label)}</strong></p>`
    : `<p class="status muted">No active account selected yet.</p>`

  return doc(
    "Manage Accounts",
    `<main class="shell"><header class="hero"><div><div class="eyebrow">OpenAI multi-account</div><h1>Manage Accounts</h1><p class="lead">Keep one active account mirrored to OpenCode, while storing the rest here for quick switching.</p></div>${current}</header>${pendingBlock}<section class="panel"><div class="section-head"><div><div class="eyebrow">Saved accounts</div><h2>Your account pool</h2></div><p class="muted">Use, remove, or review cooldown state before returning to OpenCode.</p></div><ul class="accounts">${items}</ul></section><footer class="footer-actions"><form method="post" action="/manage/done"><button class="button primary" type="submit">Use active account</button></form><form method="post" action="/manage/cancel"><button class="button ghost" type="submit">Cancel</button></form></footer></main>`,
  )
}

function accountCard(account: Account, isActive: boolean) {
  const cooldown = account.cooldown_until && account.cooldown_until > Date.now()
    ? `Cooling down until ${new Date(account.cooldown_until).toLocaleTimeString()}`
    : account.last_error
      ? `Last error: ${account.last_error}`
      : account.email || account.account_id || "Ready"

  return `<li class="account"><div class="account-copy"><div class="account-title"><strong>${esc(account.label)}</strong>${isActive ? '<span class="badge">Active</span>' : ""}</div><p class="muted">${esc(cooldown)}</p></div><div class="account-actions"><form method="post" action="/manage/use"><input type="hidden" name="id" value="${escAttr(account.id)}"><button class="button ghost" type="submit">Use</button></form><form method="post" action="/manage/remove"><input type="hidden" name="id" value="${escAttr(account.id)}"><button class="button danger" type="submit">Remove</button></form></div></li>`
}

function callbackPage(input: string) {
  return doc(
    "OpenAI Callback",
    `<main class="shell narrow"><header class="hero compact"><div><div class="eyebrow">Return step</div><h1>Copy this callback</h1><p class="lead">OpenAI redirected here. Copy the full URL below, go back to the Manage Accounts page, and paste it into the callback field.</p></div></header><section class="panel accent"><label class="field"><span>Callback URL</span><textarea rows="5" readonly>${esc(input)}</textarea></label><p class="hint">Nothing is stored automatically on this page.</p><div class="row"><a class="button primary" href="/manage">Back to Manage Accounts</a></div></section></main>`,
    '<script>const area=document.querySelector("textarea"); if(area){ area.focus(); area.select(); }</script>',
  )
}

function text(body: string, status = 200) {
  return new Response(body, { status })
}

function bounce(loc: string) {
  return Response.redirect(loc, 302)
}

function html(title: string, body: string) {
  return doc(title, `<main class="shell narrow"><section class="panel accent"><h1>${esc(title)}</h1><p class="lead">${esc(body)}</p></section></main>`, '<script>setTimeout(()=>window.close(),1200)</script>')
}

function doc(title: string, body: string, script = "") {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${styles()}</style></head><body>${body}${script}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } },
  )
}

function styles() {
  return `:root{color-scheme:light;--bg:#f6f3ee;--panel:#fffdf9;--panel-strong:#f7f1e7;--line:#e4dbd0;--text:#211c18;--muted:#6d655d;--accent:#33473a;--accent-soft:#e6ede8;--danger:#8a4338;--danger-soft:#f6e7e2;--shadow:0 24px 60px rgba(43,32,21,.08);}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:linear-gradient(180deg,#f7f3ed 0%,#f1ece5 100%);color:var(--text);font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:32px}h1,h2{margin:0;font-family:Georgia,"Times New Roman",serif;font-weight:600;letter-spacing:-.02em}p{margin:0}.shell{max-width:760px;margin:0 auto;display:grid;gap:18px}.shell.narrow{max-width:620px}.hero,.panel{background:var(--panel);border:1px solid var(--line);border-radius:20px;box-shadow:var(--shadow)}.hero{padding:24px 24px 20px;display:grid;gap:10px}.hero.compact{padding:24px}.eyebrow{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}.lead{color:var(--muted);max-width:60ch}.status{padding-top:2px}.panel{padding:22px}.panel.accent{background:var(--panel-strong)}.section-head{display:grid;gap:8px;margin-bottom:18px}.accounts{list-style:none;padding:0;margin:0;display:grid;gap:12px}.account{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:16px;border:1px solid var(--line);border-radius:16px;background:#fffdfa}.account-title{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-bottom:4px}.badge{display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;background:var(--accent-soft);color:var(--accent);font-size:12px;font-weight:600}.muted{color:var(--muted)}.empty{padding:18px;border:1px dashed var(--line);border-radius:16px;color:var(--muted);background:#fffdfa}.account-actions,.footer-actions,.row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.footer-actions{justify-content:flex-start}.steps{display:grid;gap:10px;margin:16px 0 14px}.stack{display:grid;gap:14px}.field{display:grid;gap:8px}.field span{font-weight:600}textarea{width:100%;border:1px solid var(--line);border-radius:14px;padding:14px 15px;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Monaco,monospace;color:var(--text);background:#fffdfa;resize:vertical}textarea:focus{outline:2px solid color-mix(in srgb,var(--accent) 24%,transparent);outline-offset:2px}.button{appearance:none;border:1px solid transparent;border-radius:999px;padding:10px 16px;font-weight:600;font-size:14px;text-decoration:none;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:background-color .18s ease,border-color .18s ease,color .18s ease}.button.primary{background:var(--accent);color:#f8f4ee}.button.primary:hover{background:#2c3d31}.button.ghost{background:transparent;border-color:var(--line);color:var(--text)}.button.ghost:hover{background:#f6f0e7}.button.danger{background:transparent;border-color:#e6c7be;color:var(--danger)}.button.danger:hover{background:var(--danger-soft)}.alert{padding:12px 14px;border:1px solid #ebc8bb;border-radius:14px;background:#fbefe9;color:#6f2f24}.hint{font-size:14px;color:var(--muted)}code{font:inherit;background:rgba(51,71,58,.08);padding:2px 6px;border-radius:999px}form{margin:0}@media (max-width:720px){body{padding:18px}.hero,.panel{border-radius:18px}.account{flex-direction:column}.account-actions,.footer-actions,.row{width:100%}.account-actions form,.footer-actions form,.row form{flex:1}.button{width:100%}}`
}

function mask(input: string) {
  return input.slice(-8)
}

function esc(input: string) {
  return input.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function escAttr(input: string) {
  return esc(input).replaceAll('"', "&quot;")
}
