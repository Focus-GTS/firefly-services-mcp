/**
 * HTTP-layer mocked integration tests for the Photoshop tools.
 *
 * The Photoshop API is asynchronous at the protocol level:
 *
 *   1. POST /pie/psdService/{operation}  -> { _links: { self: { href: status-url } } }
 *   2. SDK polls GET /pie/psdService/status/{jobId} every 2s until terminal
 *
 * For Sensei-backed endpoints (remove-background) the response uses a single
 * `status` field instead of `outputs[].status`. The SDK polls
 * GET /sensei/status/{jobId} with the same 2s cadence.
 *
 * These tests pre-stage the status endpoint to return SUCCEEDED on the first
 * poll, so each happy-path test takes ~2.1s (one mandatory sleep cycle).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { PhotoshopClient } from "@adobe/photoshop-apis";
import type { ClientConfig, TokenProvider } from "@adobe/firefly-services-sdk-core";

import { TokenCache } from "../../src/auth/token-cache.js";
import { registerSmartObjectReplace } from "../../src/tools/photoshop/smart-object-replace.js";
import { registerDocumentManifest } from "../../src/tools/photoshop/document-manifest.js";
import { registerApplyActions } from "../../src/tools/photoshop/apply-actions.js";
import { registerEditText } from "../../src/tools/photoshop/edit-text.js";
import { registerApplyEdits } from "../../src/tools/photoshop/apply-edits.js";
import { registerRemoveBackground } from "../../src/tools/photoshop/remove-background.js";

import {
  server,
  installMswLifecycle,
  http,
  HttpResponse,
  fakeCredentials,
  IMAGE_API_BASE,
  FAKE_IMS_TOKEN,
} from "./setup.js";

installMswLifecycle({ beforeAll, afterEach, afterAll });

function buildPhotoshopClient(): PhotoshopClient {
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
  return new PhotoshopClient(config);
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

/**
 * Install MSW handlers for a Photoshop PSD-service async endpoint.
 *
 * `path` is the POST URL (e.g. `/pie/psdService/smartObject`). The handler
 * captures the request, returns a job-link response, then serves a
 * SUCCEEDED status response on the next GET /pie/psdService/status/{jobId}.
 *
 * Returns a `captured` object the test can inspect for HTTP request shape.
 */
function installPsdAsyncHandlers(
  path: string,
  jobId: string,
  statusResponse: Record<string, unknown>,
): { captured: { request?: Request; body?: unknown } } {
  const captured: { request?: Request; body?: unknown } = {};
  const statusUrl = `${IMAGE_API_BASE}/pie/psdService/status/${jobId}`;

  server.use(
    http.post(`${IMAGE_API_BASE}${path}`, async ({ request }) => {
      captured.request = request.clone();
      captured.body = await request.clone().json();
      return HttpResponse.json({
        _links: { self: { href: statusUrl } },
      });
    }),
    http.get(`${IMAGE_API_BASE}/pie/psdService/status/${jobId}`, () => {
      return HttpResponse.json(statusResponse);
    }),
  );

  return { captured };
}

function installSenseiAsyncHandlers(
  path: string,
  jobId: string,
  statusResponse: Record<string, unknown>,
): { captured: { request?: Request; body?: unknown } } {
  const captured: { request?: Request; body?: unknown } = {};
  const statusUrl = `${IMAGE_API_BASE}/sensei/status/${jobId}`;

  server.use(
    http.post(`${IMAGE_API_BASE}${path}`, async ({ request }) => {
      captured.request = request.clone();
      captured.body = await request.clone().json();
      return HttpResponse.json({
        _links: { self: { href: statusUrl } },
      });
    }),
    http.get(`${IMAGE_API_BASE}/sensei/status/${jobId}`, () => {
      return HttpResponse.json(statusResponse);
    }),
  );

  return { captured };
}

const INPUT_URL = "https://in.example.s3.amazonaws.com/design.psd?sig=abc";
const OUTPUT_URL = "https://out.example.s3.amazonaws.com/result.png?sig=def";

describe("photoshop_smart_object_replace (integration)", () => {
  it("POSTs to /pie/psdService/smartObject and parses the polled status response", async () => {
    const { captured } = installPsdAsyncHandlers(
      "/pie/psdService/smartObject",
      "ps-so-1",
      {
        jobId: "ps-so-1",
        outputs: [
          {
            input: INPUT_URL,
            status: "succeeded",
            _links: { renditions: [{ href: OUTPUT_URL }] },
          },
        ],
        _links: { self: { href: `${IMAGE_API_BASE}/pie/psdService/status/ps-so-1` } },
      },
    );

    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    registerSmartObjectReplace(mcp, buildPhotoshopClient());

    // We explicitly pass *_storage and *_format — direct
    // _registeredTools[name].handler(args, {}) invocation bypasses the
    // McpServer's zod parsing, so .default() values aren't applied for us.
    const res = (await callTool(mcp, "photoshop_smart_object_replace", {
      input_url: INPUT_URL,
      input_storage: "external",
      replacement_url: "https://in.example/new-product.png?sig=xyz",
      replacement_storage: "external",
      output_url: OUTPUT_URL,
      output_storage: "external",
      layer_name: "ProductShot",
      output_format: "image/png",
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.jobId).toBe("ps-so-1");
    expect(parsed.outputs).toHaveLength(1);

    // Verify HTTP-layer request shape.
    expect(captured.request!.method).toBe("POST");
    expect(captured.request!.headers.get("authorization")).toBe(`Bearer ${FAKE_IMS_TOKEN}`);
    expect(captured.request!.headers.get("x-api-key")).toBe("msw-fake-client-id");
    expect(captured.request!.headers.get("content-type")).toBe("application/json");
    const body = captured.body as {
      inputs: Array<{ href: string; storage: string }>;
      outputs: Array<{ href: string; type: string }>;
      options: { layers: Array<{ name: string; input: { href: string } }> };
    };
    expect(body.inputs[0]!.href).toBe(INPUT_URL);
    expect(body.inputs[0]!.storage).toBe("external");
    expect(body.outputs[0]!.href).toBe(OUTPUT_URL);
    expect(body.outputs[0]!.type).toBe("image/png");
    expect(body.options.layers[0]!.name).toBe("ProductShot");
    expect(body.options.layers[0]!.input.href).toBe("https://in.example/new-product.png?sig=xyz");
  }, 8_000);

  it("surfaces a status-poll-reported failure as a structured tool error", async () => {
    // We model failure via the status-poll path (200 on the POST, then a
    // status response with outputs[].status === 'failed') rather than a
    // 400 on the initial POST. Reason: the SDK's PsAsyncJob attaches its
    // .catch on _jobLinkPromise only after a 2s sleep tick; a synchronous
    // POST rejection therefore fires Node's unhandledRejection in the
    // intervening window even though the tool ultimately handles it.
    // Polling-path failure exercises the same MCP error surface without
    // tripping that SDK quirk.
    server.use(
      http.post(`${IMAGE_API_BASE}/pie/psdService/smartObject`, () => {
        return HttpResponse.json({
          _links: { self: { href: `${IMAGE_API_BASE}/pie/psdService/status/ps-so-fail` } },
        });
      }),
      http.get(`${IMAGE_API_BASE}/pie/psdService/status/ps-so-fail`, () => {
        return HttpResponse.json({
          jobId: "ps-so-fail",
          outputs: [
            {
              input: INPUT_URL,
              status: "failed",
              _links: {},
            },
          ],
          _links: { self: { href: `${IMAGE_API_BASE}/pie/psdService/status/ps-so-fail` } },
        });
      }),
    );
    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    registerSmartObjectReplace(mcp, buildPhotoshopClient());

    const res = (await callTool(mcp, "photoshop_smart_object_replace", {
      input_url: INPUT_URL,
      input_storage: "external",
      replacement_url: "https://in.example/new-product.png",
      replacement_storage: "external",
      output_url: OUTPUT_URL,
      output_storage: "external",
      layer_name: "ProductShot",
      output_format: "image/jpeg",
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.message).toMatch(/Job failed|failed/i);
  }, 8_000);
});

describe("photoshop_document_manifest (integration)", () => {
  it("POSTs to /pie/psdService/documentManifest and parses layers/document", async () => {
    const { captured } = installPsdAsyncHandlers(
      "/pie/psdService/documentManifest",
      "ps-mf-1",
      {
        jobId: "ps-mf-1",
        outputs: [
          {
            input: INPUT_URL,
            status: "succeeded",
            document: { width: 1080, height: 1920, bitDepth: 8 },
            layers: [
              { id: 2, name: "Headline", type: "textLayer" },
              { id: 3, name: "Logo", type: "smartObjectLayer" },
            ],
          },
        ],
        _links: { self: { href: `${IMAGE_API_BASE}/pie/psdService/status/ps-mf-1` } },
      },
    );

    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    registerDocumentManifest(mcp, buildPhotoshopClient());

    const res = (await callTool(mcp, "photoshop_document_manifest", {
      input_url: INPUT_URL,
      input_storage: "external",
      include_thumbnails: false,
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.jobId).toBe("ps-mf-1");
    expect(parsed.layers).toHaveLength(2);
    expect(parsed.document.width).toBe(1080);

    const body = captured.body as { inputs: Array<{ href: string }> };
    expect(body.inputs[0]!.href).toBe(INPUT_URL);
  }, 8_000);
});

describe("photoshop_apply_actions (integration)", () => {
  it("POSTs to /pie/psdService/photoshopActions with the action set reference", async () => {
    const ACTION_URL = "https://in.example/actions.atn?sig=at";
    const { captured } = installPsdAsyncHandlers(
      "/pie/psdService/photoshopActions",
      "ps-act-1",
      {
        jobId: "ps-act-1",
        outputs: [
          {
            input: INPUT_URL,
            status: "succeeded",
            _links: { renditions: [{ href: OUTPUT_URL }] },
          },
        ],
        _links: { self: { href: `${IMAGE_API_BASE}/pie/psdService/status/ps-act-1` } },
      },
    );

    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    registerApplyActions(mcp, buildPhotoshopClient());

    const res = (await callTool(mcp, "photoshop_apply_actions", {
      input_url: INPUT_URL,
      input_storage: "external",
      action_url: ACTION_URL,
      action_storage: "external",
      action_name: "BrandFilter",
      output_url: OUTPUT_URL,
      output_storage: "external",
      output_format: "image/jpeg",
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };

    expect(res.isError).toBeFalsy();
    const body = captured.body as {
      options: { actions: Array<{ href: string; actionName?: string }> };
    };
    expect(body.options.actions[0]!.href).toBe(ACTION_URL);
    expect(body.options.actions[0]!.actionName).toBe("BrandFilter");
  }, 8_000);
});

describe("photoshop_edit_text (integration)", () => {
  it("POSTs to /pie/psdService/text with the new text content per layer", async () => {
    const { captured } = installPsdAsyncHandlers(
      "/pie/psdService/text",
      "ps-txt-1",
      {
        jobId: "ps-txt-1",
        outputs: [
          {
            input: INPUT_URL,
            status: "succeeded",
            _links: { renditions: [{ href: OUTPUT_URL }] },
          },
        ],
        _links: { self: { href: `${IMAGE_API_BASE}/pie/psdService/status/ps-txt-1` } },
      },
    );

    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    registerEditText(mcp, buildPhotoshopClient());

    const res = (await callTool(mcp, "photoshop_edit_text", {
      input_url: INPUT_URL,
      input_storage: "external",
      output_url: OUTPUT_URL,
      output_storage: "external",
      output_format: "image/jpeg",
      edits: [
        { layer_name: "Headline", content: "Bonjour le monde" },
        { layer_id: 7, content: "$19.99" },
      ],
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.editsApplied).toBe(2);

    const body = captured.body as {
      options: { layers: Array<{ name?: string; id?: number; text: { content: string } }> };
    };
    expect(body.options.layers).toHaveLength(2);
    expect(body.options.layers[0]!.name).toBe("Headline");
    expect(body.options.layers[0]!.text.content).toBe("Bonjour le monde");
    expect(body.options.layers[1]!.id).toBe(7);
    expect(body.options.layers[1]!.text.content).toBe("$19.99");
  }, 8_000);
});

describe("photoshop_apply_edits (integration)", () => {
  it("POSTs to /pie/psdService/documentOperations with the merged layer edits", async () => {
    const { captured } = installPsdAsyncHandlers(
      "/pie/psdService/documentOperations",
      "ps-ops-1",
      {
        jobId: "ps-ops-1",
        outputs: [
          {
            input: INPUT_URL,
            status: "succeeded",
            _links: { renditions: [{ href: OUTPUT_URL }] },
          },
        ],
        _links: { self: { href: `${IMAGE_API_BASE}/pie/psdService/status/ps-ops-1` } },
      },
    );

    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    registerApplyEdits(mcp, buildPhotoshopClient());

    const res = (await callTool(mcp, "photoshop_apply_edits", {
      input_url: INPUT_URL,
      input_storage: "external",
      output_url: OUTPUT_URL,
      output_storage: "external",
      output_format: "image/jpeg",
      edits: [
        { layer_name: "BackgroundFX", visible: false },
        { layer_id: 99, locked: true },
      ],
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.editsApplied).toBe(2);

    const body = captured.body as {
      options: { layers: Array<{ name?: string; id?: number; visible?: boolean; locked?: boolean }> };
    };
    expect(body.options.layers[0]!.name).toBe("BackgroundFX");
    expect(body.options.layers[0]!.visible).toBe(false);
    expect(body.options.layers[1]!.id).toBe(99);
    expect(body.options.layers[1]!.locked).toBe(true);
  }, 8_000);
});

describe("photoshop_remove_background (integration: Sensei)", () => {
  it("POSTs to /sensei/cutout and polls /sensei/status/{jobId} until succeeded", async () => {
    const { captured } = installSenseiAsyncHandlers(
      "/sensei/cutout",
      "sensei-bg-1",
      {
        jobId: "sensei-bg-1",
        status: "succeeded",
        output: { _links: { self: { href: OUTPUT_URL } } },
        _links: { self: { href: `${IMAGE_API_BASE}/sensei/status/sensei-bg-1` } },
      },
    );

    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    registerRemoveBackground(mcp, buildPhotoshopClient());

    const res = (await callTool(mcp, "photoshop_remove_background", {
      input_url: INPUT_URL,
      input_storage: "external",
      output_url: OUTPUT_URL,
      output_storage: "external",
      mask_format: "soft",
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.jobId).toBe("sensei-bg-1");
    expect(parsed.status).toBe("succeeded");

    const body = captured.body as {
      input: { href: string; storage: string };
      output: { href: string; storage: string; mask: { format: string } };
    };
    expect(body.input.href).toBe(INPUT_URL);
    expect(body.output.href).toBe(OUTPUT_URL);
    expect(body.output.mask.format).toBe("soft");
  }, 8_000);

  it("surfaces a Sensei job that polls back as failed as an SDK error", async () => {
    server.use(
      http.post(`${IMAGE_API_BASE}/sensei/cutout`, () => {
        return HttpResponse.json({
          _links: { self: { href: `${IMAGE_API_BASE}/sensei/status/sensei-bg-2` } },
        });
      }),
      http.get(`${IMAGE_API_BASE}/sensei/status/sensei-bg-2`, () => {
        return HttpResponse.json({
          jobId: "sensei-bg-2",
          status: "failed",
          errors: { type: "InputValidationError", description: "subject not detected" },
          _links: { self: { href: `${IMAGE_API_BASE}/sensei/status/sensei-bg-2` } },
        });
      }),
    );

    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    registerRemoveBackground(mcp, buildPhotoshopClient());

    const res = (await callTool(mcp, "photoshop_remove_background", {
      input_url: INPUT_URL,
      input_storage: "external",
      output_url: OUTPUT_URL,
      output_storage: "external",
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };

    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.message).toMatch(/Job failed|InputValidationError|subject not detected/);
  }, 8_000);
});
