# Security policy

`@focusgts/firefly-services-mcp` handles Adobe OAuth Server-to-Server credentials and exposes generative-API capabilities to AI clients. Security reports are taken seriously.

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | ✅ Yes — security fixes |
| < 0.1 | ❌ No (pre-release; please upgrade) |

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, email **security@focusgts.com** with:

- A description of the vulnerability
- The affected version(s)
- A minimal reproduction (proof-of-concept code, exact tool args, etc.)
- The impact you believe it has
- Any suggested mitigation (optional)

If you'd prefer encrypted communication, request a PGP key in your initial message and we'll send one.

## Response timeline

| Stage | Target |
|---|---|
| Acknowledgement of receipt | 2 business days |
| Initial assessment (in scope / severity) | 5 business days |
| Status update | At least every 7 calendar days until resolution |
| Coordinated disclosure | Mutually agreed — typically 30-90 days from initial report |

We will work with you on a coordinated disclosure timeline. Faster is sometimes appropriate (active exploitation, trivially fixable); slower is sometimes necessary (deep changes, third-party coordination).

## Scope

### In scope
- Credential leakage (in logs, error messages, tool responses, transcripts)
- Path traversal, SSRF, file inclusion via tool arguments
- Bypass of the `imageRefSchema` URL allowlist
- Bypass of the `path-guard` upload-root enforcement
- Tampering with MCP protocol responses (invalid `CallToolResult` shape, etc.)
- Improper validation of Adobe SDK errors that leaks sensitive request details
- Anything that lets a malicious LLM-driven tool call read files, make outbound requests, or exfiltrate data outside the documented surface

### Out of scope
- Vulnerabilities in the Adobe SDKs themselves (`@adobe/firefly-apis`, `@adobe/photoshop-apis`, `@adobe/lightroom-apis`) — please report those to Adobe via their [security program](https://helpx.adobe.com/security.html)
- Vulnerabilities in the MCP SDK itself (`@modelcontextprotocol/sdk`) — please report to [Anthropic](https://www.anthropic.com/legal/security)
- Vulnerabilities in Node.js, Claude Code, or other upstream dependencies — report to their respective maintainers
- Misuse by a user who controls both the LLM and the credentials (the threat model assumes the credential holder is trusted)
- Denial-of-service from a malicious local user already running arbitrary code on the host
- Issues that require physical access to the machine

### Borderline cases
If you're unsure whether something is in scope, **send the report anyway** and we'll triage. Better to err on the side of reporting.

## Hardening already in place

Documented for transparency, not as a claim of completeness:

- **Credential isolation:** `client_id` and `client_secret` are loaded from environment variables only. They are never logged at any level, never returned in tool output, and never persisted to disk by this server.
- **Token redaction:** the `firefly_check_auth` tool returns only a 10-character preview of the access token (first 6 + last 4). The full token never leaves the server process boundary.
- **SDK error sanitization:** `mapSdkError()` uses an explicit field allowlist. `Authorization`, `x-api-key`, `Cookie`, `Set-Cookie`, and `Proxy-Authorization` headers are stripped from any SDK response that gets surfaced to the MCP client. Response bodies are truncated to 2KB.
- **IMS error body redaction:** Adobe IMS token-refresh errors can echo `client_id` and have historically included fragments of the submitted form body (which contains `client_secret`). `token-cache.ts` parses the OAuth 2.0 error envelope only — never logs the raw body.
- **Path traversal protection:** `firefly_upload_image` and the auto-upload-from-path mode in `storage-refs.ts` both run user-supplied paths through `path-guard.ts`. Paths outside the `FIREFLY_SERVICES_UPLOAD_ROOT` (defaults to `process.cwd()`) are rejected. Hidden files (`.env`, `.ssh/`, etc.) are rejected. Symlinks that resolve outside the upload root are rejected.
- **URL allowlist:** the `imageRefSchema` URL field requires `https://`, rejects IP literals (including the AWS metadata service at `169.254.169.254`), and validates the host against an allowlist of Adobe-documented domains (`*.amazonaws.com`, `*.windows.net`, `*.dropboxusercontent.com`, `*.adobe.io`).
- **Default log level:** `warn`. Info-level breadcrumbs added during development do not unintentionally surface at user-default verbosity.

## Recognition

We're happy to credit reporters in release notes if you'd like (or keep your report anonymous if you'd prefer). No bug bounty program at present; this is a community-maintained project.

## Past advisories

None at this time. If/when security advisories are published, they will appear in [GitHub Security Advisories](https://github.com/focusgts/firefly-services-mcp/security/advisories) for this repository.
