/**
 * photoshop_edit_text — change the contents of one or more text layers in a PSD.
 *
 * Wraps PhotoshopClient.editTextLayer(). The flagship localization /
 * personalization tool: swap "Hello" for "Bonjour", insert a customer's name,
 * change a price tag, etc. Each edit identifies a layer by name or id and
 * provides the new content string.
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

const textEditSchema = z.object({
  layer_name: z
    .string()
    .optional()
    .describe("Name of the text layer to edit. Provide either layer_name or layer_id."),
  layer_id: z
    .number()
    .int()
    .optional()
    .describe("Numeric id of the text layer to edit. Provide either layer_name or layer_id."),
  content: z
    .string()
    .describe("The new text content for this layer."),
});

const inputSchema = {
  input_url: z
    .string()
    .url()
    .describe("Pre-signed GET URL to the source PSD containing the text layers to edit."),
  input_storage: z
    .enum(STORAGE_VALUES)
    .optional()
    .default("external")
    .describe("Storage backend that hosts the input PSD. Defaults to 'external'."),
  edits: z
    .array(textEditSchema)
    .min(1)
    .describe("One or more text-layer edits. Each entry must reference a layer by name OR id."),
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

export function registerEditText(
  server: McpServer,
  client: PhotoshopClient,
): void {
  server.registerTool(
    "photoshop_edit_text",
    {
      title: "Edit text layer(s) in a PSD",
      description:
        "Change the content of one or more text layers in a PSD and render the result. Each edit references a text layer by name or id and supplies a new content string. The flagship localization tool — swap headlines, insert personalization tokens, change price tags, etc. Provide pre-signed URLs for the input PSD and the output destination.",
      inputSchema,
    },
    async (args) => {
      try {
        for (const edit of args.edits) {
          if (!edit.layer_name && edit.layer_id === undefined) {
            return toolError({
              code: "MISSING_LAYER_REF",
              message: "Each edit must provide either layer_name or layer_id.",
              details: { edit: edit as unknown as Record<string, unknown> },
            });
          }
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
            layers: args.edits.map((e) => ({
              ...(e.layer_name ? { name: e.layer_name } : {}),
              ...(e.layer_id !== undefined ? { id: e.layer_id } : {}),
              text: { content: e.content },
            })),
          },
        };

        logger.debug(
          { editCount: args.edits.length, output: args.output_format },
          "calling Photoshop editTextLayer",
        );
        const res = await client.editTextLayer(requestBody);
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
                  editsApplied: args.edits.length,
                  message:
                    "Text edits submitted. If outputs are empty here, the job is still running; poll statusUrl and fetch the result from output_url when complete.",
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
