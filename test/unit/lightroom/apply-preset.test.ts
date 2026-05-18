import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerApplyPreset } from "../../../src/tools/lightroom/apply-preset.js";
import type { LightroomClient } from "@adobe/lightroom-apis";

type RegisteredTools = Record<
  string,
  { handler: (a: unknown, extra: unknown) => Promise<unknown> }
>;

function makeServerAndClient(applyPresetImpl?: LightroomClient["applyPreset"]) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const client = {
    applyPreset:
      applyPresetImpl ??
      vi.fn(async () => ({
        result: {
          jobId: "lr-job-123",
          created: "2026-05-18T00:00:00.000000Z",
          modified: "2026-05-18T00:00:00.000000Z",
          _links: { self: { href: "https://lr.example.com/jobs/lr-job-123" } },
          outputs: [],
        },
      })),
  } as unknown as LightroomClient;
  return { server, client };
}

async function callTool(server: McpServer, name: string, args: Record<string, unknown>) {
  const tool = (server as unknown as { _registeredTools: RegisteredTools })._registeredTools[name];
  if (!tool) throw new Error(`Tool ${name} not registered`);
  return tool.handler(args, {});
}

const INPUT_URL = "https://example.s3.amazonaws.com/in.jpg?sig=abc";
const PRESET_URL = "https://example.s3.amazonaws.com/preset.xmp?sig=abc";
const OUTPUT_URL = "https://example.s3.amazonaws.com/out.jpg?sig=def";

describe("lightroom_apply_preset", () => {
  it("registers the tool", () => {
    const { server, client } = makeServerAndClient();
    registerApplyPreset(server, client);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    expect(Object.keys(tools)).toContain("lightroom_apply_preset");
  });

  it("submits an apply-preset job with a single preset_url and returns the jobId + statusUrl", async () => {
    const applyPreset = vi.fn(async () => ({
      result: {
        jobId: "lr-job-xyz",
        created: "2026-05-18T01:00:00.000000Z",
        modified: "2026-05-18T01:00:01.000000Z",
        _links: { self: { href: "https://lr.example.com/jobs/lr-job-xyz" } },
        outputs: [],
      },
    }));
    const { server, client } = makeServerAndClient(applyPreset as unknown as LightroomClient["applyPreset"]);
    registerApplyPreset(server, client);

    const res = (await callTool(server, "lightroom_apply_preset", {
      input_url: INPUT_URL,
      preset_url: PRESET_URL,
      output_url: OUTPUT_URL,
      output_format: "image/jpeg",
      output_quality: 9,
    })) as { content: Array<{ type: string; text: string }> };

    expect(applyPreset).toHaveBeenCalledTimes(1);
    const reqBody = applyPreset.mock.calls[0]![0] as {
      inputs: { source: { href: string; storage: string }; presets: Array<{ href: string; storage: string }> };
      outputs: Array<{ href: string; storage: string; type: string; quality?: number }>;
    };
    expect(reqBody.inputs.source.href).toBe(INPUT_URL);
    expect(reqBody.inputs.source.storage).toBe("external");
    expect(reqBody.inputs.presets).toHaveLength(1);
    expect(reqBody.inputs.presets[0]!.href).toBe(PRESET_URL);
    expect(reqBody.outputs[0]!.href).toBe(OUTPUT_URL);
    expect(reqBody.outputs[0]!.type).toBe("image/jpeg");
    expect(reqBody.outputs[0]!.quality).toBe(9);

    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.ok).toBe(true);
    expect(parsed.jobId).toBe("lr-job-xyz");
    expect(parsed.statusUrl).toBe("https://lr.example.com/jobs/lr-job-xyz");
  });

  it("supports multiple presets via preset_urls", async () => {
    const applyPreset = vi.fn(async () => ({
      result: { jobId: "lr-job-m", _links: { self: { href: "https://x" } } },
    }));
    const { server, client } = makeServerAndClient(applyPreset as unknown as LightroomClient["applyPreset"]);
    registerApplyPreset(server, client);

    await callTool(server, "lightroom_apply_preset", {
      input_url: INPUT_URL,
      preset_urls: [PRESET_URL, "https://example.s3.amazonaws.com/preset2.xmp"],
      output_url: OUTPUT_URL,
    });

    const reqBody = applyPreset.mock.calls[0]![0] as {
      inputs: { presets: Array<{ href: string }> };
    };
    expect(reqBody.inputs.presets).toHaveLength(2);
    expect(reqBody.inputs.presets[1]!.href).toBe("https://example.s3.amazonaws.com/preset2.xmp");
  });

  it("returns MISSING_PRESET when no presets are provided", async () => {
    const { server, client } = makeServerAndClient();
    registerApplyPreset(server, client);

    const res = (await callTool(server, "lightroom_apply_preset", {
      input_url: INPUT_URL,
      output_url: OUTPUT_URL,
    })) as { isError?: boolean; content: Array<{ text: string }> };

    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.code).toBe("MISSING_PRESET");
  });

  it("propagates SDK errors as structured tool errors", async () => {
    const applyPreset = vi.fn(async () => {
      throw new Error("Lightroom 400: bad preset");
    });
    const { server, client } = makeServerAndClient(applyPreset as unknown as LightroomClient["applyPreset"]);
    registerApplyPreset(server, client);

    const res = (await callTool(server, "lightroom_apply_preset", {
      input_url: INPUT_URL,
      preset_url: PRESET_URL,
      output_url: OUTPUT_URL,
    })) as { isError?: boolean; content: Array<{ text: string }> };

    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.message).toContain("Lightroom 400: bad preset");
  });
});
