/**
 * Storage reference dispatcher.
 *
 * Converts the MCP-level ImageRef (which may include a local file path)
 * into the SDK-shaped PublicBinaryInput ({ url } | { uploadId }) that the
 * Adobe SDK accepts.
 *
 * The "path" mode auto-uploads the file via FireflyClient.upload() and
 * returns the resulting uploadId. This is the user-friendly shortcut from
 * ADR-004 — Claude can say "generate a variation of the image at /tmp/x.png"
 * without an explicit upload step.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { FireflyClient } from "@adobe/firefly-apis";
import type { ImageRef } from "../schemas/image-ref.js";
import { logger } from "./logger.js";

/** Shape the Firefly SDK accepts for image inputs. */
export interface SdkBinaryInput {
  url?: string;
  uploadId?: string;
}

const SUPPORTED_EXTENSIONS: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function inferMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mime = SUPPORTED_EXTENSIONS[ext];
  if (!mime) {
    throw new Error(
      `Unsupported image extension "${ext}". Firefly accepts PNG, JPEG, and WebP.`,
    );
  }
  return mime;
}

/**
 * Resolve an ImageRef into the SDK's PublicBinaryInput shape.
 * If `path` is set, uploads the file and returns the resulting uploadId.
 */
export async function resolveImageRef(
  ref: ImageRef,
  client: FireflyClient,
): Promise<SdkBinaryInput> {
  if (ref.uploadId) return { uploadId: ref.uploadId };
  if (ref.url) return { url: ref.url };
  if (ref.path) {
    const absPath = path.resolve(ref.path);
    inferMimeType(absPath); // validates extension early; throws if unsupported
    const bytes = await fs.readFile(absPath);
    const blob = new Blob([new Uint8Array(bytes)], { type: inferMimeType(absPath) });
    logger.debug({ path: absPath, size: bytes.length }, "auto-uploading local file to Firefly storage");
    const res = await client.upload(blob);
    const uploadId = res.result?.images?.[0]?.id;
    if (!uploadId) {
      throw new Error(
        `Firefly upload returned no image id. Full response: ${JSON.stringify(res.result)}`,
      );
    }
    return { uploadId };
  }
  // imageRefSchema.refine() should prevent us from reaching here, but type-narrow defensively.
  throw new Error("ImageRef has no uploadId, url, or path set.");
}
