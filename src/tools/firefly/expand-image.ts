/**
 * firefly_expand_image — expand the canvas of an image (generative outpainting).
 *
 * Wraps FireflyClient.expandImage(). Takes a source image and (optionally) a
 * mask defining the expansion region, plus a target output size, and grows the
 * image content outward to fill the new canvas. An optional text prompt
 * influences what fills the new pixels.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AlignmentHorizontal, AlignmentVertical, type FireflyClient } from "@adobe/firefly-apis";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { imageRefSchema } from "../../schemas/image-ref.js";
import { resolveImageRef } from "../../util/storage-refs.js";
import { mapSdkError, toolError } from "../../util/errors.js";
import { inlineImagesFromOutputs } from "../../util/inline-images.js";
import { logger } from "../../util/logger.js";

function toHorizontal(v: "center" | "left" | "right" | undefined): AlignmentHorizontal | undefined {
  if (v === "center") return AlignmentHorizontal.CENTER;
  if (v === "left") return AlignmentHorizontal.LEFT;
  if (v === "right") return AlignmentHorizontal.RIGHT;
  return undefined;
}

function toVertical(v: "center" | "top" | "bottom" | undefined): AlignmentVertical | undefined {
  if (v === "center") return AlignmentVertical.CENTER;
  if (v === "top") return AlignmentVertical.TOP;
  if (v === "bottom") return AlignmentVertical.BOTTOM;
  return undefined;
}

const inputSchema = {
  image: imageRefSchema.describe(
    "The source image to expand. Provide exactly one of upload_id, url, or path.",
  ),
  mask: imageRefSchema
    .optional()
    .describe(
      "Optional mask image. The mask must be larger than the source image and defines the expansion region. If a mask is provided, the source placement cannot be used.",
    ),
  prompt: z
    .string()
    .max(1024)
    .optional()
    .describe(
      "Optional text prompt to guide what should fill the expanded canvas. Longer, more specific prompts produce better results.",
    ),
  num_variations: z
    .number()
    .int()
    .min(1)
    .max(4)
    .optional()
    .default(1)
    .describe("Number of variations to generate. 1-4. Defaults to 1."),
  width: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Target output width in pixels. If omitted (and a mask is provided), it is inferred from the mask.",
    ),
  height: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Target output height in pixels. If omitted (and a mask is provided), it is inferred from the mask.",
    ),
  seeds: z
    .array(z.number().int())
    .optional()
    .describe(
      "Seeds for deterministic generation. If provided, length must equal num_variations.",
    ),
  placement_horizontal: z
    .enum(["center", "left", "right"])
    .optional()
    .describe(
      "Horizontal anchoring of the source image inside the expanded canvas. Cannot be combined with a mask.",
    ),
  placement_vertical: z
    .enum(["center", "top", "bottom"])
    .optional()
    .describe(
      "Vertical anchoring of the source image inside the expanded canvas. Cannot be combined with a mask.",
    ),
  inset_left: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Pixels of empty canvas to insert on the left side. Cannot be combined with a mask."),
  inset_top: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Pixels of empty canvas to insert on the top side. Cannot be combined with a mask."),
  inset_right: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Pixels of empty canvas to insert on the right side. Cannot be combined with a mask."),
  inset_bottom: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Pixels of empty canvas to insert on the bottom side. Cannot be combined with a mask.",
    ),
  return_inline_image: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "If true (default), the generated image bytes are fetched and returned inline so Claude can see the result directly. If false, only the URL is returned.",
    ),
};

export function registerExpandImage(server: McpServer, client: FireflyClient): void {
  server.registerTool(
    "firefly_expand_image",
    {
      title: "Expand the canvas of an image",
      description:
        "Generatively expand the canvas of an existing image (a.k.a. outpainting). You MUST provide either a target output size (width + height) OR a mask that defines the expansion region — a call with neither will fail. Use width/height with an optional placement/inset to anchor the source; use a mask for a custom expansion shape (placement/inset cannot be combined with a mask). An optional text prompt biases what fills the new pixels. Returns the generated image URL(s) and (by default) the inline image bytes so Claude can see the result directly.",
      inputSchema,
    },
    async (args): Promise<CallToolResult> => {
      try {
        const sourceInput = await resolveImageRef(args.image, client);
        const maskInput = args.mask ? await resolveImageRef(args.mask, client) : undefined;

        const hasInset =
          args.inset_left !== undefined ||
          args.inset_top !== undefined ||
          args.inset_right !== undefined ||
          args.inset_bottom !== undefined;
        const hasAlignment =
          args.placement_horizontal !== undefined || args.placement_vertical !== undefined;

        const placement =
          hasInset || hasAlignment
            ? {
                ...(hasInset
                  ? {
                      inset: {
                        ...(args.inset_left !== undefined ? { left: args.inset_left } : {}),
                        ...(args.inset_top !== undefined ? { top: args.inset_top } : {}),
                        ...(args.inset_right !== undefined ? { right: args.inset_right } : {}),
                        ...(args.inset_bottom !== undefined ? { bottom: args.inset_bottom } : {}),
                      },
                    }
                  : {}),
                ...(hasAlignment
                  ? {
                      alignment: {
                        ...(args.placement_horizontal
                          ? { horizontal: toHorizontal(args.placement_horizontal) }
                          : {}),
                        ...(args.placement_vertical
                          ? { vertical: toVertical(args.placement_vertical) }
                          : {}),
                      },
                    }
                  : {}),
              }
            : undefined;

        const hasSize = args.width !== undefined && args.height !== undefined;

        const requestBody = {
          numVariations: args.num_variations,
          image: {
            source: sourceInput,
            ...(maskInput ? { mask: maskInput } : {}),
          },
          ...(args.prompt ? { prompt: args.prompt } : {}),
          ...(hasSize ? { size: { width: args.width!, height: args.height! } } : {}),
          ...(args.seeds ? { seeds: args.seeds } : {}),
          ...(placement ? { placement } : {}),
        };

        logger.debug({ numVariations: args.num_variations }, "calling Firefly expandImage");
        const res = await client.expandImage(requestBody);
        const result = res.result;
        const outputs = result.outputs ?? [];
        const empty = outputs.length === 0;

        const summary: Record<string, unknown> = {
          ok: !empty,
          variations: outputs.length,
          size: result.size,
          outputs: outputs.map((o) => ({ seed: o.seed, url: o.image?.url })),
        };
        if (empty) {
          summary.reason = "empty_result";
          summary.message =
            "Firefly returned no expanded images. The API call succeeded but produced an empty outputs array (may be due to content-safety rejection or a transient backend issue).";
        }

        const content: CallToolResult["content"] = [
          { type: "text", text: JSON.stringify(summary, null, 2) },
        ];

        if (args.return_inline_image) {
          const imageBlocks = await inlineImagesFromOutputs(outputs);
          content.push(...imageBlocks);
        }

        return { content };
      } catch (err) {
        return toolError(mapSdkError(err));
      }
    },
  );
}
