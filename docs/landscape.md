# The Adobe MCP landscape — and where this server fits

*Last verified: 2026-08-10. Adobe's surfaces move quickly; re-verify claims against the sources linked below before reusing them in outward-facing material.*

Adobe now operates its own MCP servers. This page maps the official surfaces honestly and states exactly what this server does that they don't. If you're evaluating which to use: they solve different problems, and in enterprise pipelines they compose.

## The map

| | **This server** (`@focusgts/firefly-services-mcp`) | **Adobe Run-Workflow MCP** | **Adobe for creativity** connector |
|---|---|---|---|
| What it is | Open-source MCP server exposing the **Firefly Services REST APIs** as direct, parameter-level tools | Adobe-hosted MCP for composing and executing **Firefly Creative Production workflows** | Adobe-hosted consumer/prosumer connector for creative tasks in chat assistants |
| Endpoint | Runs locally (stdio), from npm | `https://run-workflow.adobe.io/mcp` (hosted, closed-source) | `https://adobe-creativity.adobe.io/mcp` (hosted, closed-source) |
| Unit of work | One API operation — `generateImages` with seeds/style refs, fill/expand with masks, Photoshop actionJSON, Lightroom presets | One composed workflow — compose, submit, poll, publish | One creative task — presets, template edits, crops, quick video ops |
| Auth | Your own **OAuth server-to-server** credentials from the Adobe Developer Console; your quota, your keys | Admin-issued **expiring IMS token + API key**, pasted into client config | Browser OAuth sign-in (guest mode available), credit-metered |
| Gating | None — Apache-2.0, npm, any org with Firefly Services API access | **Firefly Creative Production for Enterprise** entitlement ("select enterprise plans", contact sales; consumption billed as Operations per the admin-console Rate Card) | Free tier with limits; paid Adobe plans unlock more; tool manifest varies by client surface |
| Source | Open (this repo) | Closed | Closed |
| List economics | Standard Firefly Services API consumption under your own Adobe contract — no per-workflow markup | Operations-metered per workflow type; Adobe publishes a [rate card](https://helpx.adobe.com/firefly/web/work-with-enterprise-features/creative-production/workflow-builder-rate-card.html) (as of Aug 2026, reported list rate $0.15/Operation with image workflows at 75–250 Operations *per output asset* — roughly $11–$38 list per image — and video at 15–30 Operations *per output second*; verify current figures on the live page). Contracted rates differ; the per-org Rate Card is in the Admin Console | Credit-metered (free tier ≈ 25 generative credits/mo) |
| Sources | [README](../README.md) | [Overview](https://helpx.adobe.com/firefly/web/work-with-enterprise-features/creative-production/run-workflow-mcp-overview.html) · [registry](https://ai.adobe.io/registry/mcp/api/v1/servers) | [developer.adobe.com](https://developer.adobe.com/adobe-for-creativity/) · [announcement](https://blog.adobe.com/en/publish/2026/04/28/adobe-for-creativity-connector) |

Adobe's public MCP registry ([ai.adobe.io](https://ai.adobe.io/registry/mcp/api/v1/servers), mirrored at [AdobeDocs/ai-registry-docs](https://github.com/AdobeDocs/ai-registry-docs)) lists these plus Experience Cloud servers (AEM, Analytics, CJA, AJO, RTCDP, Commerce, Workfront) and a docs-assistant Express Developer MCP. As of the verification date, **no official Adobe MCP server exposes the Firefly Services developer APIs as direct, parameter-level tools** — that is the specific gap this server fills.

## When to use which

- **Use Adobe's Run-Workflow MCP** when your org has the Creative Production for Enterprise entitlement and your task fits a composed workflow — batch-run a defined pipeline over an asset set inside Adobe's governed environment.
- **Use Adobe's creativity connector** for interactive creative work in Claude, ChatGPT, or Copilot — it's built for people, not pipelines.
- **Use this server** when you need what an automation engineer needs: individual API operations with full parameter control, your own credentials and quota, no entitlement gate, open source you can audit and embed in any pipeline — CI jobs, queue workers, agent frameworks, or a Claude Code session.

They compose: a pipeline can use this server for parameter-level generation and editing steps, and Run-Workflow MCP for entitled, governed batch execution. Nothing here competes with Adobe's SDKs either — this server wraps them ([ADR-001](adrs/001-wrap-adobe-sdks-not-reimplement.md)).

**On economics:** the workflow layer carries a substantial list premium — at published list rates a single image through a Creative Production workflow is $11.25–$37.50 in Operations, where the same underlying API calls under your own Firefly Services contract bill at API consumption rates. What you're buying with that premium is Adobe's managed orchestration, governance, and review surfaces. For high-volume programmatic pipelines where you own the orchestration (queues, retries, review), parameter-level API access under your own credentials is the cost-structure this server exists to serve.

## The claim we make — precisely

> `@focusgts/firefly-services-mcp` is the only **open-source** MCP server exposing the Firefly Services REST APIs (Firefly image/video, Photoshop API, Lightroom API) as **direct, parameter-level tools** under **standard OAuth server-to-server credentials**.

We do **not** claim to be the only MCP path to Firefly — Adobe operates its own MCP servers, listed above, and they are the right choice for the use cases they target.
