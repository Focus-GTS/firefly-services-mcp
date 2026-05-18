import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSmartObjectReplace } from "../../../src/tools/photoshop/smart-object-replace.js";
import type { PhotoshopClient } from "@adobe/photoshop-apis";

function makeServerAndClient(replaceImpl?: (req: unknown) => Promise<unknown>) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const client = {
    replaceSmartObject: vi.fn(
      replaceImpl ??
        (async () => ({
          result: {
            jobId: "job-1",
            outputs: [{ status: "succeeded" }],
            _links: { self: { href: "https://status.example/jobs/job-1" } },
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

describe("photoshop_smart_object_replace", () => {
  it("registers the tool", () => {
    const { server, client } = makeServerAndClient();
    registerSmartObjectReplace(server, client);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    expect(Object.keys(tools)).toContain("photoshop_smart_object_replace");
  });

  it("calls replaceSmartObject with mapped storage refs and returns ok=true", async () => {
    const { server, client } = makeServerAndClient();
    registerSmartObjectReplace(server, client);
    const res = (await callTool(server, "photoshop_smart_object_replace", {
      input_url: "https://in.example/template.psd",
      input_storage: "external",
      replacement_url: "https://in.example/new.jpg",
      replacement_storage: "external",
      layer_name: "Hero",
      output_url: "https://out.example/result.jpg",
      output_storage: "external",
      output_format: "image/jpeg",
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.ok).toBe(true);
    expect(parsed.jobId).toBe("job-1");
    expect(parsed.statusUrl).toBe("https://status.example/jobs/job-1");

    const call = (client.replaceSmartObject as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      inputs: Array<{ href: string; storage: string }>;
      outputs: Array<{ href: string; storage: string; type: string }>;
      options: { layers: Array<{ name?: string; input: { href: string; storage: string } }> };
    };
    expect(call.inputs[0]!.href).toBe("https://in.example/template.psd");
    expect(call.inputs[0]!.storage).toBe("external");
    expect(call.outputs[0]!.type).toBe("image/jpeg");
    expect(call.options.layers[0]!.name).toBe("Hero");
    expect(call.options.layers[0]!.input.href).toBe("https://in.example/new.jpg");
  });

  it("returns MISSING_LAYER_REF if neither layer_name nor layer_id is provided", async () => {
    const { server, client } = makeServerAndClient();
    registerSmartObjectReplace(server, client);
    const res = (await callTool(server, "photoshop_smart_object_replace", {
      input_url: "https://in.example/template.psd",
      replacement_url: "https://in.example/new.jpg",
      output_url: "https://out.example/result.jpg",
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.code).toBe("MISSING_LAYER_REF");
  });

  it("maps SDK errors to structured tool errors", async () => {
    const { server, client } = makeServerAndClient(async () => {
      throw new Error("Photoshop API rejected the request");
    });
    registerSmartObjectReplace(server, client);
    const res = (await callTool(server, "photoshop_smart_object_replace", {
      input_url: "https://in.example/template.psd",
      replacement_url: "https://in.example/new.jpg",
      layer_id: 5,
      output_url: "https://out.example/result.jpg",
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.message).toContain("Photoshop API rejected");
  });
});
