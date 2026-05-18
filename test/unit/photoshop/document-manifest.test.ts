import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerDocumentManifest } from "../../../src/tools/photoshop/document-manifest.js";
import type { PhotoshopClient } from "@adobe/photoshop-apis";

function makeServerAndClient(impl?: (req: unknown) => Promise<unknown>) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const client = {
    getDocumentManifest: vi.fn(
      impl ??
        (async () => ({
          result: {
            jobId: "job-m1",
            outputs: [
              {
                status: "succeeded",
                document: { width: 1024, height: 768, name: "Template.psd" },
                layers: [{ id: 1, name: "Background", type: "layer" }],
              },
            ],
            _links: { self: { href: "https://status.example/jobs/job-m1" } },
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

describe("photoshop_document_manifest", () => {
  it("registers the tool", () => {
    const { server, client } = makeServerAndClient();
    registerDocumentManifest(server, client);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    expect(Object.keys(tools)).toContain("photoshop_document_manifest");
  });

  it("returns the document and layer tree on success", async () => {
    const { server, client } = makeServerAndClient();
    registerDocumentManifest(server, client);
    const res = (await callTool(server, "photoshop_document_manifest", {
      input_url: "https://in.example/template.psd",
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.ok).toBe(true);
    expect(parsed.document).toEqual({ width: 1024, height: 768, name: "Template.psd" });
    expect(parsed.layers).toHaveLength(1);
    expect(parsed.layers[0].name).toBe("Background");
  });

  it("omits options block when include_thumbnails is false", async () => {
    const { server, client } = makeServerAndClient();
    registerDocumentManifest(server, client);
    await callTool(server, "photoshop_document_manifest", {
      input_url: "https://in.example/template.psd",
      include_thumbnails: false,
    });
    const call = (client.getDocumentManifest as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      options?: unknown;
    };
    expect(call.options).toBeUndefined();
  });

  it("includes options.thumbnails when include_thumbnails is true", async () => {
    const { server, client } = makeServerAndClient();
    registerDocumentManifest(server, client);
    await callTool(server, "photoshop_document_manifest", {
      input_url: "https://in.example/template.psd",
      include_thumbnails: true,
    });
    const call = (client.getDocumentManifest as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      options?: { thumbnails?: { type?: string } };
    };
    expect(call.options?.thumbnails?.type).toBe("image/png");
  });

  it("maps SDK errors to structured tool errors", async () => {
    const { server, client } = makeServerAndClient(async () => {
      throw new Error("PSD download failed");
    });
    registerDocumentManifest(server, client);
    const res = (await callTool(server, "photoshop_document_manifest", {
      input_url: "https://in.example/missing.psd",
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.message).toContain("PSD download failed");
  });
});
