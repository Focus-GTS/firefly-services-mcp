/**
 * Inline-image helper — convert a list of Firefly output URLs into MCP
 * `image` content blocks (base64-encoded), suitable for appending to a
 * CallToolResult.content array.
 *
 * Pulled out of generate-image / generate-similar / expand-image / fill-image
 * / generate-object-composite, all of which had the same ~22 lines of fetch +
 * Buffer.toString("base64") logic copy-pasted in.
 *
 * Fetch failures are logged and skipped — we don't want a single bad CDN
 * response to fail an entire multi-variation generation.
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { logger } from "./logger.js";

/** Shape of a Firefly generation output we care about: it has an optional image.url. */
export interface InlineableOutput {
  image?: { url?: string } | undefined;
}

/** Default MIME type used when the upstream response does not declare one. */
const DEFAULT_IMAGE_MIME = "image/png";

/**
 * Fetch each output's image and return them as MCP `image` content blocks.
 * Outputs with no URL are skipped silently. Fetch failures are logged and
 * skipped (we do not throw — partial inlining is better than failing the
 * whole tool call when only one variant's CDN URL is flaky).
 */
export async function inlineImagesFromOutputs(
  outputs: readonly InlineableOutput[],
): Promise<CallToolResult["content"]> {
  const blocks: CallToolResult["content"] = [];
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
      const mime = imgRes.headers.get("content-type") ?? DEFAULT_IMAGE_MIME;
      blocks.push({
        type: "image",
        data: buf.toString("base64"),
        mimeType: mime,
      });
    } catch (fetchErr) {
      logger.warn(
        { url, err: (fetchErr as Error).message },
        "error fetching generated image",
      );
    }
  }
  return blocks;
}
