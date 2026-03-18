# opencode-openai-multi-auth

Multi-account OpenAI auth plugin for OpenCode.

## Publish to npm

You only need GitHub if you want to host the source there. OpenCode does not install plugins from GitHub directly.

For `opencode.json` install, this package needs to be published to npm first:

```bash
bun install
bun test
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

Publish the package to npm, then add it to `~/.config/opencode/opencode.json`:

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

If you want to test locally first, use your real OpenCode config directory under `~/.config/opencode/`.

1. Build the package:

```bash
cd /home/worker/projects/opencode-multi-codex/opencode-openai-multi-auth
bun install
bun run build
```

2. Create this loader file at `~/.config/opencode/plugins/opencode-openai-multi-auth.js`:

```js
export { default } from "/home/worker/projects/opencode-multi-codex/opencode-openai-multi-auth/dist/index.js"
```

3. Restart OpenCode.

4. Verify the OpenAI login UI now shows the extra `Manage Accounts` option.

5. After any local code change, rerun `bun run build` and restart OpenCode.

This local-first path does not use the `opencode/` source folder in this repository as your config. The real OpenCode config path remains `~/.config/opencode/opencode.json`.

That path is for local development only. `opencode.json` npm install still needs a published npm package.

## Troubleshooting

- If the plugin does not load, restart OpenCode after changing `opencode.json`
- If npm install fails, try pinning the exact version in the `plugin` array
- If the package updates but OpenCode still uses an older version, change the version string in `opencode.json` and restart
- If auth UI changes do not appear, confirm the package published the built `dist/` files, not only `src/`

## Local development

```bash
bun install
bun test
bun run typecheck
bun run build
```
