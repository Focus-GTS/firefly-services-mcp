/**
 * HTTP-layer mocked integration tests for the Firefly tools.
 *
 * These tests run the real source code (FireflyClient, TokenCache, tool
 * register functions) against an MSW HTTPS interceptor. They catch bugs
 * that the SDK-level unit tests cannot see:
 *
 *   - the SDK request body shape mismatching the wire format
 *   - the response parser missing fields the API actually returns
 *   - missing headers (Authorization, x-api-key, Content-Type)
 *
 * When the real Adobe sandbox arrives, the same assertions will run
 * against the live API by flipping the test-runner script.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FireflyClient } from "@adobe/firefly-apis";
import type { ClientConfig, TokenProvider } from "@adobe/firefly-services-sdk-core";

import { TokenCache } from "../../src/auth/token-cache.js";
import { registerCheckAuth } from "../../src/tools/firefly/check-auth.js";
import { registerUploadImage } from "../../src/tools/firefly/upload-image.js";
import { registerGenerateImage } from "../../src/tools/firefly/generate-image.js";
import { registerGenerateSimilar } from "../../src/tools/firefly/generate-similar.js";
import { registerExpandImage } from "../../src/tools/firefly/expand-image.js";
import { registerFillImage } from "../../src/tools/firefly/fill-image.js";
import { registerGenerateObjectComposite } from "../../src/tools/firefly/generate-object-composite.js";
import { registerGenerateVideo } from "../../src/tools/firefly/generate-video.js";

import {
  server,
  installMswLifecycle,
  http,
  HttpResponse,
  fakeCredentials,
  FIREFLY_API_BASE,
  FAKE_IMS_TOKEN,
} from "./setup.js";

installMswLifecycle({ beforeAll, afterEach, afterAll });

/** Build the real FireflyClient bound to a real TokenCache + fake creds. */
function buildFireflyClient(): { client: FireflyClient; tokenCache: TokenCache } {
  const creds = fakeCredentials();
  const tokenCache = new TokenCache(creds);
  class Adapter implements TokenProvider {
    async getToken(): Promise<string> {
      return tokenCache.getToken();
    }
  }
  const config: ClientConfig = {
    clientId: creds.clientId,
    tokenProvider: new Adapter(),
  };
  return { client: new FireflyClient(config), tokenCache };
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

/** Capture-and-respond helper: records the request and returns a fixed body. */
function captureAndRespond<T>(
  captured: { request?: Request; body?: unknown },
  body: T,
  status = 200,
) {
  return async ({ request }: { request: Request }) => {
    captured.request = request.clone();
    try {
      captured.body = await request.clone().json();
    } catch {
      captured.body = await request.clone().text();
    }
    return HttpResponse.json(body, { status });
  };
}

const PNG_PIXEL_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

/** Default handler for "image bytes fetched inline" follow-up calls. */
function installImageFetchHandler(urlPrefix: string): void {
  server.use(
    http.get(`${urlPrefix}/*`, () => {
      return new HttpResponse(PNG_PIXEL_BYTES, {
        status: 200,
        headers: { "Content-Type": "image/png" },
      });
    }),
  );
}

describe("firefly_check_auth (integration: real TokenCache -> mocked IMS)", () => {
  it("hits the IMS token endpoint, parses the response, and reports an alive token", async () => {
    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    const { tokenCache } = buildFireflyClient();
    registerCheckAuth(mcp, tokenCache);

    const res = (await callTool(mcp, "firefly_check_auth", { force_refresh: false })) as {
      content: Array<{ type: string; text: string }>;
    };
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.ok).toBe(true);
    expect(parsed.hasToken).toBe(true);
    expect(parsed.expiresInSec).toBeGreaterThan(60_000);
    // The default IMS handler returns FAKE_IMS_TOKEN; tokenPreview is
    // `${first12}...${last8}` of the access_token string.
    expect(parsed.tokenPreview).toBe(
      `${FAKE_IMS_TOKEN.slice(0, 12)}...${FAKE_IMS_TOKEN.slice(-8)}`,
    );
  });

  it("surfaces an IMS 401 as a structured tool error (no real network)", async () => {
    server.use(
      http.post("https://ims-na1.adobelogin.com/ims/token/v3", () => {
        return new HttpResponse(JSON.stringify({ error: "invalid_client" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    const { tokenCache } = buildFireflyClient();
    registerCheckAuth(mcp, tokenCache);

    const res = (await callTool(mcp, "firefly_check_auth", { force_refresh: false })) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.message).toContain("HTTP 401");
  });
});

describe("firefly_upload_image (integration)", () => {
  it("POSTs to /v2/storage/image with the file bytes and parses the upload id", async () => {
    const captured: { request?: Request; body?: unknown } = {};
    server.use(
      http.post(`${FIREFLY_API_BASE}/v2/storage/image`, async ({ request }) => {
        captured.request = request.clone();
        captured.body = await request.clone().arrayBuffer();
        return HttpResponse.json({ images: [{ id: "upload-abc-123" }] });
      }),
    );

    // Use a real file on disk: any PNG in node_modules works. Pick package.json
    // path — but we need a PNG/JPG. Write a temp PNG so we don't depend on
    // arbitrary repo files.
    const tmpPath = `/tmp/firefly-int-${Date.now()}.png`;
    const fs = await import("node:fs/promises");
    await fs.writeFile(tmpPath, PNG_PIXEL_BYTES);

    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    const { client } = buildFireflyClient();
    registerUploadImage(mcp, client);

    const res = (await callTool(mcp, "firefly_upload_image", { path: tmpPath })) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.uploadId).toBe("upload-abc-123");
    expect(parsed.mime).toBe("image/png");

    // Verify the HTTP-layer request shape.
    expect(captured.request).toBeDefined();
    expect(captured.request!.method).toBe("POST");
    expect(captured.request!.headers.get("authorization")).toBe(`Bearer ${FAKE_IMS_TOKEN}`);
    expect(captured.request!.headers.get("x-api-key")).toBe("msw-fake-client-id");
    expect(captured.request!.headers.get("content-type")).toBe("image/png");
    // Body should be the raw PNG bytes.
    expect((captured.body as ArrayBuffer).byteLength).toBe(PNG_PIXEL_BYTES.length);

    await fs.unlink(tmpPath);
  });

  it("returns a structured error when /v2/storage/image responds with no image id", async () => {
    server.use(
      http.post(`${FIREFLY_API_BASE}/v2/storage/image`, () => {
        return HttpResponse.json({ images: [] });
      }),
    );

    const tmpPath = `/tmp/firefly-int-empty-${Date.now()}.png`;
    const fs = await import("node:fs/promises");
    await fs.writeFile(tmpPath, PNG_PIXEL_BYTES);

    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    const { client } = buildFireflyClient();
    registerUploadImage(mcp, client);

    const res = (await callTool(mcp, "firefly_upload_image", { path: tmpPath })) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.code).toBe("UPLOAD_NO_ID");

    await fs.unlink(tmpPath);
  });
});

describe("firefly_generate_image (integration)", () => {
  it("POSTs prompt + size to /v3/images/generate and inlines the resulting image", async () => {
    installImageFetchHandler("https://generated.example.adobe.io");
    const captured: { request?: Request; body?: unknown } = {};
    server.use(
      http.post(
        `${FIREFLY_API_BASE}/v3/images/generate`,
        captureAndRespond(captured, {
          size: { width: 1024, height: 1024 },
          contentClass: "photo",
          promptHasDeniedWords: false,
          promptHasBlockedArtists: false,
          outputs: [
            {
              seed: 42,
              image: { url: "https://generated.example.adobe.io/img-42.png" },
            },
            {
              seed: 43,
              image: { url: "https://generated.example.adobe.io/img-43.png" },
            },
          ],
        }),
      ),
    );

    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    const { client } = buildFireflyClient();
    registerGenerateImage(mcp, client);

    const res = (await callTool(mcp, "firefly_generate_image", {
      prompt: "a serene mountain lake at sunrise",
      num_variations: 2,
      size: "square_1024",
      content_class: "photo",
      return_inline_image: true,
    })) as { isError?: boolean; content: Array<{ type: string; text?: string; mimeType?: string }> };

    expect(res.isError).toBeFalsy();
    const summary = JSON.parse(res.content[0]!.text!);
    expect(summary.variations).toBe(2);
    expect(summary.outputs[0].seed).toBe(42);
    expect(summary.outputs[0].url).toBe("https://generated.example.adobe.io/img-42.png");
    // Inline image content blocks should be appended.
    const imageBlocks = res.content.filter((c) => c.type === "image");
    expect(imageBlocks).toHaveLength(2);
    expect(imageBlocks[0]!.mimeType).toBe("image/png");

    // Request shape assertions.
    expect(captured.request!.method).toBe("POST");
    expect(captured.request!.headers.get("content-type")).toBe("application/json");
    expect(captured.request!.headers.get("authorization")).toBe(`Bearer ${FAKE_IMS_TOKEN}`);
    const body = captured.body as {
      prompt: string;
      numVariations: number;
      size: { width: number; height: number };
      contentClass: string;
    };
    expect(body.prompt).toBe("a serene mountain lake at sunrise");
    expect(body.numVariations).toBe(2);
    expect(body.size).toEqual({ width: 1024, height: 1024 });
    expect(body.contentClass).toBe("photo");
  });

  it("propagates a 400 from /v3/images/generate as a structured tool error", async () => {
    server.use(
      http.post(`${FIREFLY_API_BASE}/v3/images/generate`, () => {
        return new HttpResponse(
          JSON.stringify({ error_code: "prompt_blocked", message: "prompt rejected" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }),
    );

    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    const { client } = buildFireflyClient();
    registerGenerateImage(mcp, client);

    const res = (await callTool(mcp, "firefly_generate_image", {
      prompt: "anything",
      return_inline_image: false,
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };

    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    // ApiError messages include the SDK's "Bad Request" mapping.
    expect(parsed.message).toMatch(/Bad Request|400/);
  });
});

describe("firefly_generate_similar (integration)", () => {
  it("POSTs source image + numVariations to /v3/images/generate-similar", async () => {
    installImageFetchHandler("https://similar.example.adobe.io");
    const captured: { request?: Request; body?: unknown } = {};
    server.use(
      http.post(
        `${FIREFLY_API_BASE}/v3/images/generate-similar`,
        captureAndRespond(captured, {
          size: { width: 1024, height: 1024 },
          outputs: [
            { seed: 7, image: { url: "https://similar.example.adobe.io/v1.png" } },
          ],
        }),
      ),
    );

    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    const { client } = buildFireflyClient();
    registerGenerateSimilar(mcp, client);

    const res = (await callTool(mcp, "firefly_generate_similar", {
      image: { uploadId: "src-upload-1" },
      num_variations: 1,
      size: "square_1024",
      return_inline_image: false,
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };
    expect(res.isError).toBeFalsy();

    const body = captured.body as {
      numVariations: number;
      size: { width: number; height: number };
      image: { source: { uploadId: string } };
    };
    expect(body.numVariations).toBe(1);
    expect(body.size.width).toBe(1024);
    expect(body.image.source.uploadId).toBe("src-upload-1");
  });

  it("surfaces a 500 from /v3/images/generate-similar as a structured tool error", async () => {
    server.use(
      http.post(`${FIREFLY_API_BASE}/v3/images/generate-similar`, () => {
        return new HttpResponse("internal", {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        });
      }),
    );

    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    const { client } = buildFireflyClient();
    registerGenerateSimilar(mcp, client);

    const res = (await callTool(mcp, "firefly_generate_similar", {
      image: { uploadId: "src-upload-1" },
      return_inline_image: false,
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.message).toMatch(/Internal Server Error|500/);
  });
});

describe("firefly_expand_image (integration)", () => {
  it("POSTs image source + size to /v3/images/expand", async () => {
    const captured: { request?: Request; body?: unknown } = {};
    server.use(
      http.post(
        `${FIREFLY_API_BASE}/v3/images/expand`,
        captureAndRespond(captured, {
          size: { width: 2048, height: 1024 },
          outputs: [
            { seed: 1, image: { url: "https://expand.example.adobe.io/r.png" } },
          ],
        }),
      ),
    );

    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    const { client } = buildFireflyClient();
    registerExpandImage(mcp, client);

    const res = (await callTool(mcp, "firefly_expand_image", {
      image: { uploadId: "src-1" },
      width: 2048,
      height: 1024,
      placement_horizontal: "left",
      return_inline_image: false,
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };
    expect(res.isError).toBeFalsy();

    const body = captured.body as {
      numVariations: number;
      image: { source: { uploadId: string } };
      size: { width: number; height: number };
      placement: { alignment: { horizontal: string } };
    };
    expect(body.image.source.uploadId).toBe("src-1");
    expect(body.size).toEqual({ width: 2048, height: 1024 });
    expect(body.placement.alignment.horizontal).toBe("left");
  });
});

describe("firefly_fill_image (integration)", () => {
  it("POSTs source + mask + prompt to /v3/images/fill", async () => {
    const captured: { request?: Request; body?: unknown } = {};
    server.use(
      http.post(
        `${FIREFLY_API_BASE}/v3/images/fill`,
        captureAndRespond(captured, {
          size: { width: 1024, height: 1024 },
          outputs: [
            { seed: 9, image: { url: "https://fill.example.adobe.io/r.png" } },
          ],
        }),
      ),
    );

    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    const { client } = buildFireflyClient();
    registerFillImage(mcp, client);

    const res = (await callTool(mcp, "firefly_fill_image", {
      image: { uploadId: "src-fill" },
      mask: { uploadId: "msk-fill" },
      prompt: "a red apple",
      return_inline_image: false,
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };
    expect(res.isError).toBeFalsy();

    const body = captured.body as {
      prompt: string;
      image: { source: { uploadId: string }; mask: { uploadId: string } };
    };
    expect(body.prompt).toBe("a red apple");
    expect(body.image.source.uploadId).toBe("src-fill");
    expect(body.image.mask.uploadId).toBe("msk-fill");
  });
});

describe("firefly_generate_object_composite (integration)", () => {
  it("POSTs object image + scene prompt to /v3/images/generate-object-composite", async () => {
    const captured: { request?: Request; body?: unknown } = {};
    server.use(
      http.post(
        `${FIREFLY_API_BASE}/v3/images/generate-object-composite`,
        captureAndRespond(captured, {
          size: { width: 1024, height: 1024 },
          contentClass: "photo",
          outputs: [
            { seed: 5, image: { url: "https://compose.example.adobe.io/r.png" } },
          ],
        }),
      ),
    );

    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    const { client } = buildFireflyClient();
    registerGenerateObjectComposite(mcp, client);

    const res = (await callTool(mcp, "firefly_generate_object_composite", {
      image: { uploadId: "obj-1" },
      prompt: "on a marble table next to a coffee cup",
      content_class: "photo",
      return_inline_image: false,
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };
    expect(res.isError).toBeFalsy();

    const body = captured.body as {
      prompt: string;
      image: { source: { uploadId: string } };
      contentClass: string;
    };
    expect(body.prompt).toBe("on a marble table next to a coffee cup");
    expect(body.image.source.uploadId).toBe("obj-1");
    expect(body.contentClass).toBe("photo");
  });
});

describe("firefly_generate_video (integration)", () => {
  it("POSTs prompt + xModelVersion header to /v3/videos/generate and returns jobId/statusUrl", async () => {
    const captured: { request?: Request; body?: unknown } = {};
    server.use(
      http.post(
        `${FIREFLY_API_BASE}/v3/videos/generate`,
        captureAndRespond(captured, {
          jobId: "vid-job-42",
          statusUrl: "https://firefly-api.adobe.io/v3/videos/jobs/vid-job-42",
          cancelUrl: "https://firefly-api.adobe.io/v3/videos/jobs/vid-job-42/cancel",
        }),
      ),
    );

    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    const { client } = buildFireflyClient();
    registerGenerateVideo(mcp, client);

    const res = (await callTool(mcp, "firefly_generate_video", {
      prompt: "a campfire flickering at night",
      size: "landscape_1920x1080",
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.jobId).toBe("vid-job-42");
    expect(parsed.statusUrl).toContain("vid-job-42");

    const body = captured.body as {
      prompt: string;
      sizes: Array<{ width: number; height: number }>;
    };
    expect(body.prompt).toBe("a campfire flickering at night");
    expect(body.sizes[0]).toEqual({ width: 1920, height: 1080 });
  });
});
