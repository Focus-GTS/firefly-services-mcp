import { describe, it, expect, vi, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerRemoveBackground } from "../../../src/tools/photoshop/remove-background.js";
import type { TokenCache } from "../../../src/auth/token-cache.js";
import { callTool } from "../../util/call-tool.js";

function makeServerAndCache(token = "tok-bg") {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const tokenCache = {
    getToken: vi.fn(async () => token),
    status: vi.fn(),
    invalidate: vi.fn(),
  } as unknown as TokenCache;
  return { server, tokenCache };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("photoshop_remove_background (V2)", () => {
  it("registers the tool", () => {
    const { server, tokenCache } = makeServerAndCache();
    registerRemoveBackground(server, tokenCache, "client-x");
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    expect(Object.keys(tools)).toContain("photoshop_remove_background");
  });

  it("POSTs to /v2/remove-background with the V2 body + auth headers", async () => {
    const { server, tokenCache } = makeServerAndCache();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 202,
      json: async () => ({ jobId: "job-1", statusUrl: "https://image.adobe.io/v2/status/job-1" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    registerRemoveBackground(server, tokenCache, "client-x");

    const res = (await callTool(server, "photoshop_remove_background", {
      input_url: "https://x.amazonaws.com/photo.jpg",
    })) as { isError?: boolean; content: Array<{ text: string }> };

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.ok).toBe(true);
    expect(parsed.statusUrl).toBe("https://image.adobe.io/v2/status/job-1");
    expect(parsed.jobId).toBe("job-1");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://image.adobe.io/v2/remove-background");
    expect(init.headers.Authorization).toBe("Bearer tok-bg");
    expect(init.headers["x-api-key"]).toBe("client-x");
    const sent = JSON.parse(init.body);
    expect(sent.image.source.url).toBe("https://x.amazonaws.com/photo.jpg");
    expect(sent.mode).toBe("cutout"); // default
    expect(sent.output.mediaType).toBe("image/png"); // default
  });

  it("passes mode=mask and trim when provided", async () => {
    const { server, tokenCache } = makeServerAndCache();
    const fetchMock = vi.fn(async () => ({ ok: true, status: 202, json: async () => ({ jobId: "j", statusUrl: "https://image.adobe.io/v2/status/j" }) }));
    vi.stubGlobal("fetch", fetchMock);
    registerRemoveBackground(server, tokenCache, "client-x");
    await callTool(server, "photoshop_remove_background", {
      input_url: "https://x.amazonaws.com/p.jpg",
      mode: "mask",
      trim: true,
    });
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(sent.mode).toBe("mask");
    expect(sent.trim).toBe(true);
  });

  it("returns a structured error on a non-OK response", async () => {
    const { server, tokenCache } = makeServerAndCache();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, statusText: "Forbidden" })));
    registerRemoveBackground(server, tokenCache, "client-x");
    const res = (await callTool(server, "photoshop_remove_background", {
      input_url: "https://x.amazonaws.com/p.jpg",
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(res.isError).toBe(true);
    expect(JSON.parse(res.content[0]!.text).code).toBe("403");
  });
});
