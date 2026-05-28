/**
 * firefly_generate_similar — generate variations of an existing reference image.
 *
 * Wraps FireflyClient.generateSimilarImages(). Takes a single source image
 * (uploadId / url / path) and returns N variations that preserve the subject
 * and overall feel of the source. Same dual-mode output contract as
 * firefly_generate_image.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FireflyClient } from "@adobe/firefly-apis";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { imageRefSchema } from "../../schemas/image-ref.js";
import { IMAGE_SIZE_PRESETS, SIZE_BY_PRESET } from "../../schemas/size-presets.js";
import { resolveImageRef } from "../../util/storage-refs.js";
import { mapSdkError, toolError } from "../../util/errors.js";
import { inlineImagesFromOutputs } from "../../util/inline-images.js";
import { logger } from "../../util/logger.js";

const inputSchema = {
  image: imageRefSchema.describe(
    "Reference image to generate variations of. Provide exactly one of uploadId, url, or path.",
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
    .describe("Output image size preset. Defaults to square_1024 (1024x1024)."),
  seeds: z
    .array(z.number().int())
    .optional()
    .describe(
      "Seeds for deterministic generation. If provided, length must equal num_variations.",
    ),
  tileable: z
    .boolean()
    .optional()
    .describe(
      "If true, the variations will be tileable (can repeat seamlessly). Useful for textures and backgrounds.",
    ),
  return_inline_image: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "If true (default), the generated image bytes are fetched and returned inline so Claude can see the result directly. If false, only the URL is returned.",
    ),
};

export function registerGenerateSimilar(server: McpServer, client: FireflyClient): void {
  server.registerTool(
    "firefly_generate_similar",
    {
      title: "Generate similar image variations",
      description:
        "Generate one or more variations of an existing reference image using Adobe Firefly. Preserves the subject and overall composition of the source while producing fresh variants. Returns the generated image URL(s) and (by default) the inline image bytes so Claude can see the result directly.",
      inputSchema,
    },
    async (args): Promise<CallToolResult> => {
      try {
        const size = SIZE_BY_PRESET[args.size];
        const imageSource = await resolveImageRef(args.image, client);

        const requestBody = {
          numVariations: args.num_variations,
          size,
          image: { source: imageSource },
          ...(args.seeds ? { seeds: args.seeds } : {}),
          ...(args.tileable !== undefined ? { tileable: args.tileable } : {}),
        };

        logger.debug(
          { numVariations: args.num_variations, size },
          "calling Firefly generateSimilarImages",
        );
        const res = await client.generateSimilarImages(requestBody);
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
            "Firefly returned no variations. The API call succeeded but produced an empty outputs array (may be due to content-safety rejection or a transient backend issue).";
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
