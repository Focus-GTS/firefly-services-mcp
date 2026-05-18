import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerUploadImage } from "../../../src/tools/firefly/upload-image.js";
import type { FireflyClient } from "@adobe/firefly-apis";

async function callTool(server: McpServer, name: string, args: Record<string, unknown>) {
  const tool = (server as unknown as {
    _registeredTools: Record<string, { handler: (a: unknown, extra: unknown) => Promise<unknown> }>;
  })._registeredTools[name];
  if (!tool) throw new Error(`Tool ${name} not registered`);
  return tool.handler(args, {});
}

function makeClient(uploadResult: unknown = { result: { images: [{ id: "upload-abc-123" }] } }) {
  return {
    upload: vi.fn(async () => uploadResult),
  } as unknown as FireflyClient;
}

let tmpFiles: string[] = [];

async function makeTempFile(ext: string, bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47])): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-upload-test-"));
  const file = path.join(dir, `tiny${ext}`);
  await fs.writeFile(file, bytes);
  tmpFiles.push(dir);
  return file;
}

afterEach(async () => {
  for (const dir of tmpFiles) {
    await fs.rm(dir, { recursive: true, force: true });
  }
  tmpFiles = [];
});

describe("firefly_upload_image", () => {
  it("registers the tool", () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerUploadImage(server, makeClient());
    const tools = (server as unknown as { _registeredTools: Record<string, unknown> })._registeredTools;
    expect(Object.keys(tools)).toContain("firefly_upload_image");
  });

  it("uploads a png and returns the uploadId", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const client = makeClient();
    registerUploadImage(server, client);
    const file = await makeTempFile(".png");
    const res = (await callTool(server, "firefly_upload_image", { path: file })) as {
      content: Array<{ type: string; text: string }>;
    };
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.ok).toBe(true);
    expect(parsed.uploadId).toBe("upload-abc-123");
    expect(parsed.mime).toBe("image/png");
    expect(client.upload).toHaveBeenCalledTimes(1);
  });

  it("rejects unsupported extensions", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    registerUploadImage(server, makeClient());
    const file = await makeTempFile(".gif");
    const res = (await callTool(server, "firefly_upload_image", { path: file })) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.code).toBe("UNSUPPORTED_FORMAT");
  });

  it("returns an error if the SDK response has no image id", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const client = makeClient({ result: { images: [] } });
    registerUploadImage(server, client);
    const file = await makeTempFile(".jpg");
    const res = (await callTool(server, "firefly_upload_image", { path: file })) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.code).toBe("UPLOAD_NO_ID");
  });

  it("maps SDK errors to structured tool errors", async () => {
    const server = new McpServer({ name: "test", version: "0.0.0" });
    const client = {
      upload: vi.fn(async () => {
        throw new Error("network down");
      }),
    } as unknown as FireflyClient;
    registerUploadImage(server, client);
    const file = await makeTempFile(".webp");
    const res = (await callTool(server, "firefly_upload_image", { path: file })) as {
      isError?: boolean;
      content: Array<{ type: string; text: string }>;
    };
    expect(res.isError).toBe(true);
    const parsed = JSON.parse(res.content[0]!.text);
    expect(parsed.message).toContain("network down");
  });
});
