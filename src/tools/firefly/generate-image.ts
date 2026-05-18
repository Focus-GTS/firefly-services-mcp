/**
 * firefly_generate_image — generate one or more images from a text prompt.
 *
 * The flagship demo tool. Wraps FireflyClient.generateImages(). Supports
 * style references, structure references, content class, seeds, and the
 * dual-mode output contract from ADR-004 (URL only OR URL + inline bytes).
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ContentClass, type FireflyClient } from "@adobe/firefly-apis";
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

// Supported sizes per the SDK's GenerateImagesRequest documentation.
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
  prompt: z
    .string()
    .min(1)
    .max(1024)
    .describe(
      "Text prompt describing the image to generate. Longer, more specific prompts produce better results. Max 1024 characters.",
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
    .describe(
      "Output image size preset. Defaults to square_1024 (1024x1024).",
    ),
  content_class: z
    .enum(["photo", "art"])
    .optional()
    .describe(
      "Bias the output toward photographic realism (photo) or stylized art (art). Omit to let Firefly decide.",
    ),
  negative_prompt: z
    .string()
    .optional()
    .describe("Text describing things to avoid in the generated image."),
  seeds: z
    .array(z.number().int())
    .optional()
    .describe(
      "Seeds for deterministic generation. If provided, length must equal num_variations. Same seed + same prompt = reproducible output.",
    ),
  style_image: imageRefSchema
    .optional()
    .describe(
      "Optional style reference image. The generated image will inherit the visual style of this reference.",
    ),
  style_preset_id: z
    .string()
    .optional()
    .describe(
      "Optional Firefly style preset ID. See https://developer.adobe.com/firefly-services/docs/firefly-api/guides/concepts/style-presets/ for the catalog.",
    ),
  structure_image: imageRefSchema
    .optional()
    .describe(
      "Optional structure reference image. The generated image will match the composition / layout of this reference.",
    ),
  style_strength: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe("How strongly to apply the style reference. 0-100. Higher = stronger."),
  structure_strength: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe("How strongly to adhere to the structure reference. 0-100. Higher = stronger."),
  return_inline_image: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "If true (default), the generated image bytes are fetched and returned inline so Claude can see the image directly. If false, only the URL is returned (faster for batch workloads).",
    ),
};

export function registerGenerateImage(server: McpServer, client: FireflyClient): void {
  server.registerTool(
    "firefly_generate_image",
    {
      title: "Generate image from prompt",
      description:
        "Generate one or more images from a text prompt using Adobe Firefly's V3 image model. Optionally guide the output with a style reference image, a style preset ID, or a structure reference image. Returns the generated image URL(s) and (by default) the inline image bytes so Claude can see the result directly.",
      inputSchema,
    },
    async (args): Promise<CallToolResult> => {
      try {
        const size = SIZE_BY_PRESET[args.size];

        // Resolve any reference images. Path-mode auto-uploads to Firefly.
        const styleSource = args.style_image ? await resolveImageRef(args.style_image, client) : undefined;
        const structureSource = args.structure_image
          ? await resolveImageRef(args.structure_image, client)
          : undefined;

        const requestBody = {
          prompt: args.prompt,
          numVariations: args.num_variations,
          size,
          ...(args.negative_prompt ? { negativePrompt: args.negative_prompt } : {}),
          ...(args.content_class ? { contentClass: toContentClass(args.content_class) } : {}),
          ...(args.seeds ? { seeds: args.seeds } : {}),
          ...(args.style_image || args.style_preset_id || args.style_strength !== undefined
            ? {
                style: {
                  ...(args.style_preset_id ? { presets: [args.style_preset_id] } : {}),
                  ...(styleSource ? { imageReference: { source: styleSource } } : {}),
                  ...(args.style_strength !== undefined ? { strength: args.style_strength } : {}),
                },
              }
            : {}),
          ...(args.structure_image || args.structure_strength !== undefined
            ? {
                structure: {
                  ...(structureSource ? { imageReference: { source: structureSource } } : {}),
                  ...(args.structure_strength !== undefined
                    ? { strength: args.structure_strength }
                    : {}),
                },
              }
            : {}),
        };

        logger.debug({ promptLen: args.prompt.length, numVariations: args.num_variations }, "calling Firefly generateImages");
        const res = await client.generateImages(requestBody);
        const result = res.result;
        const outputs = result.outputs ?? [];

        const summary = {
          ok: true,
          variations: outputs.length,
          size: result.size,
          contentClass: result.contentClass,
          promptHasDeniedWords: result.promptHasDeniedWords ?? false,
          promptHasBlockedArtists: result.promptHasBlockedArtists ?? false,
          outputs: outputs.map((o) => ({ seed: o.seed, url: o.image?.url })),
        };

        // Always include a JSON summary so Claude can reason about what came back.
        const content: CallToolResult["content"] = [
          { type: "text", text: JSON.stringify(summary, null, 2) },
        ];

        // Optionally inline the image bytes so Claude can see the result.
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
