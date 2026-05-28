/**
 * firefly_generate_video — kick off async video generation (Firefly Video v3).
 *
 * Wraps FireflyClient.generateVideoV3(). This is an asynchronous endpoint —
 * it does NOT return the generated video. It returns { jobId, statusUrl,
 * cancelUrl } that the caller can poll to retrieve the final video. We
 * deliberately do not poll inside the tool; the LLM decides when (or whether)
 * to follow up.
 *
 * Optional first/last keyframe images are accepted; they are uploaded if a
 * local path is given, and passed to the SDK as PublicBinaryInputV3.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CameraMotion,
  ShotAngle,
  ShotSize,
  VideoPromptStyle,
  type FireflyClient,
} from "@adobe/firefly-apis";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { imageRefSchema } from "../../schemas/image-ref.js";
import { resolveImageRef } from "../../util/storage-refs.js";
import { mapSdkError, toolError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";

// Supported aspect ratios for Firefly Video v3, per developer docs.
const VIDEO_SIZE_PRESETS = [
  "landscape_1920x1080",
  "portrait_1080x1920",
  "square_960x960",
  "landscape_1280x720",
  "portrait_720x1280",
] as const;

const VIDEO_SIZE_BY_PRESET: Record<
  (typeof VIDEO_SIZE_PRESETS)[number],
  { width: number; height: number }
> = {
  landscape_1920x1080: { width: 1920, height: 1080 },
  portrait_1080x1920: { width: 1080, height: 1920 },
  square_960x960: { width: 960, height: 960 },
  landscape_1280x720: { width: 1280, height: 720 },
  portrait_720x1280: { width: 720, height: 1280 },
};

const CAMERA_MOTION_VALUES = [
  "camera pan left",
  "camera pan right",
  "camera zoom in",
  "camera zoom out",
  "camera tilt up",
  "camera tilt down",
  "camera locked down",
  "camera handheld",
] as const;

const SHOT_ANGLE_VALUES = [
  "aerial shot",
  "eye_level shot",
  "high angle shot",
  "low angle shot",
  "top-down shot",
] as const;

const SHOT_SIZE_VALUES = [
  "close-up shot",
  "extreme close-up",
  "medium shot",
  "long shot",
  "extreme long shot",
] as const;

const PROMPT_STYLE_VALUES = [
  "anime",
  "3d",
  "fantasy",
  "cinematic",
  "claymation",
  "line art",
  "stop motion",
  "2d",
  "vector art",
  "black and white",
] as const;

function toCameraMotion(v: (typeof CAMERA_MOTION_VALUES)[number] | undefined): CameraMotion | undefined {
  if (!v) return undefined;
  return v as CameraMotion;
}
function toShotAngle(v: (typeof SHOT_ANGLE_VALUES)[number] | undefined): ShotAngle | undefined {
  if (!v) return undefined;
  return v as ShotAngle;
}
function toShotSize(v: (typeof SHOT_SIZE_VALUES)[number] | undefined): ShotSize | undefined {
  if (!v) return undefined;
  return v as ShotSize;
}
function toPromptStyle(
  v: (typeof PROMPT_STYLE_VALUES)[number] | undefined,
): VideoPromptStyle | undefined {
  if (!v) return undefined;
  return v as VideoPromptStyle;
}

const inputSchema = {
  prompt: z
    .string()
    .min(1)
    .max(1024)
    .describe(
      "Text prompt describing the video to generate. Required. Longer, more specific prompts produce better results.",
    ),
  negative_prompt: z
    .string()
    .optional()
    .describe("Text describing things to avoid in the generated video."),
  size: z
    .enum(VIDEO_SIZE_PRESETS)
    .optional()
    .default("landscape_1920x1080")
    .describe(
      "Output video size preset. Defaults to landscape_1920x1080 (1920x1080).",
    ),
  seed: z
    .number()
    .int()
    .optional()
    .describe(
      "Seed for deterministic generation. Currently only 1 seed is supported per request.",
    ),
  bit_rate_factor: z
    .number()
    .int()
    .min(0)
    .max(63)
    .optional()
    .describe(
      "Constant rate factor for encoding. 0 = lossless/largest file, 63 = worst quality/smallest file. Suggested range: 17-23.",
    ),
  first_frame_image: imageRefSchema
    .optional()
    .describe(
      "Optional keyframe image used as the FIRST frame of the generated video. Provide exactly one of uploadId, url, or path.",
    ),
  last_frame_image: imageRefSchema
    .optional()
    .describe(
      "Optional keyframe image used as the LAST frame of the generated video. Provide exactly one of uploadId, url, or path.",
    ),
  camera_motion: z
    .enum(CAMERA_MOTION_VALUES)
    .optional()
    .describe("Optional camera motion control."),
  shot_angle: z
    .enum(SHOT_ANGLE_VALUES)
    .optional()
    .describe("Optional shot angle control."),
  shot_size: z
    .enum(SHOT_SIZE_VALUES)
    .optional()
    .describe("Optional shot size control."),
  prompt_style: z
    .enum(PROMPT_STYLE_VALUES)
    .optional()
    .describe("Optional style of the generated video."),
};

export function registerGenerateVideo(server: McpServer, client: FireflyClient): void {
  server.registerTool(
    "firefly_generate_video",
    {
      title: "Generate a video from a text prompt (async)",
      description:
        "Kick off asynchronous video generation using Adobe Firefly Video v3. Accepts a text prompt and optional first/last keyframe images, camera motion, shot angle, shot size, and prompt style. This tool does NOT wait for the video — it returns a jobId plus statusUrl and cancelUrl. Use the statusUrl (or a separate polling tool) to retrieve the finished video. Generation typically takes 1-3 minutes.",
      inputSchema,
    },
    async (args): Promise<CallToolResult> => {
      try {
        const size = VIDEO_SIZE_BY_PRESET[args.size];

        // Resolve optional keyframe images and build the conditions array.
        const conditions: Array<{ placement: { position: number }; source: { uploadId?: string; url?: string } }> = [];
        if (args.first_frame_image) {
          const first = await resolveImageRef(args.first_frame_image, client);
          conditions.push({ placement: { position: 0 }, source: first });
        }
        if (args.last_frame_image) {
          const last = await resolveImageRef(args.last_frame_image, client);
          conditions.push({ placement: { position: 1 }, source: last });
        }

        const hasVideoSettings =
          args.camera_motion !== undefined ||
          args.shot_angle !== undefined ||
          args.shot_size !== undefined ||
          args.prompt_style !== undefined;

        const requestBody = {
          prompt: args.prompt,
          sizes: [size],
          ...(args.negative_prompt ? { negativePrompt: args.negative_prompt } : {}),
          ...(args.seed !== undefined ? { seeds: [args.seed] } : {}),
          ...(args.bit_rate_factor !== undefined ? { bitRateFactor: args.bit_rate_factor } : {}),
          ...(conditions.length > 0 ? { image: { conditions } } : {}),
          ...(hasVideoSettings
            ? {
                videoSettings: {
                  ...(args.camera_motion
                    ? { cameraMotion: toCameraMotion(args.camera_motion) }
                    : {}),
                  ...(args.shot_angle ? { shotAngle: toShotAngle(args.shot_angle) } : {}),
                  ...(args.shot_size ? { shotSize: toShotSize(args.shot_size) } : {}),
                  ...(args.prompt_style
                    ? { promptStyle: toPromptStyle(args.prompt_style) }
                    : {}),
                },
              }
            : {}),
        };

        logger.debug(
          { promptLen: args.prompt.length, size, keyframes: conditions.length },
          "calling Firefly generateVideoV3",
        );
        const res = await client.generateVideoV3(requestBody, { xModelVersion: "video1_standard" });
        const result = res.result;

        // Fail closed if the Firefly response is missing the fields the LLM
        // needs to follow up on the async job. Returning ok: true with
        // statusUrl: undefined would mislead the caller into a polling loop
        // they can never satisfy.
        if (!result.jobId || !result.statusUrl) {
          return toolError({
            code: "INCOMPLETE_RESPONSE",
            message:
              "Firefly accepted the video generation request but did not return a jobId or statusUrl. Cannot track the async job.",
            details: {
              hasJobId: Boolean(result.jobId),
              hasStatusUrl: Boolean(result.statusUrl),
              hasCancelUrl: Boolean(result.cancelUrl),
            },
          });
        }

        const summary = {
          ok: true,
          async: true,
          jobId: result.jobId,
          statusUrl: result.statusUrl,
          cancelUrl: result.cancelUrl,
          message:
            "Video generation job started. Poll statusUrl until the job completes (typically 1-3 minutes); cancel via cancelUrl if needed.",
        };

        return {
          content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
        };
      } catch (err) {
        return toolError(mapSdkError(err));
      }
    },
  );
}
