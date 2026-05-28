/**
 * photoshop_apply_actions — run a Photoshop .atn action file against an image.
 *
 * Wraps PhotoshopClient.playPhotoshopActions(). Accepts a pre-signed URL to a
 * .atn action set file and applies it to the input (PSD/JPEG/PNG/TIFF),
 * writing the result to output_url. Optionally restrict to a single named
 * action inside the set.
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

const inputSchema = {
  input_url: z
    .string()
    .url()
    .describe(
      "Pre-signed GET URL to the source image (PSD, JPEG, PNG, or TIFF) to which the action should be applied.",
    ),
  input_storage: z
    .enum(STORAGE_VALUES)
    .optional()
    .default("external")
    .describe("Storage backend that hosts the input image. Defaults to 'external'."),
  action_url: z
    .string()
    .url()
    .describe("Pre-signed GET URL to the .atn Photoshop action set file."),
  action_storage: z
    .enum(STORAGE_VALUES)
    .optional()
    .default("external")
    .describe("Storage backend that hosts the .atn file. Defaults to 'external'."),
  action_name: z
    .string()
    .optional()
    .describe(
      "Optional name of a specific action inside the .atn action set. If omitted, the entire set is played.",
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

export function registerApplyActions(
  server: McpServer,
  client: PhotoshopClient,
): void {
  server.registerTool(
    "photoshop_apply_actions",
    {
      title: "Apply a Photoshop .atn action file to an image",
      description:
        "Run a Photoshop Actions (.atn) file against an input image (PSD, JPEG, PNG, or TIFF) and write the result to output_url. Provide pre-signed URLs for the input, the .atn action set, and the output. Optionally restrict execution to a single named action inside the set via action_name. Useful for applying brand-consistent filter / treatment pipelines created by designers in Photoshop.",
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
          outputs: [
            {
              href: args.output_url,
              storage: toStorageType(args.output_storage),
              type: toImageFormat(args.output_format),
            },
          ],
          options: {
            actions: [
              {
                href: args.action_url,
                storage: toStorageType(args.action_storage),
                ...(args.action_name ? { actionName: args.action_name } : {}),
              },
            ],
          },
        };

        logger.debug(
          { actionName: args.action_name, output: args.output_format },
          "calling Photoshop playPhotoshopActions",
        );
        const res = await client.playPhotoshopActions(requestBody);
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
                    "Photoshop action playback submitted. If outputs are empty here, the job is still running; poll statusUrl and fetch the result from output_url when complete.",
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
