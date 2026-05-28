import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGenerateImage } from "../../../src/tools/firefly/generate-image.js";
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
      outputs: [
        { seed: 11, image: { url: "https://example.com/a.png" } },
        { seed: 22, image: { url: "https://example.com/b.png" } },
      ],
    },
  },
) {
  return {
    generateImages: vi.fn(async () => generateResult),
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

describe("firefly_generate_image", () => {
  it("registers the tool", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerGenerateImage(server, makeClient());
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    expect(Object.keys(tools)).toContain("firefly_generate_image");
  });

  it("calls the SDK with mapped snake_case → camelCase and returns a summary", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const client = makeClient();
    registerGenerateImage(server, client);

    // Skip inlining to keep the test focused on the request mapping.
    const res = (await callTool(server, "firefly_generate_image", {
      prompt: "a cat astronaut",
      num_variations: 2,
      size: "square_1024",
      content_class: "photo",
      negative_prompt: "blurry",
      return_inline_image: false,
    })) as { content: Array<{ type: string; text: string }> };

    expect(client.generateImages).toHaveBeenCalledTimes(1);
    const body = (client.generateImages as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(body.prompt).toBe("a cat astronaut");
    expect(body.numVariations).toBe(2);
    expect(body.size).toEqual({ width: 1024, height: 1024 });
    expect(body.contentClass).toBe("photo");
    expect(body.negativePrompt).toBe("blurry");

    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.ok).toBe(true);
    expect(parsed.variations).toBe(2);
    expect(parsed.outputs[0]).toEqual({ seed: 11, url: "https://example.com/a.png" });
  });

  it("resolves a style_image via uploadId without auto-upload", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const client = makeClient();
    registerGenerateImage(server, client);
    await callTool(server, "firefly_generate_image", {
      prompt: "x",
      style_image: { uploadId: "preuploaded-style" },
      style_strength: 50,
      return_inline_image: false,
    });
    const body = (client.generateImages as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(body.style).toBeDefined();
    expect(body.style.imageReference.source).toEqual({ uploadId: "preuploaded-style" });
    expect(body.style.strength).toBe(50);
    expect(client.upload).not.toHaveBeenCalled();
  });

  it("inlines image bytes when return_inline_image is true", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const client = makeClient({
      result: {
        size: { width: 1024, height: 1024 },
        outputs: [{ seed: 1, image: { url: "https://example.com/a.png" } }],
      },
    });
    registerGenerateImage(server, client);

    globalThis.fetch = vi.fn(async () =>
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    ) as unknown as typeof fetch;

    const res = (await callTool(server, "firefly_generate_image", {
      prompt: "hi",
      return_inline_image: true,
    })) as { content: Array<{ type: string; data?: string; mimeType?: string; text?: string }> };

    const images = res.content.filter((c) => c.type === "image");
    expect(images).toHaveLength(1);
    expect(images[0]!.mimeType).toBe("image/png");
    expect(images[0]!.data).toBe(Buffer.from([1, 2, 3, 4]).toString("base64"));
  });

  it("maps SDK errors to structured tool errors", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const client = {
      generateImages: vi.fn(async () => {
        throw new Error("Adobe IMS failure");
      }),
    } as unknown as FireflyClient;
    registerGenerateImage(server, client);
    const res = (await callTool(server, "firefly_generate_image", {
      prompt: "x",
      return_inline_image: false,
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.message).toContain("Adobe IMS failure");
  });

  // Audit Critical (test agent #2): Firefly can return 200 + an empty
  // outputs array when the prompt is denied by content safety. The tool
  // must surface this clearly rather than silently reporting success.
  it("flags content-safety rejection when Firefly returns empty outputs + denied words", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const client = makeClient({
      result: {
        size: { width: 1024, height: 1024 },
        outputs: [],
        promptHasDeniedWords: true,
        promptHasBlockedArtists: false,
      },
    });
    registerGenerateImage(server, client);
    const res = (await callTool(server, "firefly_generate_image", {
      prompt: "something refused",
      return_inline_image: false,
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };
    // The HTTP call succeeded so we don't mark this as a protocol-level
    // error; instead we flip ok=false and include a reason the LLM can act on.
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.ok).toBe(false);
    expect(parsed.variations).toBe(0);
    expect(parsed.reason).toBe("content_safety_rejected");
    expect(parsed.message).toMatch(/content safety|denied words|blocked artists/i);
    expect(parsed.promptHasDeniedWords).toBe(true);
  });
});
