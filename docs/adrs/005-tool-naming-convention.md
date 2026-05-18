# ADR-005: Tool naming — `<product>_<action>_<object>` snake_case

**Status:** Accepted
**Date:** 2026-05-18

## Context

MCP tool names are user-facing in two ways:

1. **Discovery** — clients list tools by name. Users (and the LLM) see them in autocomplete and selection menus.
2. **Invocation** — Claude refers to tools by name when calling them. The name shapes how the LLM thinks about *what the tool does* before it even reads the description.

A bad naming convention shows up as either ambiguity (which `generate` tool? from which product?) or noise (every tool starting with `adobe_firefly_services_api_v3_`). The convention is set in v0.1 and almost impossible to change later without breaking every existing Claude prompt that references the tools.

The MCP specification is permissive about names — any string is valid. Community MCP servers have settled on no single convention. Examples in the wild:

- `read_file`, `write_file` (Anthropic example servers — verb-first)
- `slack.send_message` (some servers use dots — namespace separators)
- `github:create_issue` (some use colons)
- `notion-create-page` (some use kebab-case)

## Decision

**Tool names use the form `<product>_<action>_<object>` in snake_case.**

Examples:

```
firefly_generate_image
firefly_generate_similar
firefly_expand_image
firefly_fill_image
firefly_generate_video
firefly_upload_image
firefly_check_auth
photoshop_smart_object_replace
photoshop_document_manifest
photoshop_apply_actions
photoshop_edit_text
lightroom_apply_preset
lightroom_auto_tone
```

Rules:
- `<product>` is one of: `firefly`, `photoshop`, `lightroom`. Lowercased. Matches the npm SDK package name minus `@adobe/` and `-apis`.
- `<action>` is a present-tense verb describing what the tool does: `generate`, `expand`, `fill`, `apply`, `replace`, `check`, `list`, `train`, `upload`, `auto` (for auto-* operations).
- `<object>` is the noun the action operates on: `image`, `video`, `preset`, `manifest`, `actions`, `text`, `auth`, `models`.
- Separator is `_` (underscore). No dots, colons, or kebab-case.
- All lowercase.
- 2-4 tokens total. 4 only when needed for disambiguation (`photoshop_smart_object_replace`).

## Consequences

### Positive
- Visual hierarchy: every tool starts with the product, so a developer scanning `tools.list()` immediately groups them. `firefly_*` calls firefly-api.adobe.io. `photoshop_*` and `lightroom_*` call image.adobe.io.
- LLM disambiguation: when Claude is asked to *"generate an image"*, the tools `firefly_generate_image` and `firefly_generate_similar` are visibly co-located, and the LLM can compare descriptions side by side.
- Snake_case matches MCP community precedent (the most-starred MCP servers use it) and matches Adobe's own Python doc conventions for API method names.
- Scales: adding new products (`indesign_*`, `genstudio_*`) extends the convention without ambiguity.
- Programmatic: tool names are valid identifiers in every common language, so codegen and registries can use them directly as keys.

### Constraining
- 4-token names get slightly long (`photoshop_smart_object_replace` = 30 chars). Acceptable; better than `photoshop_replace` (which doesn't say *what*) or `psd_replace_smart_object` (which loses the product anchor).
- Snake_case in a TypeScript file with `camelCase` SDK method names creates a small typographical mismatch — a tool named `firefly_generate_image` calls `client.generateImages()`. The mismatch is intentional (tool name = MCP wire format; SDK method = TypeScript) but worth documenting.
- Cannot retroactively rename without breaking existing Claude prompts and any external content (blog posts, examples) that cites tool names.

### Mitigations
- The mismatch between tool name and SDK method is encoded in one place per tool (the adapter file); the tool name is the public contract, the SDK method is the implementation detail.
- A future ADR can introduce aliases (one tool name maps to two registered names) if a rename becomes unavoidable.

## Alternatives considered

### `<product>.<action>.<object>` dot notation
Mirrors many community MCP servers and feels like a method path.

**Rejected because:** some MCP clients (especially older ones or non-Claude implementations) handle dots in tool names inconsistently — some treat them as namespace boundaries, some don't. Snake_case is universally safe.

### `<product>-<action>-<object>` kebab-case
Reads slightly more naturally and matches URL-style identifiers.

**Rejected because:** less common in MCP-server precedent than snake_case; not valid as a programmatic identifier (some clients pass tool names through as variable/key names downstream).

### `<action>_<object>` no product prefix
Shorter. Names like `generate_image`, `apply_preset`. Product is implicit in the server identity.

**Rejected because:** when a single Claude Code session has multiple MCP servers loaded (this MCP server + the GitHub one + the Slack one), unprefixed names collide. `firefly_generate_image` is unambiguous; `generate_image` would conflict with the next MCP server that ships an image-generation tool.

### CamelCase
`fireflyGenerateImage`. Matches the SDK method-name style.

**Rejected because:** MCP-community convention is snake_case; camelCase would feel un-MCP-shaped to users discovering tools across servers.

## References

- [ADR-002: Node.js + TypeScript + stdio transport](002-node-typescript-stdio-transport.md) — the SDK method names (camelCase) live inside the adapter; tool names (snake_case) are the wire contract
- [MCP tool specification](https://modelcontextprotocol.io/docs/specification/2025-06-18/server/tools)
- Sample MCP servers: [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) — community precedent
