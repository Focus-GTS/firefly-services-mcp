/**
 * photoshop_remove_background — isolate the subject and remove the background.
 *
 * Uses the Remove Background **V2** API (`POST image.adobe.io/v2/remove-background`).
 * The legacy V1 endpoint the SDK wraps (`/sensei/cutout`) reached End-of-Life on
 * 2025-10-15 and now returns 502, so this tool calls V2 directly with the shared
 * IMS token rather than the SDK method.
 *
 * Unlike the Photoshop document APIs, V2 remove-background HOSTS the result —
 * it returns an Adobe pre-signed `destination.url` in the job status, so the
 * caller does NOT supply an output bucket. Submit returns a jobId + statusUrl;
 * poll it with `firefly_get_job_status` to retrieve the result URL.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { TokenCache } from "../../auth/token-cache.js";
import { toolError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";

const REMOVE_BG_V2_URL = "https://image.adobe.io/v2/remove-background";

const inputSchema = {
  input_url: z
    .string()
    .url()
    .describe(
      "Pre-signed GET URL to the source image whose background should be removed (JPEG or PNG).",
    ),
  mode: z
    .enum(["cutout", "mask"])
    .optional()
    .default("cutout")
    .describe(
      "'cutout' (default) returns the subject on a transparent background; 'mask' returns a grayscale alpha mask.",
    ),
  trim: z
    .boolean()
    .optional()
    .describe("If true, crop the result to the bounding box of the subject (removes transparent margins)."),
  output_media_type: z
    .enum(["image/png", "image/jpeg", "image/webp"])
    .optional()
    .default("image/png")
    .describe("MIME type of the result. Defaults to image/png (preserves transparency for cutout mode)."),
};

export function registerRemoveBackground(
  server: McpServer,
  tokenCache: TokenCache,
  clientId: string,
): void {
  server.registerTool(
    "photoshop_remove_background",
    {
      title: "Remove the background from an image",
      description:
        "Isolate the subject of an image and remove the background using Adobe's Remove Background V2 API. Provide a pre-signed GET URL to the source image; the result is hosted by Adobe (you do NOT need an output bucket). Choose 'cutout' (subject on transparent background) or 'mask' (grayscale mask). This is an async job — it returns a jobId and statusUrl; poll with firefly_get_job_status to get the result URL. Useful for product shots, headshots, and compositing.",
      inputSchema,
    },
    async (args): Promise<CallToolResult> => {
      try {
        const token = await tokenCache.getToken();
        const body = {
          image: { source: { url: args.input_url } },
          mode: args.mode,
          ...(args.trim !== undefined ? { trim: args.trim } : {}),
          output: { mediaType: args.output_media_type },
        };

        logger.debug({ mode: args.mode }, "calling Remove Background V2");
        const res = await fetch(REMOVE_BG_V2_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "x-api-key": clientId,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          return toolError({
            code: String(res.status),
            message: `Remove Background V2 request failed: HTTP ${res.status} ${res.statusText}`,
          });
        }

        const json = (await res.json()) as {
          jobId?: string;
          statusUrl?: string;
          _links?: { self?: { href?: string } };
        };
        const statusUrl = json.statusUrl ?? json._links?.self?.href;

        if (!statusUrl) {
          return toolError({
            code: "INCOMPLETE_RESPONSE",
            message:
              "Remove Background V2 accepted the request but returned no statusUrl to track the job.",
            details: { hasJobId: Boolean(json.jobId) },
          });
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: true,
                  async: true,
                  jobId: json.jobId,
                  statusUrl,
                  message:
                    "Remove-background job submitted (V2). Poll statusUrl with firefly_get_job_status; the result is at destination.url in the completed status (Adobe-hosted, ~1h expiry).",
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return toolError({
          code: "REMOVE_BG_ERROR",
          message: `Remove Background V2 call failed: ${(err as Error).message}`,
        });
      }
    },
  );
}
