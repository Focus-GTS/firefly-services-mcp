/**
 * mapSdkError — security-focused unit tests.
 *
 * The Adobe SDK attaches request/response metadata to thrown errors. That
 * metadata typically includes `Authorization: Bearer <ims-token>` and
 * `x-api-key: <client-id>` headers, which must never reach the MCP tool
 * output that the LLM sees. These tests fabricate that error shape and
 * verify the allowlist strips the dangerous fields.
 */
import { describe, it, expect } from "vitest";
import { mapSdkError, __testing__ } from "../../../src/util/errors.js";

describe("mapSdkError — response sanitization", () => {
  it("strips Authorization and x-api-key from request headers", () => {
    const err = Object.assign(new Error("Firefly 401"), {
      status: 401,
      response: {
        status: 401,
        statusText: "Unauthorized",
        body: '{"error_code":"401013"}',
        request: {
          method: "POST",
          url: "https://firefly-api.adobe.io/v3/images/generate",
          headers: {
            Authorization: "Bearer ya29.SECRET-TOKEN-VALUE",
            "x-api-key": "client-id-SECRET",
            "Content-Type": "application/json",
            "User-Agent": "firefly-services-sdk-js/2.0.1",
          },
        },
      },
    });

    const mapped = mapSdkError(err);
    const text = JSON.stringify(mapped);

    expect(text).not.toContain("ya29.SECRET-TOKEN-VALUE");
    expect(text).not.toContain("client-id-SECRET");
    expect(text).not.toContain("Authorization");
    expect(text).not.toContain("x-api-key");

    // Allowed metadata MUST survive so the LLM can act on the error.
    const details = mapped.details as Record<string, unknown>;
    const response = details.response as Record<string, unknown>;
    expect(response.status).toBe(401);
    expect(response.statusText).toBe("Unauthorized");
    expect(response.body).toBe('{"error_code":"401013"}');
    const req = response.request as Record<string, unknown>;
    expect(req.method).toBe("POST");
    expect(req.url).toBe("https://firefly-api.adobe.io/v3/images/generate");
    const headers = req.headers as Record<string, unknown>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["User-Agent"]).toBe("firefly-services-sdk-js/2.0.1");
  });

  it("strips Cookie, Set-Cookie, and Proxy-Authorization headers", () => {
    const err = Object.assign(new Error("error"), {
      response: {
        status: 500,
        request: {
          headers: {
            Cookie: "session=secret-session-cookie",
            "Set-Cookie": "session=another-secret",
            "Proxy-Authorization": "Basic c2VjcmV0OnNlY3JldA==",
            Accept: "application/json",
          },
        },
      },
    });

    const text = JSON.stringify(mapSdkError(err));
    expect(text).not.toContain("secret-session-cookie");
    expect(text).not.toContain("another-secret");
    expect(text).not.toContain("c2VjcmV0OnNlY3JldA==");
    expect(text).toContain("application/json"); // safe header survived
  });

  it("strips credential-shaped header names (case-insensitive)", () => {
    const err = Object.assign(new Error("err"), {
      response: {
        request: {
          headers: {
            authorization: "Bearer x", // lowercase
            AUTHORIZATION: "Bearer y", // uppercase
            "X-Custom-Auth-Token": "should-not-leak",
            "x-secret-key": "should-not-leak",
            "X-Custom-Password": "should-not-leak",
            "X-Request-Id": "safe-id-123",
          },
        },
      },
    });

    const text = JSON.stringify(mapSdkError(err));
    expect(text).not.toContain("Bearer x");
    expect(text).not.toContain("Bearer y");
    expect(text).not.toContain("should-not-leak");
    expect(text).toContain("safe-id-123");
  });

  it("forwards status, statusText, and body fields when present", () => {
    const err = Object.assign(new Error("Bad Request"), {
      status: 400,
      response: {
        status: 400,
        statusText: "Bad Request",
        body: "validation failed",
      },
    });

    const mapped = mapSdkError(err);
    expect(mapped.code).toBe("400");
    expect(mapped.message).toBe("Bad Request");
    const response = (mapped.details as Record<string, unknown>).response as Record<string, unknown>;
    expect(response.status).toBe(400);
    expect(response.statusText).toBe("Bad Request");
    expect(response.body).toBe("validation failed");
  });

  it("truncates oversized response bodies to ~2KB with a marker", () => {
    const longBody = "A".repeat(5000);
    const err = Object.assign(new Error("oops"), {
      response: { status: 500, body: longBody },
    });
    const mapped = mapSdkError(err);
    const response = (mapped.details as Record<string, unknown>).response as Record<string, unknown>;
    const body = response.body as string;
    expect(body.length).toBeLessThanOrEqual(__testing__.MAX_BODY_BYTES + 50);
    expect(body.endsWith("...[truncated]")).toBe(true);
  });

  it("falls back to .data field when .body is absent", () => {
    const err = Object.assign(new Error("err"), {
      response: { status: 500, data: { error_code: "internal" } },
    });
    const mapped = mapSdkError(err);
    const response = (mapped.details as Record<string, unknown>).response as Record<string, unknown>;
    expect(response.body).toContain("internal");
  });

  it("returns no response field when the error has no response", () => {
    const err = new Error("plain error");
    const mapped = mapSdkError(err);
    expect(mapped.code).toBe("SDK_ERROR");
    expect(mapped.message).toBe("plain error");
    expect(mapped.details).toEqual({ name: "Error" });
  });

  it("handles non-Error throws", () => {
    expect(mapSdkError("string error")).toEqual({
      code: "UNKNOWN_ERROR",
      message: "string error",
    });
    expect(mapSdkError(42)).toEqual({
      code: "UNKNOWN_ERROR",
      message: "42",
    });
  });

  it("drops the request entry entirely when only credential headers were present", () => {
    const err = Object.assign(new Error("err"), {
      response: {
        status: 401,
        request: {
          // No method or url, only credentials — request entry should be dropped.
          headers: {
            Authorization: "Bearer secret",
            "x-api-key": "secret",
          },
        },
      },
    });
    const mapped = mapSdkError(err);
    const response = (mapped.details as Record<string, unknown>).response as Record<string, unknown>;
    expect(response.request).toBeUndefined();
  });
});

describe("mapSdkError — sanitizeHeaders helper", () => {
  it("returns empty object when given non-object input", () => {
    expect(__testing__.sanitizeHeaders(null)).toBeUndefined();
    expect(__testing__.sanitizeHeaders(undefined)).toBeUndefined();
    expect(__testing__.sanitizeHeaders("string")).toBeUndefined();
  });

  it("preserves non-credential headers verbatim", () => {
    const result = __testing__.sanitizeHeaders({
      "Content-Type": "application/json",
      Accept: "*/*",
    });
    expect(result).toEqual({
      "Content-Type": "application/json",
      Accept: "*/*",
    });
  });
});
