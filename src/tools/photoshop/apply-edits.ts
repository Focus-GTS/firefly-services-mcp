/**
 * photoshop_apply_edits — apply layer-level edits to a PSD.
 *
 * Wraps PhotoshopClient.modifyDocument(). Generic "apply edits" entry-point
 * for changing layer state — visibility, lock, name — without the heavier
 * specialized tools (smart-object replace, text edit, action playback). The
 * caller passes a list of edits; this v0.1 implementation supports the
 * common case of toggling visibility / locked / name. Richer edits (adding
 * adjustment layers, pixel layers, shapes) can be expressed via raw_layers.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PhotoshopClient } from "@adobe/photoshop-apis";
import { mapSdkError, toolError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import {
  PHOTOSHOP_OUTPUT_FORMATS,
  PHOTOSHOP_STORAGE_VALUES,
  toImageFormat,
  toStorageType,
} from "../../util/photoshop-enums.js";

const STORAGE_VALUES = PHOTOSHOP_STORAGE_VALUES;
const OUTPUT_FORMATS = PHOTOSHOP_OUTPUT_FORMATS;

const layerEditSchema = z
  .object({
    layer_name: z
      .string()
      .optional()
      .describe("Name of the target layer. Provide either layer_name or layer_id."),
    layer_id: z
      .number()
      .int()
      .optional()
      .describe("Numeric id of the target layer. Provide either layer_name or layer_id."),
    visible: z
      .boolean()
      .optional()
      .describe("If set, toggle the layer's visibility."),
    locked: z
      .boolean()
      .optional()
      .describe("If set, toggle whether the layer is locked."),
    rename_to: z
      .string()
      .optional()
      .describe("If set, rename the layer to this string."),
  })
  .describe("A single layer-level edit operation.");

const inputSchema = {
  input_url: z
    .string()
    .url()
    .describe("Pre-signed GET URL to the source PSD to apply edits to."),
  input_storage: z
    .enum(STORAGE_VALUES)
    .optional()
    .default("external")
    .describe("Storage backend that hosts the input PSD. Defaults to 'external'."),
  edits: z
    .array(layerEditSchema)
    .optional()
    .describe(
      "Convenience list of high-level layer edits (visibility, lock, rename). Each entry must reference a layer by name OR id.",
    ),
  raw_layers: z
    .array(z.record(z.string(), z.unknown()))
    .optional()
    .describe(
      "Escape hatch — raw DocumentOperationLayer[] objects passed through verbatim to the Photoshop API. Use only when 'edits' cannot express what you need (e.g. add adjustment layers, pixel layers, shapes). See @adobe/photoshop-apis DocumentOperationLayer type.",
    ),
  output_url: z
    .string()
    .url()
    .describe("Pre-signed PUT URL where the rendered output should be written."),
  output_storage: z
    .enum(STORAGE_VALUES)
    .optional()
    .default("external")
    .describe("Storage backend that will receive the output. Defaults to 'external'."),
  output_format: z
    .enum(OUTPUT_FORMATS)
    .optional()
    .default("image/jpeg")
    .describe("MIME type of the rendered output. Defaults to image/jpeg."),
};

export function registerApplyEdits(
  server: McpServer,
  client: PhotoshopClient,
): void {
  server.registerTool(
    "photoshop_apply_edits",
    {
      title: "Apply layer edits to a PSD",
      description:
        "Apply layer-level edits to a PSD and render the result. The 'edits' array handles the common cases of toggling visibility, locking, and renaming layers — each edit references a layer by name or id. For richer operations (adding adjustment layers, pixel layers, shapes), use 'raw_layers' to pass DocumentOperationLayer objects verbatim. Provide pre-signed URLs for the input PSD and the output destination.",
      inputSchema,
    },
    async (args) => {
      try {
        if (!args.edits?.length && !args.raw_layers?.length) {
          return toolError({
            code: "NO_EDITS",
            message: "Either 'edits' or 'raw_layers' must contain at least one entry.",
          });
        }

        const simpleLayers = (args.edits ?? []).map((e, idx) => {
          if (!e.layer_name && e.layer_id === undefined) {
            throw new Error(
              `edits[${idx}]: must provide either layer_name or layer_id`,
            );
          }
          return {
            edit: {},
            ...(e.layer_name ? { name: e.layer_name } : {}),
            ...(e.layer_id !== undefined ? { id: e.layer_id } : {}),
            ...(e.visible !== undefined ? { visible: e.visible } : {}),
            ...(e.locked !== undefined ? { locked: e.locked } : {}),
            ...(e.rename_to ? { name: e.rename_to } : {}),
          };
        });

        const allLayers = [...simpleLayers, ...(args.raw_layers ?? [])];

        const requestBody = {
          inputs: [
            {
              href: args.input_url,
              storage: toStorageType(args.input_storage),
            },
          ],
          outputs: [
            {
              href: args.output_url,
              storage: toStorageType(args.output_storage),
              type: toImageFormat(args.output_format),
            },
          ],
          // The SDK expects DocumentOperationOptions; we cast the heterogeneous
          // mix of simple + raw layers since raw_layers is an escape hatch.
          options: { layers: allLayers as unknown as never },
        };

        logger.debug(
          { editCount: allLayers.length, output: args.output_format },
          "calling Photoshop modifyDocument",
        );
        const res = await client.modifyDocument(requestBody);
        const result = res.result as {
          jobId?: string;
          outputs?: unknown[];
          _links?: { self?: { href?: string } };
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: true,
                  jobId: result.jobId,
                  statusUrl: result._links?.self?.href,
                  outputs: result.outputs ?? [],
                  outputUrl: args.output_url,
                  editsApplied: allLayers.length,
                  message:
                    "Document edits submitted. If outputs are empty here, the job is still running; poll statusUrl and fetch the result from output_url when complete.",
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
