/**
 * firefly_get_job_status — poll an asynchronous Firefly Services job.
 *
 * The async tools (firefly_generate_video today, and the Photoshop/Lightroom
 * job APIs) return a `statusUrl` rather than the finished result. There was
 * previously no way to follow up on that job from within MCP — the caller was
 * handed a URL it could not fetch. This tool closes that gap: give it the
 * `status_url` and it polls the job, returns the current status, and (when the
 * job has succeeded) surfaces the output URLs and optionally inlines image
 * results so Claude can see them directly.
 *
 * Auth: the status endpoint requires the same IMS Bearer token + x-api-key
 * the rest of the API uses. We pull the token from the shared TokenCache.
 *
 * Security: `status_url` is restricted to Adobe hosts (`*.adobe.io`). This is
 * an SSRF guard — without it, a malicious tool call could point the
 * credential-bearing fetch at an arbitrary host.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { TokenCache } from "../../auth/token-cache.js";
import { toolError } from "../../util/errors.js";
import { inlineImagesFromOutputs, type InlineableOutput } from "../../util/inline-images.js";
import { logger } from "../../util/logger.js";

/** True if `raw` is an HTTPS URL on an Adobe host (`*.adobe.io`). SSRF guard. */
export function isAllowedStatusUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (!host) return false;
  // Reject IP literals (host with only digits/dots, or any colon).
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":")) return false;
  return host === "adobe.io" || host.endsWith(".adobe.io");
}

const inputSchema = {
  status_url: z
    .string()
    .url()
    .refine(isAllowedStatusUrl, {
      message:
        "status_url must be an HTTPS URL on an Adobe host (*.adobe.io), e.g. the statusUrl returned by firefly_generate_video.",
    })
    .describe(
      "The job status URL returned by an async tool (e.g. the `statusUrl` from firefly_generate_video, " +
        "or a Photoshop/Lightroom job's self link). Must be an Adobe `*.adobe.io` URL.",
    ),
  return_inline_image: z
    .boolean()
    .optional()
    .default(true)
    .describe(
      "If true (default) and the job has finished with image outputs, the image bytes are fetched and " +
        "returned inline so Claude can see them. Set false to get only URLs (faster; correct for video/large batches).",
    ),
};

/** Recursively collect {image:{url}} outputs from the varied async response shapes. */
function collectImageOutputs(json: Record<string, unknown>): InlineableOutput[] {
  const result = (json.result ?? json) as Record<string, unknown>;
  const outputs = (result.outputs ?? json.outputs) as unknown;
  if (!Array.isArray(outputs)) return [];
  const blocks: InlineableOutput[] = [];
  for (const o of outputs) {
    const url = (o as { image?: { url?: string } })?.image?.url;
    if (typeof url === "string") blocks.push({ image: { url } });
  }
  return blocks;
}

export function registerGetJobStatus(
  server: McpServer,
  tokenCache: TokenCache,
  clientId: string,
): void {
  server.registerTool(
    "firefly_get_job_status",
    {
      title: "Poll an async Firefly job",
      description:
        "Check the status of an asynchronous Firefly Services job using the status URL a prior async tool returned " +
        "(e.g. firefly_generate_video's statusUrl). Returns the job status (running / succeeded / failed), and when " +
        "the job has succeeded, the output URLs plus (by default) inline image bytes. Use this to follow up on any " +
        "tool that returned a jobId/statusUrl instead of a finished result. Poll every few seconds; video jobs take 1-3 minutes.",
      inputSchema,
    },
    async (args): Promise<CallToolResult> => {
      try {
        const token = await tokenCache.getToken();
        logger.debug({ host: new URL(args.status_url).host }, "polling job status");
        const res = await fetch(args.status_url, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
            "x-api-key": clientId,
            Accept: "application/json",
          },
        });

        if (!res.ok) {
          return toolError({
            code: String(res.status),
            message: `Job status request failed: HTTP ${res.status} ${res.statusText}`,
            details: { statusUrl: args.status_url },
          });
        }

        const json = (await res.json()) as Record<string, unknown>;
        const status = (json.status ?? (json.result as { status?: string })?.status) as
          | string
          | undefined;
        const normalized = (status ?? "unknown").toLowerCase();
        const succeeded = normalized === "succeeded" || normalized === "success";
        const failed = normalized === "failed" || normalized === "error";
        const done = succeeded || failed;

        const summary: Record<string, unknown> = {
          ok: !failed,
          status: status ?? "unknown",
          done,
          succeeded,
          message: succeeded
            ? "Job succeeded. Output URLs are in the response below."
            : failed
              ? "Job failed. See the response detail below."
              : "Job is still running. Poll this status_url again in a few seconds.",
          response: json,
        };

        const content: CallToolResult["content"] = [
          { type: "text", text: JSON.stringify(summary, null, 2) },
        ];

        if (succeeded && args.return_inline_image) {
          const images = collectImageOutputs(json);
          if (images.length > 0) {
            content.push(...(await inlineImagesFromOutputs(images)));
          }
        }

        return { content };
      } catch (err) {
        return toolError({
          code: "STATUS_POLL_ERROR",
          message: `Failed to poll job status: ${(err as Error).message}`,
        });
      }
    },
  );
}
