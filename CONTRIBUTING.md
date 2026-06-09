# Contributing to `@focusgts/firefly-services-mcp`

Thanks for your interest. This document explains how to file issues, propose changes, and develop locally.

## Code of conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating you agree to uphold it.

## How to report a bug

Open a [GitHub issue](https://github.com/focusgts/firefly-services-mcp/issues/new) with:

- The tool name (e.g., `firefly_generate_image`) or area of the codebase
- A minimal reproduction — the exact tool args, the env you ran it in (Claude Code version, Node version, OS)
- What you expected to happen
- What actually happened, including any error text the tool returned

If your bug is a **security vulnerability**, please follow the disclosure process in [SECURITY.md](SECURITY.md) instead — do not open a public issue.

## How to request a feature

Open a GitHub issue. Useful framing:

- Which Adobe API surface is involved (Firefly / Photoshop API / Lightroom API / new)
- What's the use case in one sentence
- Whether the underlying Adobe SDK already supports it (search `@adobe/firefly-apis`, `@adobe/photoshop-apis`, `@adobe/lightroom-apis` in `node_modules/` after `npm install`)
- Whether the Adobe SDK does NOT support it, in which case the feature request belongs upstream first

Per [ADR-001](docs/adrs/001-wrap-adobe-sdks-not-reimplement.md), this project does not reimplement the Adobe API surface. If a capability is missing from the SDK, the SDK is the right place to file.

## How to propose a code change

1. **Open an issue first** for substantive changes so we can agree on approach before you write code
2. Fork the repo, create a branch off `main`
3. Make your changes
4. Add or update tests — every change to a tool adapter needs at minimum a unit test
5. Run the full local gate before opening the PR:
   ```bash
   npm run lint
   npm test
   npm run test:integration:mocked
   ```
   All three must pass. CI re-runs them.
6. Open a pull request against `main` with:
   - A description of the change and why
   - A reference to the issue it addresses
   - A note on what you tested

## Architectural ground rules

Before touching the code, read [`docs/adrs/000-index.md`](docs/adrs/000-index.md). The five ADRs are short and they constrain what changes are accepted:

- ADR-001: wrap Adobe SDKs, do not reimplement
- ADR-002: Node.js + TypeScript + stdio transport
- ADR-003: single-credential-per-server-instance for v0.1
- ADR-004: storage references — triple-mode input, dual-mode output
- ADR-005: tool naming — `<product>_<action>_<object>` snake_case

A change that contradicts an existing ADR needs a new ADR to supersede it.

## Local development setup

```bash
git clone https://github.com/focusgts/firefly-services-mcp.git
cd firefly-services-mcp
npm install           # also builds dist/ via the prepare hook

# Dev loop — no build step needed
npm run dev

# Build for production
npm run build

# Type-check only
npm run lint
```

### Testing

```bash
# Unit tests — SDK-level mocks, fast
npm test

# Mocked integration tests — HTTP-level mocks via msw, ~15s
npm run test:integration:mocked

# Live integration tests — real Adobe API, requires valid credentials
FIREFLY_SERVICES_INTEGRATION_TEST=1 \
FIREFLY_SERVICES_CLIENT_ID=<your id> \
FIREFLY_SERVICES_CLIENT_SECRET=<your secret> \
npm run test:integration:live
```

### Adding a new tool

The pattern is consistent across all 18 existing tools. Use one of them as a template — `src/tools/firefly/check-auth.ts` is the smallest and clearest. The general shape:

1. Create the adapter file at `src/tools/<product>/<tool-name>.ts`
2. Define the input zod schema. Snake_case argument names. Include `.describe()` on every field so LLMs route correctly.
3. Export a `register<ToolName>(server, client)` function
4. Wire it into `src/tools/<product>/index.ts`
5. Add tests:
   - At least one happy-path test in `test/unit/<product>/<tool-name>.test.ts`
   - At least one error-path test
   - At least one mocked integration test in `test/integration/<product>.test.ts`
6. Use the `callTool` helper from `test/util/call-tool.ts` so zod `.default()` values are exercised — do NOT bypass with `_registeredTools[name].handler(args, {})` directly

### Tool description quality

This is what makes the difference between a tool the LLM picks correctly and a tool that gets routed to wrongly. For each new tool:

- The MCP-level `description` field should state what it does, when to use it, and when NOT to use it
- Include common trigger phrases the user might say
- Disambiguate from sibling tools explicitly (e.g., `photoshop_apply_edits` vs `photoshop_apply_actions`)

## Code style

- Strict TypeScript — `tsc --noEmit` must pass
- No `any` / `unknown` casts unless there's a documented reason (typically Adobe SDK boundary)
- Errors return structured `toolError(mapSdkError(err))` results — never throw out of a tool handler
- Logs go to stderr only (the MCP protocol uses stdout)
- Token previews, file paths, anything credential-shaped — redact before logging or returning

## License

By contributing, you agree your contribution is licensed under the [Apache License 2.0](LICENSE).
