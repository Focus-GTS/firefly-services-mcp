/**
 * lightroom_auto_straighten — auto-straighten an image (apply Auto Upright).
 *
 * Wraps LightroomClient.autoStraightenImage(). Caller supplies pre-signed URLs
 * for the source and output. Returns the Lightroom job id and status URL; the
 * SDK does not auto-poll.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ImageFormatType,
  type AutoStraightenImageRequest,
  type LightroomClient,
} from "@adobe/lightroom-apis";
import { StorageType } from "@adobe/lightroom-apis/dist/src/models/StorageType.js";
import { UprightMode } from "@adobe/lightroom-apis/dist/src/models/UprightMode.js";
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

const UPRIGHT_MODES = ["auto", "full", "level", "vertical"] as const;

const UPRIGHT_MODE_MAP: Record<(typeof UPRIGHT_MODES)[number], UprightMode> = {
  auto: UprightMode.AUTO,
  full: UprightMode.FULL,
  level: UprightMode.LEVEL,
  vertical: UprightMode.VERTICAL,
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
      "Pre-signed PUT URL where Lightroom will upload the straightened image.",
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
  upright_mode: z
    .enum(UPRIGHT_MODES)
    .optional()
    .describe(
      "Upright transformation mode. 'auto' picks the best mode automatically; 'level' fixes horizontal tilt only; 'vertical' fixes vertical perspective only; 'full' applies the full perspective correction. If omitted, no options block is sent and Lightroom selects automatically.",
    ),
  constrain_crop: z
    .boolean()
    .optional()
    .describe(
      "If true, the straightened image is constrain-cropped to remove the blank edges introduced by the perspective fix. Only honored when upright_mode is also provided.",
    ),
};

export function registerAutoStraighten(server: McpServer, client: LightroomClient): void {
  server.registerTool(
    "lightroom_auto_straighten",
    {
      title: "Auto-straighten an image with Lightroom",
      description:
        "Apply the Auto Upright transformation to straighten an image using Adobe Lightroom API. Caller supplies pre-signed URLs for the source and output. Optionally choose an upright mode (auto/full/level/vertical) and whether to constrain-crop the result. Returns the Lightroom job id and a status URL the caller can poll.",
      inputSchema,
    },
    async (args) => {
      try {
        const requestBody: AutoStraightenImageRequest = {
          inputs: { href: args.input_url, storage: StorageType.EXTERNAL },
          outputs: [
            {
              href: args.output_url,
              storage: StorageType.EXTERNAL,
              type: FORMAT_BY_MIME[args.output_format ?? "image/jpeg"],
              ...(args.output_quality !== undefined ? { quality: args.output_quality } : {}),
            },
          ],
          ...(args.upright_mode
            ? {
                options: {
                  uprightMode: UPRIGHT_MODE_MAP[args.upright_mode],
                  ...(args.constrain_crop !== undefined
                    ? { constrainCrop: args.constrain_crop }
                    : {}),
                },
              }
            : {}),
        };

        logger.debug(
          { uprightMode: args.upright_mode, outputFormat: args.output_format },
          "calling Lightroom autoStraightenImage",
        );

        const res = await client.autoStraightenImage(requestBody);
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
                    "Lightroom auto-straighten job submitted. Poll statusUrl until the job reports succeeded or failed.",
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
