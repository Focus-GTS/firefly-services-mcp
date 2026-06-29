/**
 * Photoshop tool sub-registry. Imported by src/tools/index.ts.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PhotoshopClient } from "@adobe/photoshop-apis";
import type { TokenCache } from "../../auth/token-cache.js";
import { registerSmartObjectReplace } from "./smart-object-replace.js";
import { registerDocumentManifest } from "./document-manifest.js";
import { registerApplyActions } from "./apply-actions.js";
import { registerEditText } from "./edit-text.js";
import { registerApplyEdits } from "./apply-edits.js";
import { registerRemoveBackground } from "./remove-background.js";

export function registerPhotoshopTools(
  server: McpServer,
  client: PhotoshopClient,
  tokenCache: TokenCache,
  clientId: string,
): void {
  registerSmartObjectReplace(server, client);
  registerDocumentManifest(server, client);
  registerApplyActions(server, client);
  registerEditText(server, client);
  registerApplyEdits(server, client);
  // remove_background uses the V2 REST endpoint directly (SDK only has the
  // EOL'd V1), so it needs the token + client_id rather than the SDK client.
  registerRemoveBackground(server, tokenCache, clientId);
}
