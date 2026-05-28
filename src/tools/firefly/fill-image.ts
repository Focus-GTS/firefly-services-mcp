/**
 * firefly_fill_image — generative fill of a masked region (inpainting).
 *
 * Wraps FireflyClient.fillImage(). Takes a source image plus a mask image; the
 * white area of the mask is regenerated according to an optional text prompt.
 * The unmasked area is preserved verbatim.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FireflyClient } from "@adobe/firefly-apis";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { imageRefSchema } from "../../schemas/image-ref.js";
import { resolveImageRef } from "../../util/storage-refs.js";
import { mapSdkError, toolError } from "../../util/errors.js";
import { inlineImagesFromOutputs } from "../../util/inline-images.js";
import { logger } from "../../util/logger.js";

const inputSchema = {
  image: imageRefSchema.describe(
    "The source image to fill. Provide exactly one of uploadId, url, or path.",
  ),
  mask: imageRefSchema.describe(
    "The mask image marking the area to regenerate. White pixels in the mask are replaced; black pixels are preserved. The mask's larger side must be at least 600 px. Provide exactly one of uploadId, url, or path.",
  ),
  prompt: z
    .string()
    .max(1024)
    .optional()
    .describe(
      "Optional text prompt describing what should fill the masked area. Longer, more specific prompts produce better results.",
    ),
  negative_prompt: z
    .string()
    .optional()
    .describe("Text describing things to avoid in the generated fill content."),
  num_variations: z
    .number()
    .int()
    .min(1)
    .max(4)
    .optional()
    .default(1)
    .describe("Number of variations to generate. 1-4. Defaults to 1."),
  seeds: z
    .array(z.number().int())
    .optional()
    .describe(
      "Seeds for deterministic generation. If provided, length must equal num_variations.",
    ),
  prompt_biasing_locale_code: z
    .string()
    .optional()
    .describe(
      "Hyphen-separated ISO 639-1 language code and ISO 3166-1 region, such as 'en-US', to bias the prompt toward regionally relevant content.",
    ),
  return_inline_image: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "If true (default), the generated image bytes are fetched and returned inline so Claude can see the result directly. If false, only the URL is returned.",
    ),
};

export function registerFillImage(server: McpServer, client: FireflyClient): void {
  server.registerTool(
    "firefly_fill_image",
    {
      title: "Generative fill of a masked region",
      description:
        "Replace the masked area of an image with generative content (inpainting). Provide a source image, a mask image (white = replace, black = preserve), and optionally a text prompt describing what should fill the area. Returns the generated image URL(s) and (by default) the inline image bytes so Claude can see the result directly.",
      inputSchema,
    },
    async (args): Promise<CallToolResult> => {
      try {
        const sourceInput = await resolveImageRef(args.image, client);
        const maskInput = await resolveImageRef(args.mask, client);

        const requestBody = {
          numVariations: args.num_variations,
          image: {
            source: sourceInput,
            mask: maskInput,
          },
          ...(args.prompt ? { prompt: args.prompt } : {}),
          ...(args.negative_prompt ? { negativePrompt: args.negative_prompt } : {}),
          ...(args.seeds ? { seeds: args.seeds } : {}),
          ...(args.prompt_biasing_locale_code
            ? { promptBiasingLocaleCode: args.prompt_biasing_locale_code }
            : {}),
        };

        logger.debug({ numVariations: args.num_variations }, "calling Firefly fillImage");
        const res = await client.fillImage(requestBody);
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
            "Firefly returned no filled images. The API call succeeded but produced an empty outputs array (may be due to content-safety rejection or a transient backend issue).";
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
