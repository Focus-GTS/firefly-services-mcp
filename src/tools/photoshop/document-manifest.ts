/**
 * photoshop_document_manifest — extract layer + document metadata from a PSD.
 *
 * Wraps PhotoshopClient.getDocumentManifest(). Returns the full manifest tree:
 * document properties (size, color profile, etc) plus the layer hierarchy with
 * layer ids, names, types, bounds, and (optionally) thumbnails. This is the
 * primary discovery tool — call it first to find the layer ids/names needed
 * by photoshop_smart_object_replace, photoshop_edit_text, etc.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ThumbnailType,
  type PhotoshopClient,
} from "@adobe/photoshop-apis";
import { mapSdkError, toolError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import {
  PHOTOSHOP_STORAGE_VALUES,
  toStorageType,
} from "../../util/photoshop-enums.js";

const STORAGE_VALUES = PHOTOSHOP_STORAGE_VALUES;

const inputSchema = {
  input_url: z
    .string()
    .url()
    .describe(
      "Pre-signed GET URL to the source PSD whose manifest should be extracted.",
    ),
  input_storage: z
    .enum(STORAGE_VALUES)
    .optional()
    .default("external")
    .describe("Storage backend that hosts the input PSD. Defaults to 'external'."),
  include_thumbnails: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "If true, request per-layer thumbnails in the manifest. Increases response size and processing time.",
    ),
};

export function registerDocumentManifest(
  server: McpServer,
  client: PhotoshopClient,
): void {
  server.registerTool(
    "photoshop_document_manifest",
    {
      title: "Extract a PSD's document manifest",
      description:
        "Extract the structured manifest of a PSD file: document metadata (size, color profile, version) plus the full layer hierarchy with layer ids, names, types, visibility, and bounds. Optionally include per-layer thumbnails. Call this first to discover the layer ids/names you need to pass to photoshop_smart_object_replace, photoshop_edit_text, or photoshop_apply_edits.",
      inputSchema,
    },
    async (args) => {
      try {
        const requestBody = {
          inputs: [
            {
              href: args.input_url,
              storage: toStorageType(args.input_storage),
            },
          ],
          ...(args.include_thumbnails
            ? { options: { thumbnails: { type: ThumbnailType.IMAGE_PNG } } }
            : {}),
        };

        logger.debug(
          { withThumbs: args.include_thumbnails },
          "calling Photoshop getDocumentManifest",
        );
        const res = await client.getDocumentManifest(requestBody);
        const result = res.result as {
          jobId?: string;
          outputs?: Array<{
            input?: string;
            status?: string;
            document?: unknown;
            layers?: unknown[];
          }>;
          _links?: { self?: { href?: string } };
        };

        const firstOutput = result.outputs?.[0];

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: true,
                  jobId: result.jobId,
                  statusUrl: result._links?.self?.href,
                  status: firstOutput?.status,
                  document: firstOutput?.document,
                  layers: firstOutput?.layers,
                  message:
                    "Manifest extracted. If document and layers are null here, the job is still running; poll statusUrl for completion.",
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return toolError(mapSdkError(err));
      }
    },
  );
}
