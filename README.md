# opencode-openai-multi-auth

Multi-account OpenAI auth plugin for OpenCode.

## Publish to npm

You only need GitHub if you want to host the source there. OpenCode does not install plugins from GitHub directly.

For `opencode.json` install, this package needs to be published to npm first:

```bash
bun install
bun run test
bun run typecheck
bun run build
npm publish
```

If you want to test the packed artifact before publishing:

```bash
bun pm pack
```

That creates a tarball like `opencode-openai-multi-auth-0.1.0.tgz`.

## Install in OpenCode

Publish the package to npm, then add it to your OpenCode config file, for example `<OPENCODE_CONFIG_DIR>/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-openai-multi-auth"]
}
```

Restart OpenCode after updating the config.

You can also pin a version explicitly:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-openai-multi-auth@0.1.0"]
}
```

OpenCode will install npm plugins automatically from the `plugin` array.

## Local plugin without npm

If you want to test locally first, use your normal OpenCode config directory, for example `<OPENCODE_CONFIG_DIR>`.

1. Build the package:

```bash
cd <PLUGIN_REPO_PATH>
bun install
bun run build
```

2. Create this loader file at `<OPENCODE_CONFIG_DIR>/plugins/opencode-openai-multi-auth.js`:

```js
export { default } from "<PLUGIN_REPO_PATH>/dist/index.js"
```

3. Restart OpenCode.

4. Verify the OpenAI login UI now shows the extra `Manage Accounts` option.

5. After any local code change, rerun `bun run build` and restart OpenCode.

This local-development path does not use the repository's `opencode/` folder as your OpenCode config. Keep using your normal config file at `<OPENCODE_CONFIG_DIR>/opencode.json`.

That path is for local development only. `opencode.json` npm install still needs a published npm package.

## OAuth callback modes

This plugin supports three auth patterns:

- `ChatGPT Pro/Plus (browser, loopback only)` uses a loopback callback such as `http://localhost:1455/auth/callback`.
- `ChatGPT Pro/Plus (headless)` uses OpenAI device flow and does not depend on any local or public callback URL.
- `Manage Accounts` can accept a pasted callback URL, query string, or raw authorization code, but any generated `/manage` and `/auth/callback` links still use the configured base URL.

### Default loopback usage

Leave `OPENCODE_MULTI_AUTH_PUBLIC_BASE_URL` unset when the browser can reach the same machine running OpenCode. In that mode, the plugin uses `http://localhost:1455` for `/manage` and `/auth/callback`, and browser auth can auto-open locally.

### Public callback behind a reverse proxy

Set `OPENCODE_MULTI_AUTH_PUBLIC_BASE_URL` only when you have an externally reachable origin that forwards back to the machine running this plugin on port `1455`.

```bash
export OPENCODE_MULTI_AUTH_PUBLIC_BASE_URL="https://opencode.example.com"
```

Your reverse proxy must forward these routes back to the local plugin server:

- `/auth/callback`
- `/manage`
- `/manage/*`

Important: this environment variable only changes the advertised base URL used for manual account-manager links. It does not make browser OAuth work against arbitrary public IP or VPS callback hosts. Browser OAuth is loopback-only in this plugin.

### When to use device flow instead

Use `ChatGPT Pro/Plus (headless)` when:

- you do not want to expose a public callback URL
- your browser cannot reach the OpenCode host over loopback
- you are working over SSH, on a VPS, or on another headless remote machine

Device flow does not use `OPENCODE_MULTI_AUTH_PUBLIC_BASE_URL`.

## Troubleshooting

- If the plugin does not load, restart OpenCode after changing `opencode.json`
- If npm install fails, try pinning the exact version in the `plugin` array
- If the package updates but OpenCode still uses an older version, change the version string in `opencode.json` and restart
- If auth UI changes do not appear, confirm the package published the built `dist/` files, not only `src/`
- If browser OAuth fails on a VPS or public IP callback host, use `ChatGPT Pro/Plus (headless)` instead

## Local development

```bash
bun install
bun run test
bun run typecheck
bun run build
```
