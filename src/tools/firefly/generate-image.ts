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
import { IMAGE_SIZE_PRESETS, SIZE_BY_PRESET } from "../../schemas/size-presets.js";
import { resolveImageRef } from "../../util/storage-refs.js";
import { mapSdkError, toolError } from "../../util/errors.js";
import { inlineImagesFromOutputs } from "../../util/inline-images.js";
import { logger } from "../../util/logger.js";

function toContentClass(s: "photo" | "art" | undefined): ContentClass | undefined {
  if (s === "photo") return ContentClass.PHOTO;
  if (s === "art") return ContentClass.ART;
  return undefined;
}

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
    .enum(IMAGE_SIZE_PRESETS)
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
        const deniedWords = result.promptHasDeniedWords ?? false;
        const blockedArtists = result.promptHasBlockedArtists ?? false;
        // Firefly returns 200 + an empty outputs array when the prompt is
        // refused by content safety (denied words / blocked artists). Mark
        // that case explicitly so the LLM sees the rejection rather than
        // a silent "ok: true, variations: 0" success.
        const contentSafetyRejected = outputs.length === 0 && (deniedWords || blockedArtists);
        const empty = outputs.length === 0;

        const summary: Record<string, unknown> = {
          ok: !empty,
          variations: outputs.length,
          size: result.size,
          contentClass: result.contentClass,
          promptHasDeniedWords: deniedWords,
          promptHasBlockedArtists: blockedArtists,
          outputs: outputs.map((o) => ({ seed: o.seed, url: o.image?.url })),
        };
        if (empty) {
          summary.reason = contentSafetyRejected
            ? "content_safety_rejected"
            : "empty_result";
          summary.message = contentSafetyRejected
            ? "Firefly returned no images: the prompt was rejected by content safety (denied words and/or blocked artists). Revise the prompt and try again."
            : "Firefly returned no images. The API call succeeded but produced an empty outputs array.";
        }

        // Always include a JSON summary so Claude can reason about what came back.
        const content: CallToolResult["content"] = [
          { type: "text", text: JSON.stringify(summary, null, 2) },
        ];

        // Optionally inline the image bytes so Claude can see the result.
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
