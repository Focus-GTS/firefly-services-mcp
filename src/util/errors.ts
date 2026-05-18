/**
 * Error mapping — Adobe SDK / unknown errors → structured MCP tool results.
 *
 * MCP convention: tool errors are returned as a CallToolResult with isError=true
 * and an explanatory text content block. They are NOT thrown as protocol errors
 * unless the failure is at the protocol layer itself (bad request, etc.).
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { logger } from "./logger.js";

export interface ToolErrorPayload {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export function toolError(payload: ToolErrorPayload): CallToolResult {
  logger.warn({ err: payload }, "tool returned error");
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

/** Wrap unknown errors thrown by SDK calls into structured tool errors. */
export function mapSdkError(err: unknown): ToolErrorPayload {
  if (err instanceof Error) {
    const anyErr = err as Error & { code?: string | number; status?: number; response?: unknown };
    return {
      code: String(anyErr.code ?? anyErr.status ?? "SDK_ERROR"),
      message: err.message,
      details: {
        name: err.name,
        ...(anyErr.response ? { response: anyErr.response } : {}),
      },
    };
  }
  return {
    code: "UNKNOWN_ERROR",
    message: String(err),
  };
}
