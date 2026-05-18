/**
 * Tool registry — registers every MCP tool against the server.
 *
 * As tools are added for v0.1, they get an entry here. Each tool module
 * exports a `registerXxx(server, ...)` function that wires the tool into
 * the McpServer's `registerTool()` API.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FireflyClient } from "@adobe/firefly-apis";
import type { TokenCache } from "../auth/token-cache.js";
import { registerCheckAuth } from "./firefly/check-auth.js";
import { registerGenerateImage } from "./firefly/generate-image.js";
import { registerUploadImage } from "./firefly/upload-image.js";

export interface ToolContext {
  tokenCache: TokenCache;
  fireflyClient: FireflyClient;
}

export function registerAllTools(server: McpServer, ctx: ToolContext): void {
  // ── Firefly tools ───────────────────────────────────────────────────
  registerCheckAuth(server, ctx.tokenCache);
  registerUploadImage(server, ctx.fireflyClient);
  registerGenerateImage(server, ctx.fireflyClient);

  // Coming next in v0.1:
  //   registerGenerateSimilar(server, ctx.fireflyClient);
  //   registerExpandImage(server, ctx.fireflyClient);
  //   registerFillImage(server, ctx.fireflyClient);
  //   registerGenerateObjectComposite(server, ctx.fireflyClient);
  //   registerGenerateVideo(server, ctx.fireflyClient);

  // ── Photoshop tools (v0.1) ──────────────────────────────────────────
  //   registerPhotoshopSmartObjectReplace(server, ctx.tokenCache);
  //   registerPhotoshopDocumentManifest(server, ctx.tokenCache);
  //   registerPhotoshopApplyActions(server, ctx.tokenCache);
  //   registerPhotoshopEditText(server, ctx.tokenCache);
  //   registerPhotoshopApplyEdits(server, ctx.tokenCache);
  //   registerPhotoshopRemoveBackground(server, ctx.tokenCache);

  // ── Lightroom tools (v0.1) ──────────────────────────────────────────
  //   registerLightroomApplyPreset(server, ctx.tokenCache);
  //   registerLightroomAutoTone(server, ctx.tokenCache);
  //   registerLightroomAutoStraighten(server, ctx.tokenCache);
  //   registerLightroomApplyEdits(server, ctx.tokenCache);
}
