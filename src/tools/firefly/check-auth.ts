/**
 * firefly_check_auth — verify credentials and report token status.
 *
 * The first tool we ship. Useful for "is this thing wired up?" pre-flight
 * before invoking any of the actual API tools. Does not generate anything
 * and consumes negligible quota.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TokenCache } from "../../auth/token-cache.js";
import { mapSdkError, toolError } from "../../util/errors.js";
import { logger } from "../../util/logger.js";

const inputSchema = {
  force_refresh: z
    .boolean()
    .optional()
    .default(false)
    .describe("If true, force an immediate token refresh even if the cached token is still valid."),
};

export function registerCheckAuth(server: McpServer, tokenCache: TokenCache): void {
  server.registerTool(
    "firefly_check_auth",
    {
      title: "Check Firefly Services authentication",
      description:
        "Verify that FIREFLY_SERVICES_CLIENT_ID and FIREFLY_SERVICES_CLIENT_SECRET are configured correctly by requesting an IMS access token. Returns token status (cached vs newly fetched) and absolute expiry time. Does not generate any image or video content.",
      inputSchema,
    },
    async ({ force_refresh }) => {
      try {
        if (force_refresh) {
          // Drop the cached token so the next getToken() hits IMS.
          // Useful as a debugging tool when credentials have been rotated
          // or a token is suspected of being server-side revoked.
          logger.debug("force_refresh requested — invalidating cached token");
          tokenCache.invalidate();
        }

        const token = await tokenCache.getToken();
        const status = tokenCache.status();

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  ok: true,
                  hasToken: true,
                  tokenPreview: `${token.slice(0, 6)}...${token.slice(-4)}`,
                  expiresAt: status.expiresAt ? new Date(status.expiresAt).toISOString() : null,
                  expiresInSec: status.expiresInSec,
                  message: "Credentials valid. IMS token acquired or reused from cache.",
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
