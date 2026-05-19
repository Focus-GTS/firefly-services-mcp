/**
 * HTTP-layer mocked integration tests for the Lightroom tools.
 *
 * The Lightroom API uses the same async-job pattern as the Photoshop PSD
 * service:
 *
 *   1. POST /lrService/{operation}  -> { _links: { self: { href: status-url } } }
 *   2. SDK polls GET /lrService/status/{jobId} every 2s until terminal
 *
 * The status response uses `outputs[].status` from the JobStatus enum
 * (pending / running / succeeded / failed). To finish quickly we serve a
 * SUCCEEDED status on the first poll.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { LightroomClient } from "@adobe/lightroom-apis";
import type { ClientConfig, TokenProvider } from "@adobe/firefly-services-sdk-core";

import { TokenCache } from "../../src/auth/token-cache.js";
import { registerApplyPreset } from "../../src/tools/lightroom/apply-preset.js";
import { registerAutoTone } from "../../src/tools/lightroom/auto-tone.js";
import { registerAutoStraighten } from "../../src/tools/lightroom/auto-straighten.js";
import { registerApplyEdits } from "../../src/tools/lightroom/apply-edits.js";

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

function buildLightroomClient(): LightroomClient {
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
  return new LightroomClient(config);
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
 * Install MSW handlers for a Lightroom async endpoint.
 *
 * Returns a captured object the test can read after invocation to assert
 * on the HTTP request shape the SDK produced.
 */
function installLrAsyncHandlers(
  path: string,
  jobId: string,
  statusResponse: Record<string, unknown>,
): { captured: { request?: Request; body?: unknown } } {
  const captured: { request?: Request; body?: unknown } = {};
  const statusUrl = `${IMAGE_API_BASE}/lrService/status/${jobId}`;

  server.use(
    http.post(`${IMAGE_API_BASE}${path}`, async ({ request }) => {
      captured.request = request.clone();
      captured.body = await request.clone().json();
      return HttpResponse.json({ _links: { self: { href: statusUrl } } });
    }),
    http.get(`${IMAGE_API_BASE}/lrService/status/${jobId}`, () => {
      return HttpResponse.json(statusResponse);
    }),
  );

  return { captured };
}

const INPUT_URL = "https://in.example.s3.amazonaws.com/photo.jpg?sig=abc";
const OUTPUT_URL = "https://out.example.s3.amazonaws.com/result.jpg?sig=def";

describe("lightroom_apply_preset (integration)", () => {
  it("POSTs source + preset(s) to /lrService/presets and parses the polled status", async () => {
    const PRESET_URL_1 = "https://presets.example/cool-1.xmp?sig=p1";
    const PRESET_URL_2 = "https://presets.example/cool-2.xmp?sig=p2";
    const { captured } = installLrAsyncHandlers(
      "/lrService/presets",
      "lr-pre-1",
      {
        jobId: "lr-pre-1",
        created: "2026-05-19T13:00:00.000Z",
        modified: "2026-05-19T13:00:02.000Z",
        outputs: [{ input: INPUT_URL, status: "succeeded", _links: {} }],
        _links: { self: { href: `${IMAGE_API_BASE}/lrService/status/lr-pre-1` } },
      },
    );

    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    registerApplyPreset(mcp, buildLightroomClient());

    const res = (await callTool(mcp, "lightroom_apply_preset", {
      input_url: INPUT_URL,
      preset_urls: [PRESET_URL_1, PRESET_URL_2],
      output_url: OUTPUT_URL,
      output_format: "image/jpeg",
      output_quality: 10,
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.jobId).toBe("lr-pre-1");
    expect(parsed.created).toBe("2026-05-19T13:00:00.000Z");

    expect(captured.request!.method).toBe("POST");
    expect(captured.request!.headers.get("authorization")).toBe(`Bearer ${FAKE_IMS_TOKEN}`);
    expect(captured.request!.headers.get("x-api-key")).toBe("msw-fake-client-id");
    expect(captured.request!.headers.get("content-type")).toBe("application/json");
    const body = captured.body as {
      inputs: {
        source: { href: string; storage: string };
        presets: Array<{ href: string; storage: string }>;
      };
      outputs: Array<{ href: string; type: string; quality?: number }>;
    };
    expect(body.inputs.source.href).toBe(INPUT_URL);
    expect(body.inputs.source.storage).toBe("external");
    expect(body.inputs.presets).toHaveLength(2);
    expect(body.inputs.presets[0]!.href).toBe(PRESET_URL_1);
    expect(body.inputs.presets[1]!.href).toBe(PRESET_URL_2);
    expect(body.outputs[0]!.type).toBe("image/jpeg");
    expect(body.outputs[0]!.quality).toBe(10);
  }, 8_000);

  it("returns MISSING_PRESET when neither preset_url nor preset_urls is supplied", async () => {
    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    registerApplyPreset(mcp, buildLightroomClient());
    const res = (await callTool(mcp, "lightroom_apply_preset", {
      input_url: INPUT_URL,
      output_url: OUTPUT_URL,
      output_format: "image/jpeg",
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.code).toBe("MISSING_PRESET");
  });
});

describe("lightroom_auto_tone (integration)", () => {
  it("POSTs source + output spec to /lrService/autoTone and reports the job id", async () => {
    const { captured } = installLrAsyncHandlers(
      "/lrService/autoTone",
      "lr-tone-1",
      {
        jobId: "lr-tone-1",
        created: "2026-05-19T13:01:00.000Z",
        modified: "2026-05-19T13:01:02.000Z",
        outputs: [{ input: INPUT_URL, status: "succeeded", _links: {} }],
        _links: { self: { href: `${IMAGE_API_BASE}/lrService/status/lr-tone-1` } },
      },
    );

    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    registerAutoTone(mcp, buildLightroomClient());

    const res = (await callTool(mcp, "lightroom_auto_tone", {
      input_url: INPUT_URL,
      output_url: OUTPUT_URL,
      output_format: "image/png",
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.jobId).toBe("lr-tone-1");

    const body = captured.body as {
      inputs: { href: string; storage: string };
      outputs: Array<{ href: string; storage: string; type: string }>;
    };
    expect(body.inputs.href).toBe(INPUT_URL);
    expect(body.inputs.storage).toBe("external");
    expect(body.outputs[0]!.href).toBe(OUTPUT_URL);
    expect(body.outputs[0]!.type).toBe("image/png");
  }, 8_000);
});

describe("lightroom_auto_straighten (integration)", () => {
  it("POSTs to /lrService/autoStraighten with the upright mode in the options block", async () => {
    const { captured } = installLrAsyncHandlers(
      "/lrService/autoStraighten",
      "lr-str-1",
      {
        jobId: "lr-str-1",
        outputs: [{ input: INPUT_URL, status: "succeeded", _links: {} }],
        _links: { self: { href: `${IMAGE_API_BASE}/lrService/status/lr-str-1` } },
      },
    );

    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    registerAutoStraighten(mcp, buildLightroomClient());

    const res = (await callTool(mcp, "lightroom_auto_straighten", {
      input_url: INPUT_URL,
      output_url: OUTPUT_URL,
      output_format: "image/jpeg",
      upright_mode: "full",
      constrain_crop: true,
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };

    expect(res.isError).toBeFalsy();
    const body = captured.body as {
      inputs: { href: string };
      options?: { uprightMode?: string; constrainCrop?: boolean };
    };
    expect(body.inputs.href).toBe(INPUT_URL);
    expect(body.options?.uprightMode).toBe("full");
    expect(body.options?.constrainCrop).toBe(true);
  }, 8_000);
});

describe("lightroom_apply_edits (integration)", () => {
  it("POSTs to /lrService/edit with the adjustment options block", async () => {
    const { captured } = installLrAsyncHandlers(
      "/lrService/edit",
      "lr-edit-1",
      {
        jobId: "lr-edit-1",
        outputs: [{ input: INPUT_URL, status: "succeeded", _links: {} }],
        _links: { self: { href: `${IMAGE_API_BASE}/lrService/status/lr-edit-1` } },
      },
    );

    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    registerApplyEdits(mcp, buildLightroomClient());

    const res = (await callTool(mcp, "lightroom_apply_edits", {
      input_url: INPUT_URL,
      output_url: OUTPUT_URL,
      output_format: "image/jpeg",
      exposure: 0.5,
      contrast: 25,
      vibrance: 15,
      white_balance: "cloudy",
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.appliedAdjustments).toEqual(
      expect.arrayContaining(["Exposure", "Contrast", "Vibrance", "WhiteBalance"]),
    );

    const body = captured.body as {
      inputs: { source: { href: string } };
      options: {
        Exposure?: number;
        Contrast?: number;
        Vibrance?: number;
        WhiteBalance?: string;
      };
    };
    expect(body.inputs.source.href).toBe(INPUT_URL);
    expect(body.options.Exposure).toBe(0.5);
    expect(body.options.Contrast).toBe(25);
    expect(body.options.Vibrance).toBe(15);
    expect(body.options.WhiteBalance).toBe("Cloudy");
  }, 8_000);

  it("returns NO_EDITS if no adjustments are provided", async () => {
    const mcp = new McpServer({ name: "test", version: "0.0.0" });
    registerApplyEdits(mcp, buildLightroomClient());
    const res = (await callTool(mcp, "lightroom_apply_edits", {
      input_url: INPUT_URL,
      output_url: OUTPUT_URL,
      output_format: "image/jpeg",
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.code).toBe("NO_EDITS");
  });
});
