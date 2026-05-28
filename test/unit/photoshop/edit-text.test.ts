import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerEditText } from "../../../src/tools/photoshop/edit-text.js";
import type { PhotoshopClient } from "@adobe/photoshop-apis";
import { callTool } from "../../util/call-tool.js";

function makeServerAndClient(impl?: (req: unknown) => Promise<unknown>) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const client = {
    editTextLayer: vi.fn(
      impl ??
        (async () => ({
          result: {
            jobId: "job-t1",
            outputs: [{ status: "succeeded" }],
            _links: { self: { href: "https://status.example/jobs/job-t1" } },
          },
        })),
    ),
  } as unknown as PhotoshopClient;
  return { server, client };
}

describe("photoshop_edit_text", () => {
  it("registers the tool", () => {
    const { server, client } = makeServerAndClient();
    registerEditText(server, client);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    expect(Object.keys(tools)).toContain("photoshop_edit_text");
  });

  it("maps multiple text edits onto SDK layer options", async () => {
    const { server, client } = makeServerAndClient();
    registerEditText(server, client);
    const res = (await callTool(server, "photoshop_edit_text", {
      input_url: "https://in.example/template.psd",
      edits: [
        { layer_name: "Headline", content: "Bonjour" },
        { layer_id: 42, content: "$19.99" },
      ],
      output_url: "https://out.example/localized.jpg",
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.editsApplied).toBe(2);

    const call = (client.editTextLayer as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      options: {
        layers: Array<{
          name?: string;
          id?: number;
          text?: { content?: string };
        }>;
      };
    };
    expect(call.options.layers).toHaveLength(2);
    expect(call.options.layers[0]!.name).toBe("Headline");
    expect(call.options.layers[0]!.text?.content).toBe("Bonjour");
    expect(call.options.layers[1]!.id).toBe(42);
    expect(call.options.layers[1]!.text?.content).toBe("$19.99");
  });

  it("returns MISSING_LAYER_REF if an edit has neither name nor id", async () => {
    const { server, client } = makeServerAndClient();
    registerEditText(server, client);
    const res = (await callTool(server, "photoshop_edit_text", {
      input_url: "https://in.example/template.psd",
      edits: [{ content: "no layer ref here" }],
      output_url: "https://out.example/x.jpg",
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.code).toBe("MISSING_LAYER_REF");
  });

  it("maps SDK errors", async () => {
    const { server, client } = makeServerAndClient(async () => {
      throw new Error("font missing");
    });
    registerEditText(server, client);
    const res = (await callTool(server, "photoshop_edit_text", {
      input_url: "https://in.example/template.psd",
      edits: [{ layer_name: "Title", content: "Hi" }],
      output_url: "https://out.example/x.jpg",
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.message).toContain("font missing");
  });
});
