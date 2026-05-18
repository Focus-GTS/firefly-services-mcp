/**
 * firefly_generate_object_composite — composite an object image into a generated scene.
 *
 * Wraps FireflyClient.generateObjectComposite(). Takes an object image (e.g.
 * a packshot of a product), an optional mask, and a text prompt describing
 * the desired scene; Firefly synthesizes a new background that integrates the
 * object naturally. Supports style references, content class, and placement.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AlignmentHorizontal,
  AlignmentVertical,
  ContentClass,
  type FireflyClient,
} from "@adobe/firefly-apis";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { imageRefSchema } from "../../schemas/image-ref.js";
import { resolveImageRef } from "../../util/storage-refs.js";
import { mapSdkError, toolError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";

function toContentClass(s: "photo" | "art" | undefined): ContentClass | undefined {
  if (s === "photo") return ContentClass.PHOTO;
  if (s === "art") return ContentClass.ART;
  return undefined;
}

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

const SIZE_PRESETS = [
  "square_1024",
  "square_2048",
  "landscape_2304x1792",
  "portrait_1792x2304",
  "widescreen_2688x1536",
  "landscape_1344x768",
  "landscape_1152x896",
  "portrait_896x1152",
] as const;

const SIZE_BY_PRESET: Record<(typeof SIZE_PRESETS)[number], { width: number; height: number }> = {
  square_1024: { width: 1024, height: 1024 },
  square_2048: { width: 2048, height: 2048 },
  landscape_2304x1792: { width: 2304, height: 1792 },
  portrait_1792x2304: { width: 1792, height: 2304 },
  widescreen_2688x1536: { width: 2688, height: 1536 },
  landscape_1344x768: { width: 1344, height: 768 },
  landscape_1152x896: { width: 1152, height: 896 },
  portrait_896x1152: { width: 896, height: 1152 },
};

const inputSchema = {
  image: imageRefSchema.describe(
    "The object image to composite into a scene (e.g. a packshot). Provide exactly one of uploadId, url, or path.",
  ),
  prompt: z
    .string()
    .min(1)
    .max(1024)
    .describe(
      "Text prompt describing the scene to generate around the object. Required. Longer, more specific prompts produce better results.",
    ),
  mask: imageRefSchema
    .optional()
    .describe(
      "Optional mask image that hides part of the object image (e.g. its existing background) so it is not composited into the result.",
    ),
  num_variations: z
    .number()
    .int()
    .min(1)
    .max(4)
    .optional()
    .default(1)
    .describe("Number of variations to generate. 1-4. Defaults to 1."),
  size: z
    .enum(SIZE_PRESETS)
    .optional()
    .default("square_1024")
    .describe("Output image size preset. Defaults to square_1024 (1024x1024)."),
  seeds: z
    .array(z.number().int())
    .optional()
    .describe(
      "Seeds for deterministic generation. If provided, length must equal num_variations.",
    ),
  content_class: z
    .enum(["photo", "art"])
    .optional()
    .describe(
      "Bias the output toward photographic realism (photo) or stylized art (art). Omit to let Firefly decide.",
    ),
  style_image: imageRefSchema
    .optional()
    .describe(
      "Optional style reference image. The generated scene will inherit the visual style of this reference.",
    ),
  style_preset_id: z
    .string()
    .optional()
    .describe("Optional Firefly style preset ID."),
  style_strength: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe("How strongly to apply the style reference. 0-100. Higher = stronger."),
  placement_horizontal: z
    .enum(["center", "left", "right"])
    .optional()
    .describe("Horizontal anchoring of the object within the generated scene."),
  placement_vertical: z
    .enum(["center", "top", "bottom"])
    .optional()
    .describe("Vertical anchoring of the object within the generated scene."),
  inset_left: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Pixels of margin on the left side of the object."),
  inset_top: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Pixels of margin on the top side of the object."),
  inset_right: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Pixels of margin on the right side of the object."),
  inset_bottom: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe("Pixels of margin on the bottom side of the object."),
  return_inline_image: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "If true (default), the generated image bytes are fetched and returned inline so Claude can see the result directly. If false, only the URL is returned.",
    ),
};

export function registerGenerateObjectComposite(
  server: McpServer,
  client: FireflyClient,
): void {
  server.registerTool(
    "firefly_generate_object_composite",
    {
      title: "Composite an object into a generated scene",
      description:
        "Take an object image (e.g. a product packshot) and synthesize a new scene around it according to a text prompt. Optionally provide a mask to remove the object's existing background, a style reference image or preset, content class, and placement controls. Returns the generated image URL(s) and (by default) the inline image bytes so Claude can see the result directly.",
      inputSchema,
    },
    async (args): Promise<CallToolResult> => {
      try {
        const size = SIZE_BY_PRESET[args.size];
        const imageSource = await resolveImageRef(args.image, client);
        const maskSource = args.mask ? await resolveImageRef(args.mask, client) : undefined;
        const styleSource = args.style_image
          ? await resolveImageRef(args.style_image, client)
          : undefined;

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

        const requestBody = {
          numVariations: args.num_variations,
          size,
          prompt: args.prompt,
          image: {
            source: imageSource,
            ...(maskSource ? { mask: maskSource } : {}),
          },
          ...(args.seeds ? { seeds: args.seeds } : {}),
          ...(args.content_class ? { contentClass: toContentClass(args.content_class) } : {}),
          ...(placement ? { placement } : {}),
          ...(args.style_image || args.style_preset_id || args.style_strength !== undefined
            ? {
                style: {
                  ...(args.style_preset_id ? { presets: [args.style_preset_id] } : {}),
                  ...(styleSource ? { imageReference: { source: styleSource } } : {}),
                  ...(args.style_strength !== undefined ? { strength: args.style_strength } : {}),
                },
              }
            : {}),
        };

        logger.debug(
          { promptLen: args.prompt.length, numVariations: args.num_variations },
          "calling Firefly generateObjectComposite",
        );
        const res = await client.generateObjectComposite(requestBody);
        const result = res.result;
        const outputs = result.outputs ?? [];

        const summary = {
          ok: true,
          variations: outputs.length,
          size: result.size,
          contentClass: result.contentClass,
          outputs: outputs.map((o) => ({ seed: o.seed, url: o.image?.url })),
        };

        const content: CallToolResult["content"] = [
          { type: "text", text: JSON.stringify(summary, null, 2) },
        ];

        if (args.return_inline_image) {
          for (const output of outputs) {
            const url = output.image?.url;
            if (!url) continue;
            try {
              const imgRes = await fetch(url);
              if (!imgRes.ok) {
                logger.warn({ url, status: imgRes.status }, "failed to inline generated image");
                continue;
              }
              const buf = Buffer.from(await imgRes.arrayBuffer());
              const mime = imgRes.headers.get("content-type") ?? "image/png";
              content.push({
                type: "image",
                data: buf.toString("base64"),
                mimeType: mime,
              });
            } catch (fetchErr) {
              logger.warn({ url, err: (fetchErr as Error).message }, "error fetching generated image");
            }
          }
        }

        return { content };
      } catch (err) {
        return toolError(mapSdkError(err));
      }
    },
  );
}
