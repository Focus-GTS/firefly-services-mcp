#!/usr/bin/env node
/**
 * Firefly Services MCP Server — entry point.
 *
 * Boots an MCP server over stdio, wires up the token cache, and registers
 * every tool from the registry.
 *
 * Per ADR-002, stdio is the v0.1 transport. Per ADR-003, single-credential
 * loaded from environment variables at startup.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadCredentials, MissingCredentialsError } from "./auth/credentials.js";
import { TokenCache } from "./auth/token-cache.js";
import { getFireflyClient } from "./auth/firefly-client.js";
import { getPhotoshopClient } from "./auth/photoshop-client.js";
import { getLightroomClient } from "./auth/lightroom-client.js";
import { registerAllTools } from "./tools/index.js";
import { logger } from "./util/logger.js";

const SERVER_NAME = "firefly-services-mcp";
const SERVER_VERSION = "0.1.0";

async function main(): Promise<void> {
  logger.info({ version: SERVER_VERSION }, "starting Firefly Services MCP server");

  // Step 1 — credentials. Fail fast and helpfully if they're missing.
  let creds;
  try {
    creds = loadCredentials();
  } catch (err) {
    if (err instanceof MissingCredentialsError) {
      // Write the helpful message to stderr; do not log via pino so users see
      // the formatted multi-line message in their terminal cleanly.
      process.stderr.write(`\n[firefly-services-mcp] ${err.message}\n\n`);
      process.exit(1);
    }
    throw err;
  }

  // Step 2 — token cache + SDK clients. All lazy — no token is fetched and
  // no Adobe traffic is generated until a tool is actually called.
  const tokenCache = new TokenCache(creds);
  const fireflyClient = getFireflyClient(creds, tokenCache);
  const photoshopClient = getPhotoshopClient(creds, tokenCache);
  const lightroomClient = getLightroomClient(creds, tokenCache);

  // Step 3 — MCP server + tools.
  const server = new McpServer(
    {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
    {
      // Capabilities the server provides. Tools are the v0.1 focus.
      capabilities: {
        tools: {},
      },
    },
  );

  registerAllTools(server, { tokenCache, fireflyClient, photoshopClient, lightroomClient });

  // Step 4 — connect transport.
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info(
    { name: SERVER_NAME, version: SERVER_VERSION, transport: "stdio" },
    "MCP server ready",
  );
}

main().catch((err) => {
  logger.fatal({ err: { message: (err as Error).message, stack: (err as Error).stack } }, "fatal startup error");
  process.exit(1);
});
