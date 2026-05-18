import { describe, it, expect, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerGenerateVideo } from "../../../src/tools/firefly/generate-video.js";
import type { FireflyClient } from "@adobe/firefly-apis";

async function callTool(server: McpServer, name: string, args: Record<string, unknown>) {
  const tool = (server as unknown as {
    _registeredTools: Record<string, { handler: (a: unknown, extra: unknown) => Promise<unknown> }>;
  })._registeredTools[name];
  if (!tool) throw new Error(`Tool ${name} not registered`);
  return tool.handler(args, {});
}

function makeClient(
  result: unknown = {
    result: {
      jobId: "job-xyz-1",
      statusUrl: "https://firefly.adobe/jobs/job-xyz-1/status",
      cancelUrl: "https://firefly.adobe/jobs/job-xyz-1/cancel",
    },
  },
) {
  return {
    generateVideoV3: vi.fn(async () => result),
    upload: vi.fn(async () => ({ result: { images: [{ id: "auto-upload-id" }] } })),
  } as unknown as FireflyClient;
}

describe("firefly_generate_video", () => {
  it("registers the tool", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerGenerateVideo(server, makeClient());
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    expect(Object.keys(tools)).toContain("firefly_generate_video");
  });

  it("returns jobId, statusUrl and cancelUrl without polling", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const client = makeClient();
    registerGenerateVideo(server, client);
    const res = (await callTool(server, "firefly_generate_video", {
      prompt: "drone shot over mountains",
    })) as { content: Array<{ type: string; text: string }> };
    expect(client.generateVideoV3).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.ok).toBe(true);
    expect(parsed.async).toBe(true);
    expect(parsed.jobId).toBe("job-xyz-1");
    expect(parsed.statusUrl).toContain("/status");
    expect(parsed.cancelUrl).toContain("/cancel");
  });

  it("maps video size preset and keyframe images onto the SDK body", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const client = makeClient();
    registerGenerateVideo(server, client);
    await callTool(server, "firefly_generate_video", {
      prompt: "moving train",
      size: "portrait_1080x1920",
      seed: 42,
      bit_rate_factor: 20,
      first_frame_image: { uploadId: "first-frame" },
      last_frame_image: { uploadId: "last-frame" },
      camera_motion: "camera pan left",
      shot_angle: "low angle shot",
      shot_size: "long shot",
      prompt_style: "cinematic",
    });
    const callArgs = (client.generateVideoV3 as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const body = callArgs[0];
    const params = callArgs[1];
    expect(body.prompt).toBe("moving train");
    expect(body.sizes).toEqual([{ width: 1080, height: 1920 }]);
    expect(body.seeds).toEqual([42]);
    expect(body.bitRateFactor).toBe(20);
    expect(body.image.conditions).toHaveLength(2);
    expect(body.image.conditions[0]).toEqual({
      placement: { position: 0 },
      source: { uploadId: "first-frame" },
    });
    expect(body.image.conditions[1]).toEqual({
      placement: { position: 1 },
      source: { uploadId: "last-frame" },
    });
    expect(body.videoSettings.cameraMotion).toBe("camera pan left");
    expect(body.videoSettings.shotAngle).toBe("low angle shot");
    expect(body.videoSettings.shotSize).toBe("long shot");
    expect(body.videoSettings.promptStyle).toBe("cinematic");
    expect(params).toEqual({ xModelVersion: "video1_standard" });
  });

  it("returns a structured error on SDK failure", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const client = {
      generateVideoV3: vi.fn(async () => {
        throw new Error("video API down");
      }),
    } as unknown as FireflyClient;
    registerGenerateVideo(server, client);
    const res = (await callTool(server, "firefly_generate_video", {
      prompt: "x",
    })) as { isError?: boolean; content: Array<{ type: string; text: string }> };
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.message).toContain("video API down");
  });
});
