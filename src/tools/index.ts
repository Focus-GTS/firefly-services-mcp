/**
 * Tool registry — top-level dispatch.
 *
 * Each product (firefly/, photoshop/, lightroom/) has its own sub-registry
 * that registers all of its tools. This isolation lets per-product code
 * evolve independently without conflicting edits.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FireflyClient } from "@adobe/firefly-apis";
import type { PhotoshopClient } from "@adobe/photoshop-apis";
import type { LightroomClient } from "@adobe/lightroom-apis";
import type { TokenCache } from "../auth/token-cache.js";
import { registerFireflyTools } from "./firefly/index.js";
import { registerPhotoshopTools } from "./photoshop/index.js";
import { registerLightroomTools } from "./lightroom/index.js";

export interface ToolContext {
  tokenCache: TokenCache;
  fireflyClient: FireflyClient;
  photoshopClient: PhotoshopClient;
  lightroomClient: LightroomClient;
}

export function registerAllTools(server: McpServer, ctx: ToolContext): void {
  registerFireflyTools(server, ctx.fireflyClient, ctx.tokenCache);
  registerPhotoshopTools(server, ctx.photoshopClient);
  registerLightroomTools(server, ctx.lightroomClient);
}
