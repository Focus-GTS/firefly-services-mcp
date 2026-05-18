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
import { resolveImageRef } from "../../util/storage-refs.js";
import { mapSdkError, toolError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";

// Same supported sizes the SDK documents for similar-image generation.
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

        const summary = {
          ok: true,
          variations: outputs.length,
          size: result.size,
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
