/**
 * Tool registry — registers every MCP tool against the server.
 *
 * As tools are added for v0.1, they get an entry here. Each tool module
 * exports a `registerXxx(server, ...)` function that wires the tool into
 * the McpServer's `registerTool()` API.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TokenCache } from "../auth/token-cache.js";
import { registerCheckAuth } from "./firefly/check-auth.js";

export interface ToolContext {
  tokenCache: TokenCache;
}

export function registerAllTools(server: McpServer, ctx: ToolContext): void {
  // ── Firefly tools ───────────────────────────────────────────────────
  registerCheckAuth(server, ctx.tokenCache);

  // Coming in v0.1 (placeholder ordering for the future register* calls):
  //   registerGenerateImage(server, ctx.tokenCache);
  //   registerGenerateSimilar(server, ctx.tokenCache);
  //   registerExpandImage(server, ctx.tokenCache);
  //   registerFillImage(server, ctx.tokenCache);
  //   registerGenerateObjectComposite(server, ctx.tokenCache);
  //   registerGenerateVideo(server, ctx.tokenCache);
  //   registerUploadImage(server, ctx.tokenCache);

  // ── Photoshop tools (v0.1) ──────────────────────────────────────────
  //   registerPhotoshopSmartObjectReplace(server, ctx.tokenCache);
  //   ... etc

  // ── Lightroom tools (v0.1) ──────────────────────────────────────────
  //   registerLightroomApplyPreset(server, ctx.tokenCache);
  //   ... etc
}
