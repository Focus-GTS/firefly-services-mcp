import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerApplyEdits } from "../../../src/tools/photoshop/apply-edits.js";
import type { PhotoshopClient } from "@adobe/photoshop-apis";

function makeServerAndClient(impl?: (req: unknown) => Promise<unknown>) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const client = {
    modifyDocument: vi.fn(
      impl ??
        (async () => ({
          result: {
            jobId: "job-e1",
            outputs: [{ status: "succeeded" }],
            _links: { self: { href: "https://status.example/jobs/job-e1" } },
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

describe("photoshop_apply_edits", () => {
  it("registers the tool", () => {
    const { server, client } = makeServerAndClient();
    registerApplyEdits(server, client);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    expect(Object.keys(tools)).toContain("photoshop_apply_edits");
  });

  it("returns NO_EDITS if neither edits nor raw_layers is provided", async () => {
    const { server, client } = makeServerAndClient();
    registerApplyEdits(server, client);
    const res = (await callTool(server, "photoshop_apply_edits", {
      input_url: "https://in.example/template.psd",
      output_url: "https://out.example/x.jpg",
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.code).toBe("NO_EDITS");
  });

  it("maps simple visibility/lock/rename edits", async () => {
    const { server, client } = makeServerAndClient();
    registerApplyEdits(server, client);
    const res = (await callTool(server, "photoshop_apply_edits", {
      input_url: "https://in.example/template.psd",
      edits: [
        { layer_name: "Watermark", visible: false },
        { layer_id: 7, locked: true, rename_to: "BackgroundLocked" },
      ],
      output_url: "https://out.example/x.jpg",
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.editsApplied).toBe(2);

    const call = (client.modifyDocument as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      options: {
        layers: Array<{
          id?: number;
          name?: string;
          visible?: boolean;
          locked?: boolean;
        }>;
      };
    };
    expect(call.options.layers[0]!.name).toBe("Watermark");
    expect(call.options.layers[0]!.visible).toBe(false);
    expect(call.options.layers[1]!.id).toBe(7);
    expect(call.options.layers[1]!.locked).toBe(true);
    // rename_to becomes 'name'
    expect(call.options.layers[1]!.name).toBe("BackgroundLocked");
  });

  it("passes raw_layers through verbatim", async () => {
    const { server, client } = makeServerAndClient();
    registerApplyEdits(server, client);
    await callTool(server, "photoshop_apply_edits", {
      input_url: "https://in.example/template.psd",
      raw_layers: [{ add: { insertAbove: { id: 3 } }, adjustments: { brightnessContrast: { brightness: 20 } } }],
      output_url: "https://out.example/x.jpg",
    });
    const call = (client.modifyDocument as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      options: { layers: Array<Record<string, unknown>> };
    };
    expect(call.options.layers).toHaveLength(1);
    expect(call.options.layers[0]!.adjustments).toBeDefined();
  });

  it("maps SDK errors", async () => {
    const { server, client } = makeServerAndClient(async () => {
      throw new Error("invalid layer reference");
    });
    registerApplyEdits(server, client);
    const res = (await callTool(server, "photoshop_apply_edits", {
      input_url: "https://in.example/template.psd",
      edits: [{ layer_name: "Foo", visible: false }],
      output_url: "https://out.example/x.jpg",
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.message).toContain("invalid layer reference");
  });
});
