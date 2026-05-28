import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StorageType } from "@adobe/photoshop-apis";
import { registerApplyActions } from "../../../src/tools/photoshop/apply-actions.js";
import type { PhotoshopClient } from "@adobe/photoshop-apis";
import { callTool } from "../../util/call-tool.js";

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

  // Regression test for the audit's "tests bypass zod" finding: when storage
  // is omitted, the inputSchema's .default("external") must apply, and the
  // mapper must translate that to StorageType.EXTERNAL — not silently pass
  // `undefined` to the SDK as the old switch (no default arm) used to.
  it("applies the 'external' storage default when storage fields are omitted", async () => {
    const { server, client } = makeServerAndClient();
    registerApplyActions(server, client);
    await callTool(server, "photoshop_apply_actions", {
      input_url: "https://in.example/source.jpg",
      action_url: "https://in.example/brand.atn",
      output_url: "https://out.example/processed.jpg",
    });
    const body = (client.playPhotoshopActions as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      inputs: Array<{ storage: string }>;
      outputs: Array<{ storage: string }>;
      options: { actions: Array<{ storage: string }> };
    };
    expect(body.inputs[0]!.storage).toBe(StorageType.EXTERNAL);
    expect(body.outputs[0]!.storage).toBe(StorageType.EXTERNAL);
    expect(body.options.actions[0]!.storage).toBe(StorageType.EXTERNAL);
  });
});
