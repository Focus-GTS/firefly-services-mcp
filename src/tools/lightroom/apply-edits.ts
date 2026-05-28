/**
 * lightroom_apply_edits — apply manual Lightroom adjustments to an image.
 *
 * Wraps LightroomClient.applyEdits(). Exposes the EditOptions surface from the
 * SDK: exposure, contrast, highlights, shadows, whites, blacks, vibrance,
 * saturation, clarity, dehaze, texture, sharpness, noise reduction, and a
 * white-balance preset. Note: the Lightroom REST API does NOT expose direct
 * Temperature/Tint sliders — color temperature is controlled through the
 * WhiteBalance enum (As Shot, Auto, Cloudy, Custom, Daylight, etc.).
 *
 * Caller supplies pre-signed URLs for the source and output. Returns the
 * Lightroom job id and status URL; the SDK does not auto-poll.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ImageFormatType,
  StorageType,
  WhiteBalance,
  type ApplyEditsRequest,
  type EditOptions,
  type LightroomClient,
} from "@adobe/lightroom-apis";
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

const WHITE_BALANCE_VALUES = [
  "as_shot",
  "auto",
  "cloudy",
  "custom",
  "daylight",
  "flash",
  "fluorescent",
  "shade",
  "tungsten",
] as const;

const WHITE_BALANCE_MAP: Record<(typeof WHITE_BALANCE_VALUES)[number], WhiteBalance> = {
  as_shot: WhiteBalance.AS_SHOT,
  auto: WhiteBalance.AUTO,
  cloudy: WhiteBalance.CLOUDY,
  custom: WhiteBalance.CUSTOM,
  daylight: WhiteBalance.DAYLIGHT,
  flash: WhiteBalance.FLASH,
  fluorescent: WhiteBalance.FLUORESCENT,
  shade: WhiteBalance.SHADE,
  tungsten: WhiteBalance.TUNGSTEN,
};

// Lightroom adjustment sliders. Ranges mirror the standard Lightroom UI: most
// "basic panel" sliders are -100..+100. Exposure is -5..+5 stops.
const adjustmentField = (label: string, min: number, max: number) =>
  z
    .number()
    .min(min)
    .max(max)
    .optional()
    .describe(`${label}. Range ${min} to ${max}.`);

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
      "Pre-signed PUT URL where Lightroom will upload the edited image.",
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
  exposure: adjustmentField("Exposure adjustment in stops", -5, 5),
  contrast: adjustmentField("Contrast", -100, 100),
  highlights: adjustmentField("Highlights", -100, 100),
  shadows: adjustmentField("Shadows", -100, 100),
  whites: adjustmentField("Whites", -100, 100),
  blacks: adjustmentField("Blacks", -100, 100),
  vibrance: adjustmentField("Vibrance", -100, 100),
  saturation: adjustmentField("Saturation", -100, 100),
  clarity: adjustmentField("Clarity", -100, 100),
  dehaze: adjustmentField("Dehaze", -100, 100),
  texture: adjustmentField("Texture", -100, 100),
  sharpness: z
    .number()
    .min(0)
    .max(150)
    .optional()
    .describe("Sharpness amount. Range 0 to 150."),
  sharpen_radius: z
    .number()
    .min(0.5)
    .max(3)
    .optional()
    .describe("Sharpen radius in pixels. Range 0.5 to 3."),
  sharpen_detail: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe("Sharpen detail. Range 0 to 100."),
  sharpen_edge_masking: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe("Sharpen edge masking. Range 0 to 100."),
  noise_reduction: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe("Luminance noise reduction. Range 0 to 100."),
  color_noise_reduction: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe("Color noise reduction. Range 0 to 100."),
  vignette_amount: adjustmentField("Post-crop vignette amount", -100, 100),
  white_balance: z
    .enum(WHITE_BALANCE_VALUES)
    .optional()
    .describe(
      "White balance preset. The Lightroom REST API does not expose direct Temperature/Tint sliders; color temperature is controlled by selecting a named preset.",
    ),
};

export function registerApplyEdits(server: McpServer, client: LightroomClient): void {
  server.registerTool(
    "lightroom_apply_edits",
    {
      title: "Apply manual Lightroom edits to image",
      description:
        "Apply one or more manual Lightroom adjustments (exposure, contrast, highlights, shadows, whites, blacks, vibrance, saturation, clarity, dehaze, texture, sharpness, noise reduction, vignette, white balance) to an image using Adobe Lightroom API. Caller supplies pre-signed URLs for the source and output. Returns the Lightroom job id and a status URL the caller can poll until the job completes.",
      inputSchema,
    },
    async (args) => {
      try {
        const options: EditOptions = {
          ...(args.exposure !== undefined ? { Exposure: args.exposure } : {}),
          ...(args.contrast !== undefined ? { Contrast: args.contrast } : {}),
          ...(args.highlights !== undefined ? { Highlights: args.highlights } : {}),
          ...(args.shadows !== undefined ? { Shadows: args.shadows } : {}),
          ...(args.whites !== undefined ? { Whites: args.whites } : {}),
          ...(args.blacks !== undefined ? { Blacks: args.blacks } : {}),
          ...(args.vibrance !== undefined ? { Vibrance: args.vibrance } : {}),
          ...(args.saturation !== undefined ? { Saturation: args.saturation } : {}),
          ...(args.clarity !== undefined ? { Clarity: args.clarity } : {}),
          ...(args.dehaze !== undefined ? { Dehaze: args.dehaze } : {}),
          ...(args.texture !== undefined ? { Texture: args.texture } : {}),
          ...(args.sharpness !== undefined ? { Sharpness: args.sharpness } : {}),
          ...(args.sharpen_radius !== undefined ? { SharpenRadius: args.sharpen_radius } : {}),
          ...(args.sharpen_detail !== undefined ? { SharpenDetail: args.sharpen_detail } : {}),
          ...(args.sharpen_edge_masking !== undefined
            ? { SharpenEdgeMasking: args.sharpen_edge_masking }
            : {}),
          ...(args.noise_reduction !== undefined ? { NoiseReduction: args.noise_reduction } : {}),
          ...(args.color_noise_reduction !== undefined
            ? { ColorNoiseReduction: args.color_noise_reduction }
            : {}),
          ...(args.vignette_amount !== undefined ? { VignetteAmount: args.vignette_amount } : {}),
          ...(args.white_balance ? { WhiteBalance: WHITE_BALANCE_MAP[args.white_balance] } : {}),
        };

        if (Object.keys(options).length === 0) {
          return toolError({
            code: "NO_EDITS",
            message:
              "At least one adjustment field must be provided (e.g. exposure, contrast, white_balance).",
          });
        }

        const requestBody: ApplyEditsRequest = {
          inputs: {
            source: { href: args.input_url, storage: StorageType.EXTERNAL },
          },
          options,
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
          { adjustments: Object.keys(options), outputFormat: args.output_format },
          "calling Lightroom applyEdits",
        );

        const res = await client.applyEdits(requestBody);
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
                  appliedAdjustments: Object.keys(options),
                  outputs: result.outputs,
                  message:
                    "Lightroom apply-edits job submitted. Poll statusUrl until the job reports succeeded or failed.",
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
