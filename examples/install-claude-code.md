# Installation Guide — Claude Code

How to get `@focusgts/firefly-services-mcp` running inside Claude Code from a clean install in ~5 minutes.

---

## Prerequisites

| Requirement | How to verify | Install if missing |
|---|---|---|
| Node 20+ | `node --version` | [nodejs.org](https://nodejs.org/) |
| Claude Code CLI | `claude --version` | [claude.com/code](https://www.claude.com/product/claude-code) |
| Firefly Services credentials | OAuth Server-to-Server `client_id` + `client_secret` from Adobe Developer Console | See "Getting Credentials" below |

---

## Getting Credentials

If you don't already have a Firefly Services credential pair, you have three paths:

### Path A — Adobe Partner Program (free for Silver/Gold/Platinum)

If your organization is an Adobe Solution Partner at Silver tier or higher:

1. Sign in to the [Partner Benefits Center](https://partnerbenefitscenter.adobe.com/benefits-center.html)
2. Browse to **Sandbox Services and Add-Ons** → find **Firefly Services**
3. Add to cart → checkout (it's $0 for partners at eligible tiers)
4. Wait ~5 business days for provisioning email
5. Once provisioned, sign in to the new sandbox's Admin Console → Add Firefly Services as a product → Open Developer Console → Create OAuth Server-to-Server credentials → copy `client_id` and `client_secret`

### Path B — Customer engagement (if you're an FDE consultant)

If you're working on Firefly Services at a customer site, the customer's Adobe Developer Console workspace will have credentials provisioned. Talk to the customer's Adobe admin for access.

### Path C — Adobe Firefly Services subscription

For commercial use, Firefly Services is sold as an enterprise product. Contact your Adobe account team or visit [adobe.com/firefly-services](https://www.adobe.com/products/firefly/enterprise.html) to start a procurement conversation.

---

## Step 1 — Export credentials to your shell

```bash
export FIREFLY_SERVICES_CLIENT_ID="<your client id>"
export FIREFLY_SERVICES_CLIENT_SECRET="<your client secret>"
```

For persistence across terminal sessions, add the same lines to your `~/.zshrc` or `~/.bashrc`. For multi-environment workflows, consider [`direnv`](https://direnv.net/) with a `.envrc` per project.

**Security:** the `client_secret` is a real secret. Never commit it to source control. Never paste it into chat tools. Store it in your password manager (1Password, Bitwarden) or your system's keyring.

---

## Step 2 — Verify credentials work (optional but recommended)

Smoke-test the credentials against Adobe IMS before wiring them into Claude Code:

```bash
curl --silent --location "https://ims-na1.adobelogin.com/ims/token/v3" \
  --header "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=client_credentials" \
  --data-urlencode "client_id=$FIREFLY_SERVICES_CLIENT_ID" \
  --data-urlencode "client_secret=$FIREFLY_SERVICES_CLIENT_SECRET" \
  --data-urlencode "scope=openid,AdobeID,session,additional_info,read_organizations,firefly_api,ff_apis,firefly_enterprise,creative_sdk"
```

Expected: a JSON response with a non-empty `access_token` and `expires_in: 86399`. If you get `invalid_client`, the secret is wrong. If you get `unauthorized_client`, the workspace isn't subscribed to the Firefly Services API.

---

## Step 3 — Install the MCP server

### Option 1 — From npm (recommended once published)

```bash
claude mcp add firefly-services -- npx @focusgts/firefly-services-mcp
```

### Option 2 — From local source (during development)

```bash
git clone https://github.com/focusgts/firefly-services-mcp.git
cd firefly-services-mcp
npm install
claude mcp add firefly-services -- npx tsx "$(pwd)/src/server.ts"
```

### Option 3 — From a checked-out clone via absolute path

```bash
claude mcp add firefly-services -- npx tsx /absolute/path/to/firefly-services-mcp/src/server.ts
```

---

## Step 4 — Verify the server loaded

Restart Claude Code, then run:

```
/mcp
```

You should see output like:

```
firefly-services    connected    18 tools
```

If you see fewer tools or a connection error, see **Troubleshooting** below.

---

## Step 5 — Run your first tool call

In Claude Code, ask:

> Use Firefly to check that my credentials are working.

Claude will call `firefly_check_auth` and return a token-status report. If it succeeds, you're done.

Then try:

> Generate an image of a sunrise over mountains using Firefly.

Claude will call `firefly_generate_image` and the generated image will appear inline in the conversation.

---

## Troubleshooting

### "0 tools" or "connection failed" in `/mcp`

The server failed to start. Common causes:

1. **Missing credentials.** Run `echo $FIREFLY_SERVICES_CLIENT_ID` in the same shell that launched Claude Code. If empty, re-export.
2. **Wrong Node version.** Run `node --version`. Must be 20.x or higher.
3. **Path issue with `npx tsx ...`.** Try the absolute-path form (Option 3 above).
4. **The shell that launched Claude Code is different from the one with the env vars.** Quit Claude Code completely, re-export in your active shell, re-launch Claude Code from that shell.

### "Token refresh failed" errors

The credentials are wrong or the workspace lacks Firefly Services entitlement. Run the `curl` test from Step 2 to confirm the credentials work standalone. If they don't, regenerate them in the Adobe Developer Console.

### Tool calls succeed but return empty `outputs`

Firefly's content-safety filter may be rejecting the prompt silently. Rephrase the prompt to avoid public figures, copyrighted IP, restricted terms, or NSFW themes. The `firefly-services-troubleshoot` skill in the [companion skills repo](https://github.com/focusgts/firefly-services-skills) covers this in detail.

### Tool calls hit 429 (rate-limited)

Default Firefly Services rate limit is ~4 RPM per credential. For development testing this is usually fine. For higher volumes, contact your Adobe account team about provisioning a higher limit.

### Generated images don't show inline

Pass `return_inline_image: false` to receive only the URL (faster for batch). The default is `true`, which fetches the bytes and embeds them in the MCP response. If inline is failing, the URL fetch may be hitting your firewall — check whether `*.adobe.io` is allowlisted.

---

## Uninstalling

```bash
claude mcp remove firefly-services
```

The server is just a process Claude Code spawns — there's nothing persistent on your system beyond the npm package cache and the env vars you exported.

---

## Updating

```bash
# npm install path
npm update -g @focusgts/firefly-services-mcp

# Local clone path
cd firefly-services-mcp
git pull
npm install
```

Restart Claude Code after updating to pick up the new server version.

---

## Where to go next

- [Demo script](./demo.md) — guided 12-minute walkthrough showing 5 representative workflows
- [Companion skills repo](https://github.com/focusgts/firefly-services-skills) — 17 Claude Code skills documenting the Firefly Services workflow patterns
- [Adobe Firefly Services developer docs](https://developer.adobe.com/firefly-services/docs/) — official Adobe documentation
- [GitHub issues](https://github.com/focusgts/firefly-services-mcp/issues) — report bugs, request features, ask questions
