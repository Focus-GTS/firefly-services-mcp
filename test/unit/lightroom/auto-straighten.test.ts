import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAutoStraighten } from "../../../src/tools/lightroom/auto-straighten.js";
import type { LightroomClient } from "@adobe/lightroom-apis";

type RegisteredTools = Record<
  string,
  { handler: (a: unknown, extra: unknown) => Promise<unknown> }
>;

function makeServerAndClient(autoStraightenImpl?: LightroomClient["autoStraightenImage"]) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const client = {
    autoStraightenImage:
      autoStraightenImpl ??
      vi.fn(async () => ({
        result: {
          jobId: "lr-straight-1",
          _links: { self: { href: "https://lr.example.com/jobs/lr-straight-1" } },
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

describe("lightroom_auto_straighten", () => {
  it("registers the tool", () => {
    const { server, client } = makeServerAndClient();
    registerAutoStraighten(server, client);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    expect(Object.keys(tools)).toContain("lightroom_auto_straighten");
  });

  it("submits an auto-straighten job WITHOUT options when upright_mode is omitted", async () => {
    const autoStraighten = vi.fn(async () => ({
      result: { jobId: "ls-1", _links: { self: { href: "https://x" } } },
    }));
    const { server, client } = makeServerAndClient(
      autoStraighten as unknown as LightroomClient["autoStraightenImage"],
    );
    registerAutoStraighten(server, client);

    const res = (await callTool(server, "lightroom_auto_straighten", {
      input_url: INPUT_URL,
      output_url: OUTPUT_URL,
    })) as { content: Array<{ text: string }> };

    expect(autoStraighten).toHaveBeenCalledTimes(1);
    const reqBody = autoStraighten.mock.calls[0]![0] as {
      inputs: { href: string; storage: string };
      outputs: Array<{ href: string; type: string }>;
      options?: unknown;
    };
    expect(reqBody.inputs.href).toBe(INPUT_URL);
    expect(reqBody.outputs[0]!.href).toBe(OUTPUT_URL);
    expect(reqBody.options).toBeUndefined();

    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.ok).toBe(true);
    expect(parsed.jobId).toBe("ls-1");
  });

  it("passes upright_mode and constrain_crop through to options when provided", async () => {
    const autoStraighten = vi.fn(async () => ({
      result: { jobId: "ls-opts", _links: { self: { href: "https://x" } } },
    }));
    const { server, client } = makeServerAndClient(
      autoStraighten as unknown as LightroomClient["autoStraightenImage"],
    );
    registerAutoStraighten(server, client);

    await callTool(server, "lightroom_auto_straighten", {
      input_url: INPUT_URL,
      output_url: OUTPUT_URL,
      upright_mode: "level",
      constrain_crop: true,
    });

    const reqBody = autoStraighten.mock.calls[0]![0] as {
      options?: { uprightMode: string; constrainCrop?: boolean };
    };
    expect(reqBody.options).toBeDefined();
    expect(reqBody.options!.uprightMode).toBe("level");
    expect(reqBody.options!.constrainCrop).toBe(true);
  });

  it("propagates SDK errors as structured tool errors", async () => {
    const autoStraighten = vi.fn(async () => {
      throw new Error("Lightroom 403: forbidden");
    });
    const { server, client } = makeServerAndClient(
      autoStraighten as unknown as LightroomClient["autoStraightenImage"],
    );
    registerAutoStraighten(server, client);

    const res = (await callTool(server, "lightroom_auto_straighten", {
      input_url: INPUT_URL,
      output_url: OUTPUT_URL,
    })) as { isError?: boolean; content: Array<{ text: string }> };

    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.message).toContain("Lightroom 403: forbidden");
  });
});
