import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGenerateSimilar } from "../../../src/tools/firefly/generate-similar.js";
import type { FireflyClient } from "@adobe/firefly-apis";

async function callTool(server: McpServer, name: string, args: Record<string, unknown>) {
  const tool = (server as unknown as {
    _registeredTools: Record<string, { handler: (a: unknown, extra: unknown) => Promise<unknown> }>;
  })._registeredTools[name];
  if (!tool) throw new Error(`Tool ${name} not registered`);
  return tool.handler(args, {});
}

function makeClient(
  generateResult: unknown = {
    result: {
      size: { width: 1024, height: 1024 },
      outputs: [{ seed: 7, image: { url: "https://example.com/sim.png" } }],
    },
  },
) {
  return {
    generateSimilarImages: vi.fn(async () => generateResult),
    upload: vi.fn(async () => ({ result: { images: [{ id: "auto-upload-id" }] } })),
  } as unknown as FireflyClient;
}

let originalFetch: typeof globalThis.fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("firefly_generate_similar", () => {
  it("registers the tool", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerGenerateSimilar(server, makeClient());
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    expect(Object.keys(tools)).toContain("firefly_generate_similar");
  });

  it("passes uploadId through and maps snake_case → camelCase", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const client = makeClient();
    registerGenerateSimilar(server, client);
    await callTool(server, "firefly_generate_similar", {
      image: { uploadId: "src-id" },
      num_variations: 3,
      size: "landscape_2304x1792",
      tileable: true,
      return_inline_image: false,
    });
    const body = (client.generateSimilarImages as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(body.numVariations).toBe(3);
    expect(body.size).toEqual({ width: 2304, height: 1792 });
    expect(body.tileable).toBe(true);
    expect(body.image).toEqual({ source: { uploadId: "src-id" } });
    expect(client.upload).not.toHaveBeenCalled();
  });

  it("passes a url ref straight through", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const client = makeClient();
    registerGenerateSimilar(server, client);
    await callTool(server, "firefly_generate_similar", {
      image: { url: "https://files.amazonaws.com/x.png" },
      return_inline_image: false,
    });
    const body = (client.generateSimilarImages as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(body.image).toEqual({ source: { url: "https://files.amazonaws.com/x.png" } });
  });

  it("returns a structured error on SDK failure", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const client = {
      generateSimilarImages: vi.fn(async () => {
        throw new Error("rate limited");
      }),
    } as unknown as FireflyClient;
    registerGenerateSimilar(server, client);
    const res = (await callTool(server, "firefly_generate_similar", {
      image: { uploadId: "x" },
      return_inline_image: false,
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.message).toContain("rate limited");
  });

  // Audit Critical (test agent #2): empty outputs must surface a reason
  // so the LLM doesn't treat "0 variations" as silent success.
  it("flags empty outputs with ok=false and a reason", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const client = makeClient({ result: { size: { width: 1024, height: 1024 }, outputs: [] } });
    registerGenerateSimilar(server, client);
    const res = (await callTool(server, "firefly_generate_similar", {
      image: { uploadId: "x" },
      return_inline_image: false,
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.ok).toBe(false);
    expect(parsed.variations).toBe(0);
    expect(parsed.reason).toBe("empty_result");
    expect(parsed.message).toMatch(/no variations|empty/i);
  });
});
