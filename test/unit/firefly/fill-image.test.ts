import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerFillImage } from "../../../src/tools/firefly/fill-image.js";
import type { FireflyClient } from "@adobe/firefly-apis";

async function callTool(server: McpServer, name: string, args: Record<string, unknown>) {
  const tool = (server as unknown as {
    _registeredTools: Record<string, { handler: (a: unknown, extra: unknown) => Promise<unknown> }>;
  })._registeredTools[name];
  if (!tool) throw new Error(`Tool ${name} not registered`);
  return tool.handler(args, {});
}

function makeClient(
  result: unknown = {
    result: {
      size: { width: 1024, height: 1024 },
      outputs: [{ seed: 99, image: { url: "https://example.com/fill.png" } }],
    },
  },
) {
  return {
    fillImage: vi.fn(async () => result),
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

describe("firefly_fill_image", () => {
  it("registers the tool", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerFillImage(server, makeClient());
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    expect(Object.keys(tools)).toContain("firefly_fill_image");
  });

  it("maps source and mask references onto the SDK body", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const client = makeClient();
    registerFillImage(server, client);
    await callTool(server, "firefly_fill_image", {
      image: { uploadId: "src-id" },
      mask: { uploadId: "mask-id" },
      prompt: "a fluffy dog",
      negative_prompt: "blurry",
      prompt_biasing_locale_code: "en-US",
      return_inline_image: false,
    });
    const body = (client.fillImage as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(body.prompt).toBe("a fluffy dog");
    expect(body.negativePrompt).toBe("blurry");
    expect(body.promptBiasingLocaleCode).toBe("en-US");
    expect(body.image.source).toEqual({ uploadId: "src-id" });
    expect(body.image.mask).toEqual({ uploadId: "mask-id" });
  });

  it("returns a structured error on SDK failure", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const client = {
      fillImage: vi.fn(async () => {
        throw new Error("fill exploded");
      }),
    } as unknown as FireflyClient;
    registerFillImage(server, client);
    const res = (await callTool(server, "firefly_fill_image", {
      image: { uploadId: "s" },
      mask: { uploadId: "m" },
      return_inline_image: false,
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.message).toContain("fill exploded");
  });

  // Audit Critical (test agent #2): empty outputs is not silent success.
  it("flags empty outputs with ok=false and a reason", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const client = makeClient({ result: { size: { width: 1024, height: 1024 }, outputs: [] } });
    registerFillImage(server, client);
    const res = (await callTool(server, "firefly_fill_image", {
      image: { uploadId: "s" },
      mask: { uploadId: "m" },
      return_inline_image: false,
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.ok).toBe(false);
    expect(parsed.variations).toBe(0);
    expect(parsed.reason).toBe("empty_result");
  });
});
