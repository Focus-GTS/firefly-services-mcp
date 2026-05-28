/**
 * Logger — pino to stderr.
 *
 * MCP protocol uses stdout for JSON-RPC messages. Logs MUST go to stderr or
 * they corrupt the protocol stream. See MCP transport specification.
 *
 * Default level: `warn`. Override with the `LOG_LEVEL` env var (one of:
 * `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `silent`). Example:
 *   LOG_LEVEL=debug npx tsx src/server.ts
 */
import pino from "pino";

// Conservative default — info-level breadcrumbs added during future
// development should not unintentionally land at the user's default verbosity.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "warn",
  base: { name: "firefly-services-mcp" },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: undefined, // raw JSON to stderr; no pretty-printing in production
}, pino.destination(2)); // file descriptor 2 = stderr
