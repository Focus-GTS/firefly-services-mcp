/**
 * firefly_upload_image — upload a local image to Firefly's storage layer.
 *
 * Wraps FireflyClient.upload(). Returns an uploadId that subsequent
 * image-handling tools can pass as the source reference. Avoids re-uploading
 * the same source repeatedly across multiple generations.
 *
 * Security: the input path is validated against `FIREFLY_SERVICES_UPLOAD_ROOT`
 * (defaults to process.cwd()) via the path-guard helper. Paths outside the
 * upload root, symlinks escaping it, and hidden files are rejected. The
 * resolved absolute path is NEVER returned in the tool result — only the
 * file basename — to avoid leaking the user's homedir/username into the
 * chat transcript.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FireflyClient } from "@adobe/firefly-apis";
import { mapSdkError, toolError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";
import { guardUserPath } from "../../util/path-guard.js";

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const inputSchema = {
  path: z
    .string()
    .min(1)
    .describe(
      "Filesystem path to an image file. MUST resolve inside the configured upload root " +
        "(env var FIREFLY_SERVICES_UPLOAD_ROOT, defaults to the server's current working " +
        "directory). Relative paths are resolved against the upload root. Hidden files and " +
        "symlinks pointing outside the root are rejected. Supported formats: PNG, JPEG, " +
        "WebP. Max ~8 MB per file for most downstream generative endpoints.",
    ),
};

export function registerUploadImage(server: McpServer, client: FireflyClient): void {
  server.registerTool(
    "firefly_upload_image",
    {
      title: "Upload an image to Firefly storage",
      description:
        "Upload a local image file to Adobe Firefly's storage layer and return an uploadId. The returned ID can then be used as the source reference in firefly_generate_similar, firefly_expand_image, firefly_fill_image, or any other image-handling tool. Use this when you want to reuse the same source image across multiple downstream calls without re-uploading each time. The path is validated against FIREFLY_SERVICES_UPLOAD_ROOT (defaults to the server's CWD).",
      inputSchema,
    },
    async ({ path: filePath }) => {
      try {
        const guard = await guardUserPath(filePath);
        if (!guard.ok) {
          return toolError({
            code: guard.code,
            message: guard.message,
          });
        }

        const ext = path.extname(guard.resolvedPath).toLowerCase();
        const mime = MIME_BY_EXT[ext];
        if (!mime) {
          return toolError({
            code: "UNSUPPORTED_FORMAT",
            message: `Unsupported image extension "${ext}". Firefly accepts PNG, JPEG, and WebP.`,
            details: { basename: guard.basename, supportedExtensions: Object.keys(MIME_BY_EXT) },
          });
        }

        const bytes = await fs.readFile(guard.resolvedPath);
        const blob = new Blob([new Uint8Array(bytes)], { type: mime });
        // Do not log the full resolved path — it includes the user's homedir.
        logger.debug({ basename: guard.basename, size: bytes.length, mime }, "uploading image to Firefly");

        const res = await client.upload(blob);
        const uploadId = res.result?.images?.[0]?.id;
        if (!uploadId) {
          return toolError({
            code: "UPLOAD_NO_ID",
            message: "Firefly upload returned 200 but no image id in the response.",
            details: { response: res.result as unknown as Record<string, unknown> },
          });
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: true,
                  uploadId,
                  // Return basename only — the full resolved path leaks the
                  // user's homedir / username into the chat transcript.
                  filename: guard.basename,
                  size: bytes.length,
                  mime,
                  message:
                    "Image uploaded successfully. Pass this uploadId as the source reference in subsequent tools.",
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return toolError(mapSdkError(err));
      }
    },
  );
}
