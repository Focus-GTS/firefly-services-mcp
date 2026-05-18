import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerApplyActions } from "../../../src/tools/photoshop/apply-actions.js";
import type { PhotoshopClient } from "@adobe/photoshop-apis";

function makeServerAndClient(impl?: (req: unknown) => Promise<unknown>) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const client = {
    playPhotoshopActions: vi.fn(
      impl ??
        (async () => ({
          result: {
            jobId: "job-a1",
            outputs: [{ status: "succeeded" }],
            _links: { self: { href: "https://status.example/jobs/job-a1" } },
          },
        })),
    ),
  } as unknown as PhotoshopClient;
  return { server, client };
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

describe("photoshop_apply_actions", () => {
  it("registers the tool", () => {
    const { server, client } = makeServerAndClient();
    registerApplyActions(server, client);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    expect(Object.keys(tools)).toContain("photoshop_apply_actions");
  });

  it("passes input, .atn action file, and output through correctly", async () => {
    const { server, client } = makeServerAndClient();
    registerApplyActions(server, client);
    await callTool(server, "photoshop_apply_actions", {
      input_url: "https://in.example/source.jpg",
      action_url: "https://in.example/brand.atn",
      action_name: "BrandLook",
      output_url: "https://out.example/processed.jpg",
      output_format: "image/jpeg",
    });
    const call = (client.playPhotoshopActions as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      inputs: Array<{ href: string }>;
      outputs: Array<{ href: string; type: string }>;
      options: { actions: Array<{ href?: string; actionName?: string }> };
    };
    expect(call.inputs[0]!.href).toBe("https://in.example/source.jpg");
    expect(call.outputs[0]!.type).toBe("image/jpeg");
    expect(call.options.actions[0]!.href).toBe("https://in.example/brand.atn");
    expect(call.options.actions[0]!.actionName).toBe("BrandLook");
  });

  it("omits actionName when not provided (plays full action set)", async () => {
    const { server, client } = makeServerAndClient();
    registerApplyActions(server, client);
    await callTool(server, "photoshop_apply_actions", {
      input_url: "https://in.example/source.jpg",
      action_url: "https://in.example/brand.atn",
      output_url: "https://out.example/processed.jpg",
    });
    const call = (client.playPhotoshopActions as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      options: { actions: Array<{ actionName?: string }> };
    };
    expect(call.options.actions[0]!.actionName).toBeUndefined();
  });

  it("maps SDK errors", async () => {
    const { server, client } = makeServerAndClient(async () => {
      throw new Error("action file invalid");
    });
    registerApplyActions(server, client);
    const res = (await callTool(server, "photoshop_apply_actions", {
      input_url: "https://in.example/source.jpg",
      action_url: "https://in.example/broken.atn",
      output_url: "https://out.example/processed.jpg",
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.message).toContain("action file invalid");
  });
});
