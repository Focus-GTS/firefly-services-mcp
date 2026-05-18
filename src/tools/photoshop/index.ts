/**
 * Photoshop tool sub-registry. Imported by src/tools/index.ts.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PhotoshopClient } from "@adobe/photoshop-apis";
import { registerSmartObjectReplace } from "./smart-object-replace.js";
import { registerDocumentManifest } from "./document-manifest.js";
import { registerApplyActions } from "./apply-actions.js";
import { registerEditText } from "./edit-text.js";
import { registerApplyEdits } from "./apply-edits.js";
import { registerRemoveBackground } from "./remove-background.js";

export function registerPhotoshopTools(server: McpServer, client: PhotoshopClient): void {
  registerSmartObjectReplace(server, client);
  registerDocumentManifest(server, client);
  registerApplyActions(server, client);
  registerEditText(server, client);
  registerApplyEdits(server, client);
  registerRemoveBackground(server, client);
}
