/**
 * lightroom_auto_tone — auto-correct exposure, contrast, sharpness, and
 * saturation on an image.
 *
 * Wraps LightroomClient.applyAutoTone(). Caller supplies pre-signed URLs for
 * the source and output. Returns the Lightroom job id and status URL; the SDK
 * does not auto-poll, so the caller must poll until the job completes.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ImageFormatType,
  type ApplyAutoToneRequest,
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
      "Pre-signed GET URL to the source image on caller-controlled storage (S3, Azure Blob, Dropbox).",
    ),
  output_url: z
    .string()
    .url()
    .describe(
      "Pre-signed PUT URL where Lightroom will upload the auto-toned image.",
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

export function registerAutoTone(server: McpServer, client: LightroomClient): void {
  server.registerTool(
    "lightroom_auto_tone",
    {
      title: "Auto-tone an image with Lightroom",
      description:
        "Automatically correct exposure, contrast, sharpness, and saturation on an image using Adobe Lightroom's Auto Tone algorithm. Caller supplies pre-signed URLs for the source and output. Returns the Lightroom job id and a status URL the caller can poll until the job completes.",
      inputSchema,
    },
    async (args) => {
      try {
        const requestBody: ApplyAutoToneRequest = {
          inputs: { href: args.input_url, storage: StorageType.EXTERNAL },
          outputs: [
            {
              href: args.output_url,
              storage: StorageType.EXTERNAL,
              type: FORMAT_BY_MIME[args.output_format ?? "image/jpeg"],
              ...(args.output_quality !== undefined ? { quality: args.output_quality } : {}),
            },
          ],
        };

        logger.debug({ outputFormat: args.output_format }, "calling Lightroom applyAutoTone");

        const res = await client.applyAutoTone(requestBody);
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
                    "Lightroom auto-tone job submitted. Poll statusUrl until the job reports succeeded or failed.",
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
