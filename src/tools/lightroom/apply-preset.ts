/**
 * lightroom_apply_preset — apply one or more XMP Lightroom presets to an image.
 *
 * Wraps LightroomClient.applyPreset(). Uses the canonical external-storage
 * pattern: caller provides a pre-signed GET URL for the source image, one or
 * more pre-signed GET URLs for .xmp preset files, and a pre-signed PUT URL
 * for the output. Returns the Lightroom job id + status URL so the caller can
 * poll for completion (the SDK does not auto-poll).
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ImageFormatType,
  type ApplyPresetRequest,
  type LightroomClient,
} from "@adobe/lightroom-apis";
import { StorageType } from "@adobe/lightroom-apis/dist/src/models/StorageType.js";
import { mapSdkError, toolError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";

const OUTPUT_FORMATS = [
  "image/jpeg",
  "image/png",
  "image/x-adobe-dng",
] as const;

const FORMAT_BY_MIME: Record<(typeof OUTPUT_FORMATS)[number], ImageFormatType> = {
  "image/jpeg": ImageFormatType.IMAGE_JPEG,
  "image/png": ImageFormatType.IMAGE_PNG,
  "image/x-adobe-dng": ImageFormatType.IMAGE_X_ADOBE_DNG,
};

const inputSchema = {
  input_url: z
    .string()
    .url()
    .describe(
      "Pre-signed GET URL to the source image on caller-controlled storage (S3, Azure Blob, Dropbox). Must be a publicly fetchable HTTPS URL.",
    ),
  preset_url: z
    .string()
    .url()
    .describe(
      "Pre-signed GET URL to a Lightroom .xmp preset file. Use lightroom_apply_preset with multiple preset URLs by calling this tool repeatedly or supplying preset_urls instead.",
    )
    .optional(),
  preset_urls: z
    .array(z.string().url())
    .min(1)
    .optional()
    .describe(
      "Array of pre-signed GET URLs to .xmp preset files. Use this when applying multiple presets in one call. Provide either preset_url (single) or preset_urls (multiple); not both.",
    ),
  output_url: z
    .string()
    .url()
    .describe(
      "Pre-signed PUT URL where Lightroom will upload the processed image.",
    ),
  output_format: z
    .enum(OUTPUT_FORMATS)
    .optional()
    .default("image/jpeg")
    .describe(
      "Output image MIME type. Lightroom supports image/jpeg, image/png, and image/x-adobe-dng. Defaults to image/jpeg.",
    ),
  output_quality: z
    .number()
    .int()
    .min(0)
    .max(12)
    .optional()
    .describe(
      "JPEG quality, 0-12 (12 = highest). Ignored for non-JPEG outputs.",
    ),
};

export function registerApplyPreset(server: McpServer, client: LightroomClient): void {
  server.registerTool(
    "lightroom_apply_preset",
    {
      title: "Apply Lightroom XMP preset to image",
      description:
        "Apply one or more Lightroom XMP presets to an image using Adobe Lightroom API. Caller supplies pre-signed URLs for the source image, the .xmp preset file(s), and the output destination. Returns the Lightroom job id and a status URL the caller can poll until the job completes.",
      inputSchema,
    },
    async (args) => {
      try {
        const presetList =
          args.preset_urls && args.preset_urls.length > 0
            ? args.preset_urls
            : args.preset_url
              ? [args.preset_url]
              : [];

        if (presetList.length === 0) {
          return toolError({
            code: "MISSING_PRESET",
            message: "Provide at least one preset via preset_url or preset_urls.",
          });
        }

        const requestBody: ApplyPresetRequest = {
          inputs: {
            source: { href: args.input_url, storage: StorageType.EXTERNAL },
            presets: presetList.map((href) => ({
              href,
              storage: StorageType.EXTERNAL,
            })),
          },
          outputs: [
            {
              href: args.output_url,
              storage: StorageType.EXTERNAL,
              type: FORMAT_BY_MIME[args.output_format ?? "image/jpeg"],
              ...(args.output_quality !== undefined ? { quality: args.output_quality } : {}),
            },
          ],
        };

        logger.debug(
          { presetCount: presetList.length, outputFormat: args.output_format },
          "calling Lightroom applyPreset",
        );

        const res = await client.applyPreset(requestBody);
        const result = res.result;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: true,
                  jobId: result.jobId,
                  created: result.created,
                  modified: result.modified,
                  statusUrl: result._links?.self?.href,
                  outputs: result.outputs,
                  message:
                    "Lightroom apply-preset job submitted. Poll statusUrl until the job reports succeeded or failed.",
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
