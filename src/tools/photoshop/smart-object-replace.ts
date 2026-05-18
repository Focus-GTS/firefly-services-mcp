/**
 * photoshop_smart_object_replace — replace a Smart Object's contents in a PSD.
 *
 * Wraps PhotoshopClient.replaceSmartObject(). Useful for "place this new
 * product shot into a branded PSD template" scenarios. The Photoshop API is
 * async at the protocol level; the SDK auto-polls and returns the final
 * job result (outputs + jobId) on success. The status URL is also surfaced.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type PhotoshopClient,
  StorageType,
  ImageFormatType,
} from "@adobe/photoshop-apis";
import { mapSdkError, toolError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";

const STORAGE_VALUES = ["external", "azure", "dropbox"] as const;
const OUTPUT_FORMATS = [
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/vnd.adobe.photoshop",
] as const;

function toStorageType(s: (typeof STORAGE_VALUES)[number]): StorageType {
  switch (s) {
    case "external":
      return StorageType.EXTERNAL;
    case "azure":
      return StorageType.AZURE;
    case "dropbox":
      return StorageType.DROPBOX;
  }
}

function toImageFormat(s: (typeof OUTPUT_FORMATS)[number]): ImageFormatType {
  switch (s) {
    case "image/jpeg":
      return ImageFormatType.IMAGE_JPEG;
    case "image/png":
      return ImageFormatType.IMAGE_PNG;
    case "image/tiff":
      return ImageFormatType.IMAGE_TIFF;
    case "image/vnd.adobe.photoshop":
      return ImageFormatType.IMAGE_VND_ADOBE_PHOTOSHOP;
  }
}

const inputSchema = {
  input_url: z
    .string()
    .url()
    .describe(
      "Pre-signed GET URL to the source PSD on caller-controlled storage (external, Azure, or Dropbox).",
    ),
  input_storage: z
    .enum(STORAGE_VALUES)
    .optional()
    .default("external")
    .describe("Storage backend that hosts the input PSD. Defaults to 'external'."),
  replacement_url: z
    .string()
    .url()
    .describe(
      "Pre-signed GET URL to the new image that will replace the smart object's contents.",
    ),
  replacement_storage: z
    .enum(STORAGE_VALUES)
    .optional()
    .default("external")
    .describe("Storage backend that hosts the replacement image. Defaults to 'external'."),
  layer_name: z
    .string()
    .optional()
    .describe(
      "Name of the smart object layer to replace. Provide either layer_name or layer_id.",
    ),
  layer_id: z
    .number()
    .int()
    .optional()
    .describe(
      "Numeric id of the smart object layer to replace. Provide either layer_name or layer_id.",
    ),
  output_url: z
    .string()
    .url()
    .describe(
      "Pre-signed PUT URL where the rendered output should be written by the Photoshop service.",
    ),
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

export function registerSmartObjectReplace(
  server: McpServer,
  client: PhotoshopClient,
): void {
  server.registerTool(
    "photoshop_smart_object_replace",
    {
      title: "Replace a Smart Object in a PSD",
      description:
        "Replace the contents of an embedded Smart Object layer inside a PSD and render the result. Provide pre-signed URLs for the source PSD (input_url), the new content (replacement_url), and the destination (output_url). Identify the target layer by layer_name OR layer_id. Useful for templating workflows where the same PSD is re-rendered with different product shots, headshots, or logo variants.",
      inputSchema,
    },
    async (args) => {
      try {
        if (!args.layer_name && args.layer_id === undefined) {
          return toolError({
            code: "MISSING_LAYER_REF",
            message: "Either layer_name or layer_id must be provided to identify the smart object.",
          });
        }

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
          options: {
            layers: [
              {
                ...(args.layer_name ? { name: args.layer_name } : {}),
                ...(args.layer_id !== undefined ? { id: args.layer_id } : {}),
                input: {
                  href: args.replacement_url,
                  storage: toStorageType(args.replacement_storage),
                },
              },
            ],
          },
        };

        logger.debug(
          { layer: args.layer_name ?? args.layer_id, output: args.output_format },
          "calling Photoshop replaceSmartObject",
        );
        const res = await client.replaceSmartObject(requestBody);
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
                  message:
                    "Smart object replacement submitted. The Photoshop API is asynchronous; if outputs are empty here, poll statusUrl to track progress and then fetch the result from output_url.",
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
