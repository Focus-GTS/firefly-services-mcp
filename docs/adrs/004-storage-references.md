# ADR-004: Storage references — triple-mode input, dual-mode output

**Status:** Accepted
**Date:** 2026-05-18

## Context

Firefly Services and the Photoshop / Lightroom APIs all consume and produce images. The platform requires images to be passed as **references**, not raw bytes:

- A storage reference is either an `uploadId` (an opaque identifier returned by Firefly's `/v2/storage/image` upload endpoint) or a pre-signed URL pointing to a customer-controlled bucket (S3, Azure Blob, Google Cloud Storage, Dropbox).
- Outputs come back as pre-signed URLs that expire ~1 hour later.

For an LLM-driven MCP client (Claude Code, Cursor), the natural ways to refer to an image are:

1. *"This image at this URL"* — the user has a URL
2. *"This file on disk"* — the user has a local path
3. *"This image we already uploaded to Firefly earlier in the session"* — the LLM remembers an `uploadId` from a previous tool call

Adobe's SDK accepts (1) and (3) natively. (2) requires an extra `upload` call first. From an LLM's perspective, all three should feel equivalent — the server should DWIM.

Similarly for outputs: a generated image's URL is useless if the LLM cannot actually *see* the image. Claude can render inline image content blocks, so the server can fetch the bytes from the URL and return them inline. But this consumes bandwidth and is not always desired — for batch workloads, the URL alone is sufficient.

## Decision

### Input — triple-mode (`uploadId` | `url` | `path`)

Every tool that takes a source image accepts an `image_ref` argument with three mutually-exclusive shapes:

```
{ "uploadId": "abc-123..." }  // already uploaded to Firefly
{ "url":      "https://..." } // pre-signed URL on caller-controlled storage
{ "path":     "/local/path" } // local file; server auto-uploads via /v2/storage/image
```

The server dispatches:
- `uploadId` → SDK call directly with the `uploadId` field
- `url` → SDK call directly with the `url` field
- `path` → server uploads the file first via `firefly_upload_image` semantics, then calls the SDK with the resulting `uploadId`. The auto-upload is transparent; the user does not see a separate upload tool call.

Validation: exactly one of the three fields must be present. Otherwise the tool returns an `INVALID_IMAGE_REF` error before any SDK call is made.

### Output — dual-mode (`return_inline_image` flag)

Every tool that produces a generated image accepts an optional `return_inline_image` boolean argument, defaulting to `true`.

- `return_inline_image: true` (default) — server fetches the bytes from the Adobe-issued URL and returns them as an MCP `image` content block alongside the URL. Claude can see the image inline.
- `return_inline_image: false` — server returns only the URL. The caller is responsible for fetching the bytes (or not).

The URL is **always** returned regardless of the flag, so downstream tool calls can chain.

## Consequences

### Positive
- LLM UX is intuitive: Claude can pass any of three image shapes naturally without the user thinking about Adobe-specific concepts
- Auto-upload from `path` means a user can say *"generate a variation of the image at /tmp/hero.png"* and Claude can call one tool, not two
- Inline image return means Claude can *see* and reason about generated outputs — critical for iterative prompting workflows
- The flag-driven output mode lets batch/headless workflows skip bandwidth they don't need
- Validation is upfront; SDK never receives a malformed reference

### Constraining
- The triple-mode input adds a small amount of complexity to every image-handling tool
- Auto-upload on `path` mode silently consumes Firefly upload quota — users with rate-limit concerns may prefer to upload once and reuse the `uploadId`. Worth documenting.
- The inline-image fetch adds ~50-500ms to the tool round-trip depending on image size and CDN distance — usually fine, occasionally noticeable
- The zod schemas for image refs are more complex than a simple string

### Mitigations
- Documentation calls out the auto-upload behavior explicitly so users can choose to manage uploads manually for batch workloads
- `return_inline_image: false` is the recommended setting for any tool call inside a batch/loop pattern
- A shared `imageRefSchema` zod definition is reused across every tool to keep the validation surface consistent

## Alternatives considered

### URL-only input, URL-only output
The simplest contract. Users must upload to Firefly themselves first, never pass local paths, and Claude never sees generated images inline.

**Rejected because:** loses the LLM UX. Every prompt would require a two-step "upload then generate" dance, doubling tool call volume and confusing the LLM about which step happens when.

### Always-inline output (no flag)
Always fetch and return bytes inline. No `return_inline_image` flag.

**Rejected because:** batch and headless workflows would burn bandwidth they don't need. A `return_inline_image: false` opt-out is essentially free in code and important for cost-sensitive callers.

### Separate tools per input mode
`firefly_generate_image_from_path`, `firefly_generate_image_from_url`, `firefly_generate_image_from_upload_id` — three tools, one per input shape.

**Rejected because:** triples the tool surface area; the LLM has to know which to pick; the surface area scales linearly with each new image-consuming endpoint.

## References

- [ADR-001: Wrap Adobe SDKs](001-wrap-adobe-sdks-not-reimplement.md) — the SDK call shape is the contract we're adapting to
- [Firefly Image Upload guide](https://developer.adobe.com/firefly-services/docs/firefly-api/guides/concepts/image-upload/)
- `firefly-services-skills` repo, `firefly-services-storage-refs` skill — full storage-reference playbook for human consumers
