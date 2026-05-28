import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MaskFormatType } from "@adobe/photoshop-apis";
import { registerRemoveBackground } from "../../../src/tools/photoshop/remove-background.js";
import type { PhotoshopClient } from "@adobe/photoshop-apis";
import { callTool } from "../../util/call-tool.js";

function makeServerAndClient(impl?: (req: unknown) => Promise<unknown>) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const client = {
    removeBackground: vi.fn(
      impl ??
        (async () => ({
          result: {
            jobId: "job-bg1",
            status: "succeeded",
            output: { _links: { self: { href: "https://out.example/result.png" } } },
            _links: { self: { href: "https://status.example/jobs/job-bg1" } },
          },
        })),
    ),
  } as unknown as PhotoshopClient;
  return { server, client };
}

describe("photoshop_remove_background", () => {
  it("registers the tool", () => {
    const { server, client } = makeServerAndClient();
    registerRemoveBackground(server, client);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    expect(Object.keys(tools)).toContain("photoshop_remove_background");
  });

  it("passes single input/output (not arrays) to the Sensei endpoint", async () => {
    const { server, client } = makeServerAndClient();
    registerRemoveBackground(server, client);
    const res = (await callTool(server, "photoshop_remove_background", {
      input_url: "https://in.example/photo.jpg",
      output_url: "https://out.example/cutout.png",
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.ok).toBe(true);
    expect(parsed.status).toBe("succeeded");

    const call = (client.removeBackground as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      input: { href: string; storage: string };
      output: { href: string; storage: string; mask?: { format?: string } };
    };
    expect(call.input.href).toBe("https://in.example/photo.jpg");
    expect(call.output.href).toBe("https://out.example/cutout.png");
    expect(call.output.mask).toBeUndefined();
  });

  it("includes mask.format when mask_format is provided", async () => {
    const { server, client } = makeServerAndClient();
    registerRemoveBackground(server, client);
    await callTool(server, "photoshop_remove_background", {
      input_url: "https://in.example/photo.jpg",
      output_url: "https://out.example/cutout.png",
      mask_format: "soft",
    });
    const call = (client.removeBackground as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
      output: { mask?: { format?: string } };
    };
    expect(call.output.mask?.format).toBe(MaskFormatType.SOFT);
  });

  it("maps SDK errors", async () => {
    const { server, client } = makeServerAndClient(async () => {
      throw new Error("subject not detected");
    });
    registerRemoveBackground(server, client);
    const res = (await callTool(server, "photoshop_remove_background", {
      input_url: "https://in.example/empty.jpg",
      output_url: "https://out.example/cutout.png",
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.message).toContain("subject not detected");
  });
});
