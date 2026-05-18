import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerExpandImage } from "../../../src/tools/firefly/expand-image.js";
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
      size: { width: 2304, height: 1792 },
      outputs: [{ seed: 5, image: { url: "https://example.com/exp.png" } }],
    },
  },
) {
  return {
    expandImage: vi.fn(async () => result),
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

describe("firefly_expand_image", () => {
  it("registers the tool", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerExpandImage(server, makeClient());
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    expect(Object.keys(tools)).toContain("firefly_expand_image");
  });

  it("maps placement, size, and prompt onto the SDK body", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const client = makeClient();
    registerExpandImage(server, client);
    await callTool(server, "firefly_expand_image", {
      image: { uploadId: "src" },
      prompt: "sandy beach",
      width: 2304,
      height: 1792,
      placement_horizontal: "left",
      placement_vertical: "top",
      inset_left: 100,
      inset_top: 50,
      return_inline_image: false,
    });
    const body = (client.expandImage as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(body.prompt).toBe("sandy beach");
    expect(body.size).toEqual({ width: 2304, height: 1792 });
    expect(body.image).toEqual({ source: { uploadId: "src" } });
    expect(body.placement.alignment).toEqual({ horizontal: "left", vertical: "top" });
    expect(body.placement.inset).toEqual({ left: 100, top: 50 });
  });

  it("passes through a mask reference and omits size when not provided", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const client = makeClient();
    registerExpandImage(server, client);
    await callTool(server, "firefly_expand_image", {
      image: { uploadId: "src" },
      mask: { uploadId: "mask-1" },
      return_inline_image: false,
    });
    const body = (client.expandImage as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(body.image.mask).toEqual({ uploadId: "mask-1" });
    expect(body.size).toBeUndefined();
  });

  it("returns a structured error on SDK failure", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const client = {
      expandImage: vi.fn(async () => {
        throw new Error("expand failed");
      }),
    } as unknown as FireflyClient;
    registerExpandImage(server, client);
    const res = (await callTool(server, "firefly_expand_image", {
      image: { uploadId: "x" },
      return_inline_image: false,
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.message).toContain("expand failed");
  });
});
