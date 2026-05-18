# ADR-002: Node.js + TypeScript + stdio transport

**Status:** Accepted
**Date:** 2026-05-18

## Context

The MCP server needs a runtime, a language, and a transport. Each is a fork in the road that affects every downstream decision (build, test, deployment, contributor accessibility, performance characteristics).

## Decision

**Runtime: Node.js 20+. Language: TypeScript. Transport: stdio for v0.1; HTTP added in v0.2.**

## Consequences

### Positive
- Native interop with the official Adobe SDKs (ADR-001) — all four are TypeScript packages targeting Node
- Native interop with the MCP SDK (`@modelcontextprotocol/sdk`), which ships first-class TypeScript support
- TypeScript's structural typing catches MCP tool schema / SDK request shape mismatches at compile time, not runtime
- `stdio` is the default transport in Claude Code, Cursor, and most MCP-capable clients — installing the server is `claude mcp add firefly-services -- npx @focusgts/firefly-services-mcp`, no port mapping or auth proxy required
- npm distribution gives us a one-line install path (`npx @focusgts/firefly-services-mcp`)
- Cold start <2s, well within MCP's tolerances

### Constraining
- Excludes the Python ecosystem from contributing in their primary language. Most Adobe enterprise data teams are Python; some FocusGTS work is Python. Those teams cannot contribute tools to this server without picking up TypeScript.
- stdio is unsuitable for remote/shared deployments — a single user's machine runs a single instance. Multi-user serving is deferred to v0.2 with the HTTP transport.
- Native Node modules (sharp, onnxruntime-node, etc.) can complicate packaging if we ever need them. v0.1 deliberately avoids them — the four Adobe SDKs are pure JS/TS.

### Mitigations
- A future Python re-implementation can ship as `@focusgts/firefly-services-mcp-py` if there is demand. The MCP protocol guarantees tool-equivalence across languages.
- HTTP transport is scoped for v0.2; the server's tool registry and tool adapters are transport-agnostic, so the additional surface area is just the protocol bridge.

## Alternatives considered

### Python + stdio
Adobe's enterprise customer engineering teams are predominantly Python. A Python MCP server would have a broader contributor pool inside FocusGTS.

**Rejected because:** Adobe does not ship a Python SDK for Firefly Services. Adopting Python would force us to build our own typed client (which ADR-001 explicitly rejects). The Adobe-SDK-alignment argument is stronger than the Python-contributor argument.

### Rust + stdio
Smaller binary, faster cold start, no runtime install required.

**Rejected because:** No first-party Adobe SDK in Rust. Would require either reimplementing (ADR-001 rejection) or wrapping the JS SDK via FFI (operationally fragile).

### Node + HTTP transport from day one
Skip stdio; ship as a hosted service.

**Rejected because:** v0.1 audience is single-user developers running Claude Code / Cursor locally. They need stdio. HTTP transport is additive in v0.2, not a replacement.

## References

- [MCP transport specification](https://modelcontextprotocol.io/docs/specification/2025-06-18/basic/transports)
- [@modelcontextprotocol/sdk on npm](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
- [Claude Code MCP integration guide](https://docs.anthropic.com/en/docs/claude-code/mcp)
