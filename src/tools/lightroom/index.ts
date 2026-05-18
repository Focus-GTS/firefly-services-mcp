/**
 * Lightroom tool sub-registry. Imported by src/tools/index.ts.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LightroomClient } from "@adobe/lightroom-apis";
import { registerApplyPreset } from "./apply-preset.js";
import { registerAutoTone } from "./auto-tone.js";
import { registerAutoStraighten } from "./auto-straighten.js";
import { registerApplyEdits } from "./apply-edits.js";

export function registerLightroomTools(server: McpServer, client: LightroomClient): void {
  registerApplyPreset(server, client);
  registerAutoTone(server, client);
  registerAutoStraighten(server, client);
  registerApplyEdits(server, client);
}
