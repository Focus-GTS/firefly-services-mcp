import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerApplyEdits } from "../../../src/tools/lightroom/apply-edits.js";
import type { LightroomClient } from "@adobe/lightroom-apis";

type RegisteredTools = Record<
  string,
  { handler: (a: unknown, extra: unknown) => Promise<unknown> }
>;

function makeServerAndClient(applyEditsImpl?: LightroomClient["applyEdits"]) {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const client = {
    applyEdits:
      applyEditsImpl ??
      vi.fn(async () => ({
        result: {
          jobId: "lr-edits-1",
          _links: { self: { href: "https://lr.example.com/jobs/lr-edits-1" } },
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

describe("lightroom_apply_edits", () => {
  it("registers the tool", () => {
    const { server, client } = makeServerAndClient();
    registerApplyEdits(server, client);
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    expect(Object.keys(tools)).toContain("lightroom_apply_edits");
  });

  it("maps snake_case adjustments to PascalCase EditOptions and submits the job", async () => {
    const applyEdits = vi.fn(async () => ({
      result: { jobId: "edits-7", _links: { self: { href: "https://lr.example.com/jobs/edits-7" } } },
    }));
    const { server, client } = makeServerAndClient(applyEdits as unknown as LightroomClient["applyEdits"]);
    registerApplyEdits(server, client);

    const res = (await callTool(server, "lightroom_apply_edits", {
      input_url: INPUT_URL,
      output_url: OUTPUT_URL,
      exposure: 0.75,
      highlights: -40,
      shadows: 30,
      whites: 10,
      blacks: -10,
      vibrance: 15,
      saturation: 5,
      clarity: 12,
      white_balance: "cloudy",
    })) as { content: Array<{ text: string }> };

    expect(applyEdits).toHaveBeenCalledTimes(1);
    const reqBody = applyEdits.mock.calls[0]![0] as {
      inputs: { source: { href: string; storage: string } };
      options: Record<string, unknown>;
      outputs: Array<{ href: string; type: string }>;
    };
    expect(reqBody.inputs.source.href).toBe(INPUT_URL);
    expect(reqBody.inputs.source.storage).toBe("external");
    expect(reqBody.options.Exposure).toBe(0.75);
    expect(reqBody.options.Highlights).toBe(-40);
    expect(reqBody.options.Shadows).toBe(30);
    expect(reqBody.options.Whites).toBe(10);
    expect(reqBody.options.Blacks).toBe(-10);
    expect(reqBody.options.Vibrance).toBe(15);
    expect(reqBody.options.Saturation).toBe(5);
    expect(reqBody.options.Clarity).toBe(12);
    expect(reqBody.options.WhiteBalance).toBe("Cloudy");
    expect(reqBody.outputs[0]!.href).toBe(OUTPUT_URL);
    expect(reqBody.outputs[0]!.type).toBe("image/jpeg");

    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.ok).toBe(true);
    expect(parsed.jobId).toBe("edits-7");
    expect(parsed.appliedAdjustments).toEqual(
      expect.arrayContaining([
        "Exposure",
        "Highlights",
        "Shadows",
        "Whites",
        "Blacks",
        "Vibrance",
        "Saturation",
        "Clarity",
        "WhiteBalance",
      ]),
    );
  });

  it("returns NO_EDITS when no adjustments are provided", async () => {
    const { server, client } = makeServerAndClient();
    registerApplyEdits(server, client);

    const res = (await callTool(server, "lightroom_apply_edits", {
      input_url: INPUT_URL,
      output_url: OUTPUT_URL,
    })) as { isError?: boolean; content: Array<{ text: string }> };

    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.code).toBe("NO_EDITS");
  });

  it("omits fields that were not provided (no zero-defaulting)", async () => {
    const applyEdits = vi.fn(async () => ({
      result: { jobId: "edits-min", _links: { self: { href: "https://x" } } },
    }));
    const { server, client } = makeServerAndClient(applyEdits as unknown as LightroomClient["applyEdits"]);
    registerApplyEdits(server, client);

    await callTool(server, "lightroom_apply_edits", {
      input_url: INPUT_URL,
      output_url: OUTPUT_URL,
      exposure: 1.5,
    });

    const reqBody = applyEdits.mock.calls[0]![0] as { options: Record<string, unknown> };
    expect(Object.keys(reqBody.options)).toEqual(["Exposure"]);
    expect(reqBody.options.Exposure).toBe(1.5);
  });

  it("propagates SDK errors as structured tool errors", async () => {
    const applyEdits = vi.fn(async () => {
      throw new Error("Lightroom 422: out of range");
    });
    const { server, client } = makeServerAndClient(applyEdits as unknown as LightroomClient["applyEdits"]);
    registerApplyEdits(server, client);

    const res = (await callTool(server, "lightroom_apply_edits", {
      input_url: INPUT_URL,
      output_url: OUTPUT_URL,
      exposure: 1,
    })) as { isError?: boolean; content: Array<{ text: string }> };

    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.message).toContain("Lightroom 422: out of range");
  });
});
