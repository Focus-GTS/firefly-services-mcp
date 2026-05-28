import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGenerateObjectComposite } from "../../../src/tools/firefly/generate-object-composite.js";
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
      contentClass: "photo",
      outputs: [{ seed: 42, image: { url: "https://example.com/obj.png" } }],
    },
  },
) {
  return {
    generateObjectComposite: vi.fn(async () => result),
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

describe("firefly_generate_object_composite", () => {
  it("registers the tool", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerGenerateObjectComposite(server, makeClient());
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    expect(Object.keys(tools)).toContain("firefly_generate_object_composite");
  });

  it("maps prompt, size, content_class, style preset, and placement", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const client = makeClient();
    registerGenerateObjectComposite(server, client);
    await callTool(server, "firefly_generate_object_composite", {
      image: { uploadId: "product-id" },
      prompt: "in a sunlit kitchen",
      size: "square_2048",
      content_class: "photo",
      style_preset_id: "natural-light",
      style_strength: 80,
      placement_horizontal: "center",
      placement_vertical: "bottom",
      inset_bottom: 40,
      return_inline_image: false,
    });
    const body = (client.generateObjectComposite as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(body.prompt).toBe("in a sunlit kitchen");
    expect(body.size).toEqual({ width: 2048, height: 2048 });
    expect(body.contentClass).toBe("photo");
    expect(body.image.source).toEqual({ uploadId: "product-id" });
    expect(body.style.presets).toEqual(["natural-light"]);
    expect(body.style.strength).toBe(80);
    expect(body.placement.alignment).toEqual({ horizontal: "center", vertical: "bottom" });
    expect(body.placement.inset).toEqual({ bottom: 40 });
  });

  it("passes a mask reference when provided", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const client = makeClient();
    registerGenerateObjectComposite(server, client);
    await callTool(server, "firefly_generate_object_composite", {
      image: { uploadId: "product-id" },
      mask: { uploadId: "product-mask" },
      prompt: "on a marble counter",
      return_inline_image: false,
    });
    const body = (client.generateObjectComposite as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(body.image.mask).toEqual({ uploadId: "product-mask" });
  });

  it("returns a structured error on SDK failure", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const client = {
      generateObjectComposite: vi.fn(async () => {
        throw new Error("composite failed");
      }),
    } as unknown as FireflyClient;
    registerGenerateObjectComposite(server, client);
    const res = (await callTool(server, "firefly_generate_object_composite", {
      image: { uploadId: "x" },
      prompt: "test",
      return_inline_image: false,
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.message).toContain("composite failed");
  });

  // Audit Critical (test agent #2): empty outputs is not silent success.
  it("flags empty outputs with ok=false and a reason", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const client = makeClient({
      result: { size: { width: 1024, height: 1024 }, contentClass: "photo", outputs: [] },
    });
    registerGenerateObjectComposite(server, client);
    const res = (await callTool(server, "firefly_generate_object_composite", {
      image: { uploadId: "x" },
      prompt: "in an empty room",
      return_inline_image: false,
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.ok).toBe(false);
    expect(parsed.variations).toBe(0);
    expect(parsed.reason).toBe("empty_result");
  });
});
