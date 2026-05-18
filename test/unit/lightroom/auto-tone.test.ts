import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAutoTone } from "../../../src/tools/lightroom/auto-tone.js";
import type { LightroomClient } from "@adobe/lightroom-apis";

type RegisteredTools = Record<
  string,
  { handler: (a: unknown, extra: unknown) => Promise<unknown> }
>;

function makeServerAndClient(applyAutoToneImpl?: LightroomClient["applyAutoTone"]) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const client = {
    applyAutoTone:
      applyAutoToneImpl ??
      vi.fn(async () => ({
        result: {
          jobId: "lr-auto-1",
          created: "2026-05-18T00:00:00.000000Z",
          modified: "2026-05-18T00:00:00.000000Z",
          _links: { self: { href: "https://lr.example.com/jobs/lr-auto-1" } },
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
const OUTPUT_URL = "https://example.s3.amazonaws.com/out.jpg?sig=def";

describe("lightroom_auto_tone", () => {
  it("registers the tool", () => {
    const { server, client } = makeServerAndClient();
    registerAutoTone(server, client);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    expect(Object.keys(tools)).toContain("lightroom_auto_tone");
  });

  it("submits an auto-tone job and returns the jobId + statusUrl", async () => {
    const applyAutoTone = vi.fn(async () => ({
      result: {
        jobId: "lr-tone-7",
        _links: { self: { href: "https://lr.example.com/jobs/lr-tone-7" } },
      },
    }));
    const { server, client } = makeServerAndClient(applyAutoTone as unknown as LightroomClient["applyAutoTone"]);
    registerAutoTone(server, client);

    const res = (await callTool(server, "lightroom_auto_tone", {
      input_url: INPUT_URL,
      output_url: OUTPUT_URL,
      output_format: "image/png",
    })) as { content: Array<{ type: string; text: string }> };

    expect(applyAutoTone).toHaveBeenCalledTimes(1);
    const reqBody = applyAutoTone.mock.calls[0]![0] as {
      inputs: { href: string; storage: string };
      outputs: Array<{ href: string; storage: string; type: string; quality?: number }>;
    };
    expect(reqBody.inputs.href).toBe(INPUT_URL);
    expect(reqBody.inputs.storage).toBe("external");
    expect(reqBody.outputs[0]!.href).toBe(OUTPUT_URL);
    expect(reqBody.outputs[0]!.type).toBe("image/png");
    expect(reqBody.outputs[0]!.quality).toBeUndefined();

    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.ok).toBe(true);
    expect(parsed.jobId).toBe("lr-tone-7");
    expect(parsed.statusUrl).toBe("https://lr.example.com/jobs/lr-tone-7");
  });

  it("defaults output_format to image/jpeg", async () => {
    const applyAutoTone = vi.fn(async () => ({
      result: { jobId: "lr-default", _links: { self: { href: "https://x" } } },
    }));
    const { server, client } = makeServerAndClient(applyAutoTone as unknown as LightroomClient["applyAutoTone"]);
    registerAutoTone(server, client);

    await callTool(server, "lightroom_auto_tone", {
      input_url: INPUT_URL,
      output_url: OUTPUT_URL,
    });

    const reqBody = applyAutoTone.mock.calls[0]![0] as { outputs: Array<{ type: string }> };
    expect(reqBody.outputs[0]!.type).toBe("image/jpeg");
  });

  it("passes JPEG quality through when provided", async () => {
    const applyAutoTone = vi.fn(async () => ({
      result: { jobId: "q", _links: { self: { href: "https://x" } } },
    }));
    const { server, client } = makeServerAndClient(applyAutoTone as unknown as LightroomClient["applyAutoTone"]);
    registerAutoTone(server, client);

    await callTool(server, "lightroom_auto_tone", {
      input_url: INPUT_URL,
      output_url: OUTPUT_URL,
      output_quality: 12,
    });

    const reqBody = applyAutoTone.mock.calls[0]![0] as {
      outputs: Array<{ type: string; quality?: number }>;
    };
    expect(reqBody.outputs[0]!.quality).toBe(12);
  });

  it("propagates SDK errors as structured tool errors", async () => {
    const applyAutoTone = vi.fn(async () => {
      throw new Error("Lightroom 500");
    });
    const { server, client } = makeServerAndClient(applyAutoTone as unknown as LightroomClient["applyAutoTone"]);
    registerAutoTone(server, client);

    const res = (await callTool(server, "lightroom_auto_tone", {
      input_url: INPUT_URL,
      output_url: OUTPUT_URL,
    })) as { isError?: boolean; content: Array<{ text: string }> };

    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.message).toContain("Lightroom 500");
  });
});
