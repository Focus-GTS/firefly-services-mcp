/**
 * photoshop_remove_background — isolate the subject and remove the background.
 *
 * Wraps PhotoshopClient.removeBackground(). Powered by Adobe Sensei; returns
 * a PNG with the background removed (transparent). Note this endpoint
 * returns a SenseiJobApiResponse, not the standard PsJobResponse — it has
 * `status` and `output` (singular) rather than `outputs`.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type PhotoshopClient,
  StorageType,
} from "@adobe/photoshop-apis";
import { mapSdkError, toolError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";

const STORAGE_VALUES = ["external", "azure", "dropbox"] as const;

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

const inputSchema = {
  input_url: z
    .string()
    .url()
    .describe(
      "Pre-signed GET URL to the source image whose background should be removed (JPEG, PNG, or PSD).",
    ),
  input_storage: z
    .enum(STORAGE_VALUES)
    .optional()
    .default("external")
    .describe("Storage backend that hosts the input image. Defaults to 'external'."),
  output_url: z
    .string()
    .url()
    .describe("Pre-signed PUT URL where the resulting PNG (transparent background) should be written."),
  output_storage: z
    .enum(STORAGE_VALUES)
    .optional()
    .default("external")
    .describe("Storage backend that will receive the output. Defaults to 'external'."),
  mask_format: z
    .enum(["soft", "binary"])
    .optional()
    .describe(
      "Optional mask format. 'soft' produces a feathered alpha mask (best for hair, fur). 'binary' produces a hard cutout. Omit to let Sensei decide.",
    ),
};

export function registerRemoveBackground(
  server: McpServer,
  client: PhotoshopClient,
): void {
  server.registerTool(
    "photoshop_remove_background",
    {
      title: "Remove the background from an image",
      description:
        "Isolate the subject of an image and remove the background, returning a transparent PNG. Powered by Adobe Sensei. Provide pre-signed URLs for the input image and the output PNG destination. Optionally request a 'soft' (feathered) or 'binary' (hard cutout) mask. Useful for product shots, headshots, and any compositing workflow.",
      inputSchema,
    },
    async (args) => {
      try {
        // MaskFormatType is an enum in the SDK ('soft' | 'binary'); we pass the
        // literal string and cast since the enum is not exposed at the package's
        // top-level export surface.
        const requestBody = {
          input: {
            href: args.input_url,
            storage: toStorageType(args.input_storage),
          },
          output: {
            href: args.output_url,
            storage: toStorageType(args.output_storage),
            ...(args.mask_format
              ? { mask: { format: args.mask_format as unknown as never } }
              : {}),
          },
        };

        logger.debug(
          { maskFormat: args.mask_format },
          "calling Photoshop removeBackground",
        );
        const res = await client.removeBackground(requestBody);
        const result = res.result as {
          jobId?: string;
          status?: string;
          output?: unknown;
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
                  status: result.status,
                  statusUrl: result._links?.self?.href,
                  output: result.output,
                  outputUrl: args.output_url,
                  message:
                    "Background-removal job submitted. If status is not 'succeeded' here, the job is still running; poll statusUrl and fetch the result from output_url when complete.",
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
