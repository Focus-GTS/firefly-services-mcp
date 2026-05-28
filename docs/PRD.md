# PRD — Firefly Services MCP Server

**Owner:** FocusGTS
**Status:** v0.1 in development
**Last updated:** 2026-05-18

---

## 1. Problem statement

Adobe shipped Model Context Protocol (MCP) support for AEM (2025) and the Adobe Express add-on docs (March 2026), but has not shipped an official MCP server for Firefly Services — the generative API surface that drives Adobe's most strategic AI revenue line. Developers using Claude Code, Cursor, or other MCP-compatible AI clients have no clean way to call Firefly Services from inside their AI workflows. The only public alternative is one independent developer's unofficial server with three tools and effectively no traction.

FocusGTS operates a forward-deployed engineering practice working on Adobe Firefly Services at enterprise customer accounts. We ship the only public Claude Code skills for the platform — the [`firefly-services-skills`](https://github.com/focusgts/firefly-services-skills) repo — and this MCP server is the natural complement. Building it now fills the developer-tooling gap and lets FocusGTS contribute usefully at the platform-tooling layer of Adobe's developer ecosystem.

## 2. Goals (v0.1)

| Goal | Success criterion |
|---|---|
| Cover the core Firefly + Photoshop + Lightroom API surfaces | At least 15 MCP tools across the three APIs |
| Work out-of-the-box with Claude Code | `claude mcp add firefly-services -- npx @focusgts/firefly-services-mcp` succeeds and tools appear |
| Auth in <2 minutes from clean install | Env var → token round-trip → first generated image |
| Demo-ready | Live demo: a user types "generate an image of X" in Claude Code and an image appears inline |
| Open source, Apache-2.0 | Published to GitHub and npm; no proprietary blobs |

## 3. Non-goals (explicit cuts for v0.1)

- A web UI, dashboard, or visual configurator
- Multi-user / multi-tenant credential management (see [ADR-003](adrs/003-single-credential-per-instance-v0.1.md))
- Stripping the Adobe SDKs and reimplementing the API surface (see [ADR-001](adrs/001-wrap-adobe-sdks-not-reimplement.md))
- Caching, queueing, or persistent state — calls are stateless
- Support for AEM, Adobe Express, or non-Firefly Adobe APIs
- Custom Models training (read-only for v0.1; submission in v0.2)
- A hosted / SaaS version

## 4. Users

| User | What they do with it | Frequency |
|---|---|---|
| FocusGTS FDE consultants | Generate images / videos during customer workshops, prototype new use cases | Daily, post-adoption |
| Customer engineering teams | Embed in their internal Claude Code workflows for prompt-driven asset generation | Weekly |
| Adobe DevRel | Demo Firefly-via-Claude at partner events and developer week | Episodic |
| Independent AI developers | Build apps that combine an LLM agent with Firefly generation | One-off |
| Adobe FDE leadership | Demo to internal stakeholders to show partner-ecosystem AI tooling | One-off, then occasional |

v0.1 success is *not* "high install counts." It is **strategic positioning**: Adobe DevRel referencing this MCP server as the most complete community Firefly artifact for Claude users.

## 5. Functional requirements — the tools

Each MCP tool wraps a single Adobe SDK call ([ADR-001](adrs/001-wrap-adobe-sdks-not-reimplement.md)) and follows the naming convention in [ADR-005](adrs/005-tool-naming-convention.md).

### Firefly tools (8 in v0.1)

| Tool name | Wraps SDK call | v0.1 |
|---|---|---|
| `firefly_generate_image` | `FireflyClient.generateImages()` | ✅ |
| `firefly_generate_similar` | `FireflyClient.generateSimilarImages()` | ✅ |
| `firefly_expand_image` | `FireflyClient.expandImage()` | ✅ |
| `firefly_fill_image` | `FireflyClient.fillImage()` | ✅ |
| `firefly_generate_object_composite` | `FireflyClient.generateObjectComposite()` | ✅ |
| `firefly_generate_video` | `FireflyClient.generateVideoV3()` | ✅ |
| `firefly_upload_image` | `FireflyClient.upload()` | ✅ |
| `firefly_check_auth` | Custom — validates credentials, returns token status | ✅ |

### Photoshop tools (6 in v0.1)

| Tool name | Wraps Photoshop API endpoint | v0.1 |
|---|---|---|
| `photoshop_smart_object_replace` | `/pie/psdService/smartObject` | ✅ |
| `photoshop_document_manifest` | `/pie/psdService/documentManifest` | ✅ |
| `photoshop_apply_actions` | `/pie/psdService/photoshopActions` | ✅ |
| `photoshop_edit_text` | `/pie/psdService/text` | ✅ |
| `photoshop_apply_edits` | `/pie/psdService/documentOperations` | ✅ |
| `photoshop_remove_background` | `/sensei/cutout` | ✅ |

### Lightroom tools (4 in v0.1)

| Tool name | Wraps Lightroom API endpoint | v0.1 |
|---|---|---|
| `lightroom_apply_preset` | `/lrService/presets` | ✅ |
| `lightroom_auto_tone` | `/lrService/autoTone` | ✅ |
| `lightroom_auto_straighten` | `/lrService/autoStraighten` | ✅ |
| `lightroom_apply_edits` | `/lrService/edit` | ✅ |

**Total v0.1: 18 tools.**

### Deferred to v0.2

- Custom Models surface — `firefly_train_custom_model`, `firefly_list_custom_models`, `firefly_get_custom_model`
- GenStudio extensibility surface
- Multi-tenant credential management ([ADR-003](adrs/003-single-credential-per-instance-v0.1.md))
- HTTP transport ([ADR-002](adrs/002-node-typescript-stdio-transport.md))

## 6. Non-functional requirements

| Requirement | Target |
|---|---|
| Cold-start time (process launch → tools registered) | <2s |
| Tool call p50 latency (excluding Adobe API time) | <50ms overhead |
| Tool call p99 latency (excluding Adobe API time) | <250ms overhead |
| Auth token cache | In-memory, refresh 5 min before expiry |
| Error responses | Structured MCP errors with `code` + `message` + `details` |
| Logging | Structured JSON to stderr (MCP-compatible — stdout is reserved for protocol) |
| Memory footprint | <100 MB resident |
| Dependencies | Adobe SDKs + MCP SDK + minimal helpers only |

## 7. Architecture

```
┌──────────────────────────────────────────────────────────┐
│ Claude Code / Cursor / any MCP client                    │
└───────────────────┬──────────────────────────────────────┘
                    │ MCP protocol (stdio v0.1; HTTP v0.2)
┌───────────────────▼──────────────────────────────────────┐
│ @focusgts/firefly-services-mcp                           │
│                                                          │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│   │ Tool router  │  │ Token cache  │  │ Error mapper │  │
│   └──────┬───────┘  └──────────────┘  └──────────────┘  │
│          │                                               │
│   ┌──────▼─────────────────────────────────────────┐    │
│   │ Tool adapters (one per MCP tool)               │    │
│   │   - zod-validates MCP tool args                │    │
│   │   - maps args to SDK call shape                │    │
│   │   - calls Adobe SDK                            │    │
│   │   - maps SDK response to MCP content blocks    │    │
│   └──────┬─────────────────────────────────────────┘    │
└──────────┼───────────────────────────────────────────────┘
           │ uses
┌──────────▼───────────────────────────────────────────────┐
│ @adobe/firefly-apis | @adobe/photoshop-apis              │
│ @adobe/lightroom-apis | @adobe/firefly-services-common   │
└──────────┬───────────────────────────────────────────────┘
           │ HTTPS
┌──────────▼───────────────────────────────────────────────┐
│ firefly-api.adobe.io | image.adobe.io | ims-na1.adobe... │
└──────────────────────────────────────────────────────────┘
```

Stack:
- **Runtime:** Node.js 20+
- **Language:** TypeScript
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **Transport:** stdio for v0.1 ([ADR-002](adrs/002-node-typescript-stdio-transport.md))
- **Schema validation:** `zod`
- **Adobe layer:** four `@adobe/*` packages
- **Logging:** `pino` to stderr

Package layout: see `src/` tree in the repo.

## 8. Auth model

Single-credential-per-server-instance. See [ADR-003](adrs/003-single-credential-per-instance-v0.1.md).

## 9. Storage model

Triple-mode input (`uploadId` | `url` | `path`), dual-mode output (URL only, or URL + inline image bytes). See [ADR-004](adrs/004-storage-references.md).

## 10. Testing strategy

Four layers, from cheap to expensive.

### Layer 1 — Unit tests
- Mock each Adobe SDK class
- Per-tool test: schema validation, SDK call shape, error mapping
- Target: 95% line coverage on tool adapters
- Runs in CI on every PR

### Layer 2 — Integration tests
- Real Adobe SDK against a real IMS org
- One test per tool — smoke-test request/response shape
- Gated behind `FIREFLY_SERVICES_INTEGRATION_TEST=1` env var
- Runs in CI on merges to main, behind GitHub Actions secrets
- Manual run: `npm run test:integration`

### Layer 3 — MCP protocol tests
- Use [MCP Inspector](https://github.com/modelcontextprotocol/inspector) to verify tool discovery, schema validity, round-trip protocol behavior, error propagation
- Manual smoke test per release; automatable via the Inspector's CLI

### Layer 4 — End-to-end demo tests
- Three scripted demos exercising the most-likely real workflows:
  - **D1 — Single image generation:** Claude generates an image from a prompt
  - **D2 — Image-to-image pipeline:** Claude takes a source image, expands it, fills a region, returns the result (validates multi-tool storage-ref flow)
  - **D3 — PSD template assembly:** Claude takes a template + a Firefly-generated hero + brand text, runs Photoshop API smart-object replacement and text edit, returns the rendered JPEG (validates cross-API integration)
- D3 is the headline demo; it must look effortless

## 11. Release plan

| Version | Date target | Scope |
|---|---|---|
| **v0.0.1** | T + 1 week | Skeleton: server boots, registers 3 Firefly tools, `firefly_generate_image` actually works |
| **v0.1.0** | T + 2-3 weeks | Full 18-tool surface, integration tests green, README + examples |
| **v0.1.1** | T + 3-4 weeks | Bugfixes from internal review and early users |
| **v0.2.0** | T + 6-8 weeks | Custom Models tools, HTTP transport, multi-credential, hardened |

T = the day we kick off the build.

## 12. Open questions

1. **Hosting / distribution.** npm only, or also a Docker image? Current plan: npm for v0.1, Docker for v0.2.
2. **Telemetry.** Optional opt-in metrics (which tools get called, error rates, latency) — sent where? Could pipe to Catalyst's ruvector for cross-account pattern learning. Decide before v0.1 release.
3. **Repo visibility.** Private during development, public at v0.1.0 release.
4. **Submit to mcp.so / modelcontextprotocol.io registries** at v0.1.0 release? Yes, after Adobe partner review.

## 13. Risks

| Risk | Probability | Mitigation |
|---|---|---|
| Adobe ships their own official Firefly Services MCP | Medium | Design for upstream-mergeable / co-brandable; engage Adobe through normal partner channels if a convergence opportunity arises |
| Our SDK wrapping has a bug that produces incorrect output | Medium | Layer 2 + Layer 4 testing; pre-release internal review |
| Trademark / branding objection from Adobe | Low | Same NOTICE pattern as the skills repo |
| Rate-limit issues during demo | Low if we have a dedicated dev credential | Ask for a raised-limit dev IMS org before public demos |
| Storage-reference UX is confusing for users | Medium | Dual-mode contract documented; real demo testing in Layer 4 |

## 14. Success metrics (v0.1)

- 18 working tools
- All 4 testing layers green at release
- One successful end-to-end demo (live)
- GitHub repo public + npm package published
- Recognition / engagement from Adobe (DevRel reference, partner-event demo, or similar)

---

## References

- [`firefly-services-skills`](https://github.com/focusgts/firefly-services-skills) — companion skills repo; see the auto-updating [skills catalog](https://github.com/focusgts/firefly-services-skills/blob/main/plugins/firefly-services/skills/firefly-skills-catalog/SKILL.md) for the current index
- [Adobe Firefly Services documentation](https://developer.adobe.com/firefly-services/docs/)
- [MCP specification](https://modelcontextprotocol.io/docs/specification/)
- All five ADRs in [`docs/adrs/`](adrs/000-index.md)
