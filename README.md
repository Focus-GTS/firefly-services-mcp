# Firefly Services MCP Server

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![CI](https://github.com/focusgts/firefly-services-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/focusgts/firefly-services-mcp/actions/workflows/ci.yml)
[![Status](https://img.shields.io/badge/status-v0.1.0-green.svg)](#status)
[![Tools](https://img.shields.io/badge/tools-18-blue.svg)](#tools-v01-surface--18-tools)

Model Context Protocol server for **Adobe Firefly Services** — exposes Firefly, Photoshop API, and Lightroom API endpoints as MCP tools that Claude Code, Cursor, and other MCP-compatible AI clients can call directly.

Built by [FocusGTS](https://focusgts.com). Not affiliated with or endorsed by Adobe Inc. or Anthropic, PBC.

---

## Status

**v0.1.0 — 18 tools, fully implemented.** The MCP server boots over stdio, implements the MCP protocol, and registers all 18 tools across Firefly (8), Photoshop API (6), and Lightroom API (4). Test coverage: 142 unit tests + 26 mocked integration tests passing.

**Live validation status (against the Adobe Firefly Services sandbox):**

| Surface | Tools | Status |
|---|---|---|
| Firefly | 8 | ✅ **Live-validated** — all 8 exercised end-to-end against the real API (auth, generate, generate-similar, expand, fill, object-composite, upload, video) |
| Photoshop API | 6 | SDK- + mock-validated. Live validation pending — these endpoints write results to a caller-supplied pre-signed `output_url` (your own S3/Azure/GCS bucket), so live runs require storage configuration |
| Lightroom API | 4 | SDK- + mock-validated. Live validation pending for the same reason |

The Photoshop and Lightroom APIs, by Adobe's design, do not host outputs — the caller provides a writable destination. Live validation of those 10 tools is gated on bucket configuration, not on the server. See [`docs/PRD.md`](docs/PRD.md) for the release plan.

---

## What this is

For developers using Claude Code (or any MCP-compatible client) who want to call Adobe Firefly Services directly from their AI workflow — generate images from prompts, expand and fill existing images, run Photoshop API operations on PSD templates, batch-process images through Lightroom — without leaving the editor.

This is **not** an Adobe SDK and **not** a replacement for one. It is a thin MCP adapter on top of Adobe's official SDKs (`@adobe/firefly-apis`, `@adobe/photoshop-apis`, `@adobe/lightroom-apis`, `@adobe/firefly-services-common-apis`). The SDKs do the real work; this server translates between MCP tool calls and SDK method calls. See [ADR-001](docs/adrs/001-wrap-adobe-sdks-not-reimplement.md) for the rationale.

---

## Install

### Option 1 — From source (recommended during the v0.1.x cycle)

```bash
git clone https://github.com/focusgts/firefly-services-mcp.git
cd firefly-services-mcp
npm install   # builds dist/ automatically via the prepare script

# Add to Claude Code
claude mcp add firefly-services -- node "$(pwd)/dist/server.js"
```

For the development loop without a build step:

```bash
claude mcp add firefly-services -- npx tsx "$(pwd)/src/server.ts"
```

### Option 2 — From npm (preview, once published)

When the package is published to npm, install becomes one line:

```bash
claude mcp add firefly-services -- npx @focusgts/firefly-services-mcp
```

Track the publication status in `docs/PRD.md` §11.

### Required environment variables

```bash
export FIREFLY_SERVICES_CLIENT_ID=<your client id from Adobe Developer Console>
export FIREFLY_SERVICES_CLIENT_SECRET=<your client secret>
```

The credentials must be an **OAuth Server-to-Server** credential pair issued via the Adobe Developer Console with Firefly Services API access provisioned on the workspace. See [`examples/install-claude-code.md`](examples/install-claude-code.md) for the full credential-acquisition walkthrough or the [`firefly-services-bootstrap`](https://github.com/focusgts/firefly-services-skills/blob/main/plugins/firefly-services/skills/firefly-services-bootstrap/SKILL.md) skill for the FDE-grade detail.

---

## Tools (v0.1 surface — 18 tools)

### Firefly (8)
- `firefly_generate_image`
- `firefly_generate_similar`
- `firefly_expand_image`
- `firefly_fill_image`
- `firefly_generate_object_composite`
- `firefly_generate_video`
- `firefly_upload_image`
- `firefly_check_auth`

### Photoshop API (6)
- `photoshop_smart_object_replace`
- `photoshop_document_manifest`
- `photoshop_apply_actions`
- `photoshop_edit_text`
- `photoshop_apply_edits`
- `photoshop_remove_background`

### Lightroom API (4)
- `lightroom_apply_preset`
- `lightroom_auto_tone`
- `lightroom_auto_straighten`
- `lightroom_apply_edits`

Naming follows [ADR-005](docs/adrs/005-tool-naming-convention.md): `<product>_<action>_<object>` in snake_case.

---

## Architecture

```
Claude Code / Cursor
    ↓ MCP protocol (stdio)
@focusgts/firefly-services-mcp
    ↓
@adobe/firefly-apis | @adobe/photoshop-apis | @adobe/lightroom-apis
    ↓ HTTPS
firefly-api.adobe.io | image.adobe.io | ims-na1.adobelogin.com
```

Key architectural decisions:

| ADR | Decision |
|---|---|
| [001](docs/adrs/001-wrap-adobe-sdks-not-reimplement.md) | Wrap Adobe SDKs; do not reimplement the API surface |
| [002](docs/adrs/002-node-typescript-stdio-transport.md) | Node.js + TypeScript + stdio transport |
| [003](docs/adrs/003-single-credential-per-instance-v0.1.md) | Single-credential-per-server-instance for v0.1 |
| [004](docs/adrs/004-storage-references.md) | Storage references: triple-mode input (`uploadId` \| `url` \| `path`), dual-mode output (URL only or inlined bytes) |
| [005](docs/adrs/005-tool-naming-convention.md) | Tool naming: `<product>_<action>_<object>` snake_case |

Full PRD: [`docs/PRD.md`](docs/PRD.md).

---

## Development

```bash
git clone https://github.com/focusgts/firefly-services-mcp.git
cd firefly-services-mcp
npm install

# Type-check
npm run lint

# Run the server in dev mode (uses tsx, no build step)
FIREFLY_SERVICES_CLIENT_ID=<id> FIREFLY_SERVICES_CLIENT_SECRET=<secret> npm run dev

# Unit tests (mocked SDKs)
npm test

# Mocked integration tests (HTTP-layer mocks via msw)
npm run test:integration:mocked

# Live integration tests (real Adobe API — needs valid credentials)
npm run test:integration:live

# Build for production
npm run build
```

### Smoke-test the protocol

The fastest way to verify the server is working end-to-end:

```bash
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke-test","version":"0"}}}'
LIST='{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

( printf '%s\n%s\n%s\n' "$INIT" '{"jsonrpc":"2.0","method":"notifications/initialized"}' "$LIST"; sleep 1 ) \
  | FIREFLY_SERVICES_CLIENT_ID=dummy FIREFLY_SERVICES_CLIENT_SECRET=dummy npm run dev
```

You should see two JSON-RPC responses on stdout — the second one lists all registered tools.

---

## Trademarks and independence

This repository is independently developed and maintained by FocusGTS.

- "Adobe", "Adobe Firefly", "Adobe Firefly Services", "Photoshop", "Lightroom", "InDesign", "Creative Cloud", "Adobe Express", "Adobe Sensei", "GenStudio", and "Adobe Stock" are trademarks or registered trademarks of **Adobe Inc.** in the United States and/or other countries.
- "Claude", "Claude Code", and "Model Context Protocol" are trademarks or service marks of **Anthropic, PBC**.
- These trademarks are used under nominative fair use solely to identify the products this MCP server interoperates with.
- This repository is **not** sponsored, endorsed, affiliated with, or supported by Adobe Inc. or Anthropic, PBC.

See [NOTICE](NOTICE) for the full trademark, attribution, and no-warranty statement.

---

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

Distributed on an "AS IS" basis, **without warranties or conditions of any kind**. Endpoint paths, parameter shapes, and rate limits may change as Adobe evolves its APIs; verify against current official Adobe documentation before relying on any specific behavior.

Copyright © 2026 FocusGTS.

---

## Related projects

- [`focusgts/firefly-services-skills`](https://github.com/focusgts/firefly-services-skills) — Companion Claude Code skills documenting the Firefly Services workflow patterns. The skills repo's [catalog](https://github.com/focusgts/firefly-services-skills/blob/main/plugins/firefly-services/skills/firefly-skills-catalog/SKILL.md) keeps an up-to-date count and index.
