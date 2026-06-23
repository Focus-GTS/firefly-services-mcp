import { describe, it, expect, vi, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerGetJobStatus,
  isAllowedStatusUrl,
} from "../../../src/tools/firefly/get-job-status.js";
import type { TokenCache } from "../../../src/auth/token-cache.js";

function makeServerAndCache(token = "fake-token-12345") {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const tokenCache = {
    getToken: vi.fn(async () => token),
    status: vi.fn(),
    invalidate: vi.fn(),
  } as unknown as TokenCache;
  return { server, tokenCache };
}

async function callTool(server: McpServer, name: string, args: Record<string, unknown>) {
  const tool = (
    server as unknown as {
      _registeredTools: Record<string, { handler: (a: unknown, extra: unknown) => Promise<unknown> }>;
    }
  )._registeredTools[name];
  if (!tool) throw new Error(`Tool ${name} not registered`);
  return tool.handler(args, {});
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("isAllowedStatusUrl (SSRF guard)", () => {
  it("accepts Adobe *.adobe.io HTTPS hosts", () => {
    expect(isAllowedStatusUrl("https://firefly-epo851230.adobe.io/v3/status/urn:ff:jobs:x")).toBe(true);
    expect(isAllowedStatusUrl("https://image.adobe.io/pie/psdService/status/abc")).toBe(true);
    expect(isAllowedStatusUrl("https://adobe.io/x")).toBe(true);
  });
  it("rejects non-HTTPS, non-Adobe, IP literals, and look-alike hosts", () => {
    expect(isAllowedStatusUrl("http://firefly.adobe.io/x")).toBe(false); // not https
    expect(isAllowedStatusUrl("https://evil.com/x")).toBe(false);
    expect(isAllowedStatusUrl("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isAllowedStatusUrl("https://adobe.io.evil.com/x")).toBe(false); // suffix trick
    expect(isAllowedStatusUrl("https://notadobe.io/x")).toBe(false);
    expect(isAllowedStatusUrl("not a url")).toBe(false);
  });
});

describe("firefly_get_job_status", () => {
  const STATUS_URL = "https://firefly-epo851230.adobe.io/v3/status/urn:ff:jobs:abc";

  it("registers the tool", () => {
    const { server, tokenCache } = makeServerAndCache();
    registerGetJobStatus(server, tokenCache, "client-123");
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    expect(Object.keys(tools)).toContain("firefly_get_job_status");
  });

  it("reports a still-running job (done=false)", async () => {
    const { server, tokenCache } = makeServerAndCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ status: "running" }) })),
    );
    registerGetJobStatus(server, tokenCache, "client-123");
    const res = (await callTool(server, "firefly_get_job_status", {
      status_url: STATUS_URL,
      return_inline_image: true,
    })) as { content: Array<{ type: string; text: string }> };
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.status).toBe("running");
    expect(parsed.done).toBe(false);
    expect(parsed.succeeded).toBe(false);
    // sent the auth headers
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const headers = fetchMock.mock.calls[0]![1].headers;
    expect(headers.Authorization).toBe("Bearer fake-token-12345");
    expect(headers["x-api-key"]).toBe("client-123");
  });

  it("surfaces outputs and inlines images when the job succeeded", async () => {
    const { server, tokenCache } = makeServerAndCache();
    const imgBytes = Buffer.from("PNGDATA");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === STATUS_URL) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: "succeeded",
              outputs: [{ image: { url: "https://x.amazonaws.com/result.png" } }],
            }),
          };
        }
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => imgBytes,
          headers: { get: () => "image/png" },
        };
      }),
    );
    registerGetJobStatus(server, tokenCache, "client-123");
    const res = (await callTool(server, "firefly_get_job_status", {
      status_url: STATUS_URL,
      return_inline_image: true,
    })) as { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> };

    const parsed = JSON.parse(res.content[0]!.text!);
    expect(parsed.succeeded).toBe(true);
    expect(parsed.done).toBe(true);
    const imageBlock = res.content.find((c) => c.type === "image");
    expect(imageBlock).toBeDefined();
    expect(imageBlock!.data).toBe(imgBytes.toString("base64"));
  });

  it("does NOT inline images when return_inline_image=false", async () => {
    const { server, tokenCache } = makeServerAndCache();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: "succeeded", outputs: [{ image: { url: "https://x.amazonaws.com/r.png" } }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    registerGetJobStatus(server, tokenCache, "client-123");
    const res = (await callTool(server, "firefly_get_job_status", {
      status_url: STATUS_URL,
      return_inline_image: false,
    })) as { content: Array<{ type: string }> };
    expect(res.content.find((c) => c.type === "image")).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1); // status only, no image fetch
  });

  it("returns a structured tool error on a non-OK status response", async () => {
    const { server, tokenCache } = makeServerAndCache();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, statusText: "Not Found" })));
    registerGetJobStatus(server, tokenCache, "client-123");
    const res = (await callTool(server, "firefly_get_job_status", {
      status_url: STATUS_URL,
      return_inline_image: true,
    })) as { isError?: boolean; content: Array<{ text: string }> };
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.code).toBe("404");
  });
});
