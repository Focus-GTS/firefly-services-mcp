import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCheckAuth } from "../../../src/tools/firefly/check-auth.js";
import type { TokenCache } from "../../../src/auth/token-cache.js";

function makeServerAndCache(token = "fake-token-12345") {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const tokenCache = {
    getToken: vi.fn(async () => token),
    status: vi.fn(() => ({ hasToken: true, expiresAt: Date.now() + 3_600_000, expiresInSec: 3600 })),
  } as unknown as TokenCache;
  return { server, tokenCache };
}

async function callTool(server: McpServer, name: string, args: Record<string, unknown>) {
  // Reach into the server's internal registry. This is testing the registration shape, not the protocol.
  const tool = (server as unknown as { _registeredTools: Record<string, { handler: (a: unknown, extra: unknown) => Promise<unknown> }> })
    ._registeredTools[name];
  if (!tool) throw new Error(`Tool ${name} not registered`);
  return tool.handler(args, {});
}

describe("firefly_check_auth", () => {
  it("registers the tool", () => {
    const { server, tokenCache } = makeServerAndCache();
    registerCheckAuth(server, tokenCache);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    expect(Object.keys(tools)).toContain("firefly_check_auth");
  });

  it("returns ok=true with a token preview when credentials are valid", async () => {
    const { server, tokenCache } = makeServerAndCache("abcdefghijklmnopqrstuvwxyz");
    registerCheckAuth(server, tokenCache);
    const res = (await callTool(server, "firefly_check_auth", { force_refresh: false })) as {
      content: Array<{ type: string; text: string }>;
    };
    expect(res.content).toHaveLength(1);
    expect(res.content[0]!.type).toBe("text");
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.ok).toBe(true);
    expect(parsed.hasToken).toBe(true);
    expect(parsed.tokenPreview).toMatch(/^[a-z]{12}\.\.\.[a-z]{8}$/);
  });

  it("propagates token-cache errors as structured tool errors", async () => {
    const { server } = makeServerAndCache();
    const tokenCache = {
      getToken: vi.fn(async () => {
        throw new Error("IMS rejected credentials");
      }),
      status: vi.fn(() => ({ hasToken: false, expiresAt: null, expiresInSec: null })),
    } as unknown as TokenCache;
    registerCheckAuth(server, tokenCache);
    const res = (await callTool(server, "firefly_check_auth", { force_refresh: false })) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.message).toContain("IMS rejected credentials");
  });
});
