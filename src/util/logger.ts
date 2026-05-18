/**
 * Logger — pino to stderr.
 *
 * MCP protocol uses stdout for JSON-RPC messages. Logs MUST go to stderr or
 * they corrupt the protocol stream. See MCP transport specification.
 */
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { name: "firefly-services-mcp" },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: undefined, // raw JSON to stderr; no pretty-printing in production
}, pino.destination(2)); // file descriptor 2 = stderr
