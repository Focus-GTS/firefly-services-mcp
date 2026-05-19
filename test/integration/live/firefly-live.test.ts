/**
 * Live integration test — hits the real Adobe Firefly Services sandbox.
 *
 * This test is gated behind FIREFLY_SERVICES_INTEGRATION_TEST=1 (see
 * `npm run test:integration:live`). Without that env flag, the entire
 * suite is skipped — the script still exists so the workflow is
 * documented and ready for the real-credentials drop next week.
 *
 * The point of this file is NOT to repeat all the assertions in
 * firefly.test.ts — it is to verify that the SAME tool invocation path
 * which the mocked tests exercise also works against the real API when
 * given a real credential pair.
 */
import { describe, it, expect } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { loadCredentials } from "../../../src/auth/credentials.js";
import { TokenCache } from "../../../src/auth/token-cache.js";
import { getFireflyClient } from "../../../src/auth/firefly-client.js";
import { registerCheckAuth } from "../../../src/tools/firefly/check-auth.js";

const LIVE = process.env.FIREFLY_SERVICES_INTEGRATION_TEST === "1";

describe.skipIf(!LIVE)("firefly (live API)", () => {
  it("acquires a real IMS token via firefly_check_auth", async () => {
    const creds = loadCredentials();
    const tokenCache = new TokenCache(creds);
    // We construct the FireflyClient via the production factory to mirror
    // the runtime exactly; we don't actually need the client for
    // check-auth, but loading it surfaces any wiring regressions.
    getFireflyClient(creds, tokenCache);

    const mcp = new McpServer({ name: "live-test", version: "0.0.0" });
    registerCheckAuth(mcp, tokenCache);
    const tool = (
      mcp as unknown as {
        _registeredTools: Record<string, { handler: (a: unknown, extra: unknown) => Promise<unknown> }>;
      }
    )._registeredTools["firefly_check_auth"];
    const res = (await tool!.handler({ force_refresh: false }, {})) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.ok).toBe(true);
    expect(parsed.hasToken).toBe(true);
    expect(parsed.expiresInSec).toBeGreaterThan(0);
  });
});
