# ADR-003: Single-credential-per-server-instance for v0.1

**Status:** Accepted (with explicit deferral of multi-tenant to v0.2)
**Date:** 2026-05-18

## Context

The MCP server needs to authenticate against Adobe IMS using OAuth Server-to-Server credentials. A `client_id` + `client_secret` pair grants access to a specific IMS organization and its provisioned API entitlements.

A real customer-facing service like Catalyst might serve multiple customer organizations from a single MCP server instance (one server, many credentials, routing per call). A single-user developer tool running locally serves one user against one IMS org.

These two modes have very different complexity.

## Decision

**v0.1 ships as single-credential-per-server-instance.** The server reads `FIREFLY_SERVICES_CLIENT_ID` and `FIREFLY_SERVICES_CLIENT_SECRET` from the environment at startup, caches one token in memory, and refreshes it before expiry.

**Multi-tenant credential management is explicitly deferred to v0.2.** When it lands, it will support per-tool-call credential selection (likely via a `credentials_alias` argument that maps to one of multiple configured credential sets), with credential storage outside the env-var boundary.

## Consequences

### Positive
- Drastically smaller surface area in v0.1 — one credential, one token cache, no routing logic
- Matches how MCP servers are typically deployed: one instance per user / per project
- Aligns with stdio transport (ADR-002) — a stdio server is inherently single-process, single-user
- Reduces the v0.1 attack surface — there is no credential-routing logic to misroute a call against the wrong customer's quota
- Secrets management is the standard env-var pattern, fully compatible with `.env` files, `direnv`, secrets managers, and Claude Code's per-server env configuration

### Constraining
- A FocusGTS engineer working across multiple customer accounts cannot use a single MCP server instance for all of them — they must launch separate instances with separate credentials
- A shared / hosted MCP deployment is not yet possible (also blocked by stdio transport in ADR-002; the two decisions reinforce each other)
- Internal FocusGTS tooling that wants to call Firefly across multiple customers (Catalyst, future internal pipelines) will need its own multi-credential layer or wait for v0.2

### Mitigations
- v0.2 will add multi-credential support; ADR will supersede this one
- For v0.1 multi-customer needs, users can run multiple server instances, one per customer, each with a distinct `MCP_SERVER_NAME` (e.g., `firefly-services-customer-a`, `firefly-services-customer-b`) so Claude can route to the right one explicitly. This is ugly but workable.

## Alternatives considered

### Multi-tenant from day one
Build credential routing into v0.1. Tools accept a `customer` or `org` argument; server looks up the matching credentials.

**Rejected because:** doubles v0.1's complexity for a use case that single-user developers (the v0.1 audience) do not have. Internal multi-customer tooling at FocusGTS can wait the ~6 weeks for v0.2.

### File-based credential set
Read credentials from a config file (`~/.config/firefly-services-mcp/credentials.toml`) listing multiple credential aliases. Server picks one at startup based on `MCP_CREDENTIAL_ALIAS` env var.

**Rejected because:** still single-credential-per-instance in practice; the only difference is where the credential comes from. Adds the complexity of a config file format without enabling any actually-different behavior. v0.2's multi-tenant work supersedes both.

### OAuth user-delegated flow
Have the user log in interactively (browser-based OAuth) and grant the server access to their personal Adobe account.

**Rejected because:** Firefly Services is server-to-server only. There is no user-delegated grant. Customers' end users do not call Firefly Services directly; their backends do.

## Migration plan to v0.2

When multi-tenant lands:
- Existing env-var-based single-credential config continues to work (`FIREFLY_SERVICES_CLIENT_ID` is treated as the default credential alias)
- New config file (`~/.config/firefly-services-mcp/credentials.toml`) can list multiple aliases
- Each tool gains an optional `credentials_alias` argument
- No breaking changes for v0.1 users

## References

- [ADR-002: Node.js + TypeScript + stdio transport](002-node-typescript-stdio-transport.md) — reinforces single-instance posture
- [Adobe Server-to-Server OAuth](https://developer.adobe.com/developer-console/docs/guides/authentication/ServerToServerAuthentication/)
- `firefly-services-skills` repo, `firefly-services-auth` skill — single-credential auth pattern documented in detail
