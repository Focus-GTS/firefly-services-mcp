/**
 * Firefly tool sub-registry. Imported by src/tools/index.ts.
 *
 * As each Firefly tool is implemented, add its registration here.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FireflyClient } from "@adobe/firefly-apis";
import type { TokenCache } from "../../auth/token-cache.js";
import { registerCheckAuth } from "./check-auth.js";
import { registerUploadImage } from "./upload-image.js";
import { registerGenerateImage } from "./generate-image.js";
import { registerGenerateSimilar } from "./generate-similar.js";
import { registerExpandImage } from "./expand-image.js";
import { registerFillImage } from "./fill-image.js";
import { registerGenerateObjectComposite } from "./generate-object-composite.js";
import { registerGenerateVideo } from "./generate-video.js";
import { registerGetJobStatus } from "./get-job-status.js";

export function registerFireflyTools(
  server: McpServer,
  fireflyClient: FireflyClient,
  tokenCache: TokenCache,
  clientId: string,
): void {
  registerCheckAuth(server, tokenCache);
  registerUploadImage(server, fireflyClient);
  registerGenerateImage(server, fireflyClient);
  registerGenerateSimilar(server, fireflyClient);
  registerExpandImage(server, fireflyClient);
  registerFillImage(server, fireflyClient);
  registerGenerateObjectComposite(server, fireflyClient);
  registerGenerateVideo(server, fireflyClient);
  registerGetJobStatus(server, tokenCache, clientId);
}
