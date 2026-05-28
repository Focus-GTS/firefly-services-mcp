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

/**
 * Maximum size of a forwarded response body in the structured error payload.
 * Set generously enough to preserve a typical Adobe error envelope while
 * still bounding the worst case (e.g. an SDK accidentally attaching a large
 * binary body).
 */
const MAX_BODY_BYTES = 2048;

/**
 * Header names that must NEVER appear in error output visible to the LLM /
 * chat transcript. Matched case-insensitively. The Adobe SDK attaches the
 * original request shape to thrown errors, and the request shape includes
 * `Authorization: Bearer <ims-token>` and `x-api-key: <client-id>`.
 *
 * Forwarding those into a tool result would leak a live credential into
 * the conversation history.
 */
const REDACTED_HEADER_NAMES = new Set<string>([
  "authorization",
  "proxy-authorization",
  "x-api-key",
  "api-key",
  "x-auth-token",
  "cookie",
  "set-cookie",
]);

/** Header names that look credential-shaped even if not in the explicit list. */
function looksLikeCredentialHeader(name: string): boolean {
  const n = name.toLowerCase();
  return (
    n.includes("auth") ||
    n.includes("token") ||
    n.includes("secret") ||
    n.includes("password") ||
    n.includes("credential") ||
    n.includes("api-key") ||
    n.includes("apikey")
  );
}

/** Strip credential-shaped fields from a headers-shaped object. */
function sanitizeHeaders(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (REDACTED_HEADER_NAMES.has(k.toLowerCase()) || looksLikeCredentialHeader(k)) {
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * Truncate a body value to MAX_BODY_BYTES. Strings are sliced; objects are
 * JSON-stringified then sliced. The output is a string in both cases so the
 * downstream caller doesn't have to discriminate.
 */
function truncateBody(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  let s: string;
  if (typeof body === "string") {
    s = body;
  } else {
    try {
      s = JSON.stringify(body);
    } catch {
      s = String(body);
    }
  }
  if (s.length <= MAX_BODY_BYTES) return s;
  return s.slice(0, MAX_BODY_BYTES) + "...[truncated]";
}

interface SanitizedResponse {
  status?: number;
  statusText?: string;
  body?: string;
  request?: {
    method?: string;
    url?: string;
    headers?: Record<string, unknown>;
  };
}

/**
 * Forward only an allowlisted subset of an SDK error's `.response`. Anything
 * outside the allowlist — particularly request headers — is dropped to avoid
 * leaking the Authorization bearer token or x-api-key into MCP output.
 */
function sanitizeSdkResponse(input: unknown): SanitizedResponse | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;

  const out: SanitizedResponse = {};

  if (typeof raw.status === "number") out.status = raw.status;
  if (typeof raw.statusText === "string") out.statusText = raw.statusText;

  // Response body — try a few common field names. Some Adobe SDK errors put
  // it on .data, some on .body, some leave it on the raw error message.
  const bodyCandidate = raw.body ?? raw.data ?? raw.responseBody;
  const body = truncateBody(bodyCandidate);
  if (body !== undefined) out.body = body;

  // Preserve a redacted request shape — useful for "which endpoint failed"
  // but stripped of auth headers.
  if (raw.request && typeof raw.request === "object") {
    const req = raw.request as Record<string, unknown>;
    const reqOut: { method?: string; url?: string; headers?: Record<string, unknown> } = {};
    if (typeof req.method === "string") reqOut.method = req.method;
    if (typeof req.url === "string") reqOut.url = req.url;
    const sanitizedHeaders = sanitizeHeaders(req.headers);
    if (sanitizedHeaders && Object.keys(sanitizedHeaders).length > 0) {
      reqOut.headers = sanitizedHeaders;
    }
    if (Object.keys(reqOut).length > 0) out.request = reqOut;
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

/** Wrap unknown errors thrown by SDK calls into structured tool errors. */
export function mapSdkError(err: unknown): ToolErrorPayload {
  if (err instanceof Error) {
    const anyErr = err as Error & { code?: string | number; status?: number; response?: unknown };
    const sanitized = sanitizeSdkResponse(anyErr.response);
    return {
      code: String(anyErr.code ?? anyErr.status ?? "SDK_ERROR"),
      message: err.message,
      details: {
        name: err.name,
        ...(sanitized ? { response: sanitized } : {}),
      },
    };
  }
  return {
    code: "UNKNOWN_ERROR",
    message: String(err),
  };
}

/** Exported for tests. Do not use directly from tool code. */
export const __testing__ = {
  sanitizeSdkResponse,
  sanitizeHeaders,
  truncateBody,
  REDACTED_HEADER_NAMES,
  MAX_BODY_BYTES,
};
