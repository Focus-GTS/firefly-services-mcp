/**
 * Test helper — invoke a registered MCP tool through its zod inputSchema.
 *
 * Why this exists: the original test pattern was
 *
 *   server._registeredTools[name].handler(args, {})
 *
 * which bypasses zod entirely. That means `.default("external")` values
 * never apply in tests — the handler receives whatever the test wrote
 * verbatim. Production code is fine (the real MCP transport calls
 * validateToolInput, which applies defaults), but the test suite would not
 * catch a future change that removed a default.
 *
 * This helper runs args through the tool's inputSchema first, exactly the
 * way the protocol does. Use it in place of the inline pattern in any test
 * that wants to assert on defaulted fields.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  normalizeObjectSchema,
  safeParseAsync,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";

interface RegisteredTool {
  handler: (a: unknown, extra: unknown) => Promise<unknown>;
  inputSchema?: unknown;
}

/**
 * Look up the named tool on the McpServer, run the args through its
 * inputSchema (applying zod defaults + validation), then invoke the
 * handler. Throws if the tool is not registered or validation fails.
 */
export async function callTool(
  server: McpServer,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const internal = server as unknown as {
    _registeredTools: Record<string, RegisteredTool>;
  };
  const tool = internal._registeredTools[name];
  if (!tool) throw new Error(`Tool ${name} not registered`);

  let parsedArgs: unknown = args;
  if (tool.inputSchema) {
    const normalised = normalizeObjectSchema(tool.inputSchema);
    const schemaToParse = normalised ?? tool.inputSchema;
    const result = await safeParseAsync(schemaToParse, args);
    if (!result.success) {
      const err = "error" in result ? result.error : "Unknown error";
      throw new Error(
        `callTool(${name}): zod validation failed: ${String(err)}`,
      );
    }
    parsedArgs = result.data;
  }

  return tool.handler(parsedArgs, {});
}
