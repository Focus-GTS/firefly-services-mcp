# ADR-001: Wrap Adobe SDKs; do not reimplement the API surface

**Status:** Accepted
**Date:** 2026-05-18

## Context

Building an MCP server for Adobe Firefly Services has two plausible architectures:

1. **Wrap** — depend on Adobe's official SDKs (`@adobe/firefly-apis`, `@adobe/photoshop-apis`, `@adobe/lightroom-apis`, `@adobe/firefly-services-common-apis`) and translate MCP tool calls into SDK method calls.
2. **Reimplement** — depend only on a low-level HTTP client; build our own typed client against the Firefly Services OpenAPI specs and skip the official SDKs entirely.

The argument for reimplementing is independence — we control the entire stack and can ship faster than Adobe updates the SDKs. The argument for wrapping is correctness — Adobe maintains the SDKs, evolves them with the platform, and ships OpenAPI specs inside them as the canonical source of truth.

## Decision

**Wrap. Adobe's SDKs are the canonical, version-controlled, Adobe-maintained interface to Firefly Services. Our MCP server is a thin adapter from MCP tool calls to SDK method calls — nothing more.**

The MCP server's job is to expose Adobe's existing API surface through the MCP protocol. It is not to model the API surface independently.

## Consequences

### Positive
- Endpoint paths, request shapes, and response shapes are guaranteed correct by Adobe
- API evolution (new endpoints, deprecations) is inherited by bumping the SDK version
- The Adobe team's typing work (`@adobe/firefly-services-sdk-core` ships shared response types) is reused
- Our codebase stays small — most files are 50-100 lines of adapter glue
- Future Adobe-side feature additions (e.g., new content classes, new endpoints) require only an SDK bump in `package.json`

### Constraining
- We inherit any SDK bugs until Adobe fixes them upstream
- We are tied to the SDK's release cadence for new endpoints — if Adobe ships an endpoint in their docs but not in the SDK, we cannot expose it as a tool until the SDK catches up
- Some MCP-shaped UX desires (e.g., auto-uploading a local file path) require small util layers that the SDK does not provide

### Mitigations
- The util layer (`src/util/`) handles the small set of MCP-specific helpers (storage-ref dispatch, image inlining, error mapping) — these are explicitly outside the wrapped SDK
- For endpoints that exist in Adobe docs but not the SDK (e.g., Custom Models, async-suffix variants), we document the gap explicitly in the README and consider PR-ing the SDK upstream

## Alternatives considered

### Reimplement directly from OpenAPI specs
The SDKs ship OpenAPI specs inside their packages (`oas/*.json`). We could codegen our own typed client from those specs and skip the SDKs.

**Rejected because:** the SDK is more than codegen — it includes the token provider (`ServerToServerTokenProvider`), retry logic, shared response shapes, and Adobe-tested behavior. Reimplementing all of this is reinventing what Adobe already maintains for free.

### Hand-roll a thin HTTP client
Skip the SDK entirely; call `firefly-api.adobe.io` directly with `fetch`.

**Rejected because:** loses Adobe's typing, loses Adobe's auth implementation, requires us to maintain our own request/response shapes. The trade is independence for ~5x more code to maintain.

## References

- [@adobe/firefly-apis on npm](https://www.npmjs.com/package/@adobe/firefly-apis)
- [@adobe/photoshop-apis on npm](https://www.npmjs.com/package/@adobe/photoshop-apis)
- [@adobe/lightroom-apis on npm](https://www.npmjs.com/package/@adobe/lightroom-apis)
- [@adobe/firefly-services-common-apis on npm](https://www.npmjs.com/package/@adobe/firefly-services-common-apis)
