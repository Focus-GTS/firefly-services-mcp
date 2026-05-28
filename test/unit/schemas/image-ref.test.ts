/**
 * imageRefSchema — URL scheme + host allowlist tests.
 *
 * Verifies the .refine() guard rejects file://, http://, IP literals,
 * localhost, and non-Adobe-allowed hosts, while accepting URLs on the
 * Adobe-allowed cloud storage domains.
 */
import { describe, it, expect } from "vitest";
import {
  imageRefSchema,
  isAllowedImageUrl,
  ALLOWED_IMAGE_URL_HOSTS,
} from "../../../src/schemas/image-ref.js";

describe("imageRefSchema — allowed hosts", () => {
  const allowedExamples = [
    "https://my-bucket.s3.amazonaws.com/img.png",
    "https://files.amazonaws.com/x.png",
    "https://my-account.blob.core.windows.net/c/i.png",
    "https://dl.dropboxusercontent.com/scl/fi/abc/img.png",
    "https://firefly-api.adobe.io/uploads/abc",
  ];

  for (const url of allowedExamples) {
    it(`accepts ${url}`, () => {
      expect(isAllowedImageUrl(url)).toBe(true);
      const result = imageRefSchema.safeParse({ url });
      expect(result.success).toBe(true);
    });
  }
});

describe("imageRefSchema — rejected hosts", () => {
  const blocked: Array<[string, string]> = [
    ["http://files.amazonaws.com/x.png", "http (not https)"],
    ["file:///etc/passwd", "file:// scheme"],
    ["ftp://files.amazonaws.com/x.png", "ftp scheme"],
    ["https://localhost/x.png", "localhost"],
    ["https://localhost:8080/x.png", "localhost with port"],
    ["https://1.2.3.4/x.png", "IPv4 literal"],
    ["https://169.254.169.254/latest/meta-data/", "AWS metadata IP"],
    ["https://[::1]/x.png", "IPv6 loopback literal"],
    ["https://[2001:db8::1]/x.png", "IPv6 literal"],
    ["https://example.com/x.png", "non-allowed host"],
    ["https://evil.com/aws/amazonaws.com/x.png", "amazonaws.com in path only"],
    ["https://notamazonaws.com/x.png", "suffix collision (no leading dot)"],
    ["https://adobe.io.attacker.com/x.png", "lookalike host"],
    ["not a url at all", "malformed url"],
  ];

  for (const [url, label] of blocked) {
    it(`rejects ${label}: ${url}`, () => {
      expect(isAllowedImageUrl(url)).toBe(false);
      const result = imageRefSchema.safeParse({ url });
      expect(result.success).toBe(false);
    });
  }
});

describe("imageRefSchema — exactly-one constraint", () => {
  it("accepts a valid uploadId-only ref", () => {
    const r = imageRefSchema.safeParse({ uploadId: "abc-123" });
    expect(r.success).toBe(true);
  });

  it("accepts a valid path-only ref", () => {
    const r = imageRefSchema.safeParse({ path: "/tmp/x.png" });
    expect(r.success).toBe(true);
  });

  it("rejects refs with multiple fields set", () => {
    const r = imageRefSchema.safeParse({
      uploadId: "x",
      url: "https://files.amazonaws.com/y.png",
    });
    expect(r.success).toBe(false);
  });

  it("rejects empty refs", () => {
    const r = imageRefSchema.safeParse({});
    expect(r.success).toBe(false);
  });
});

describe("ALLOWED_IMAGE_URL_HOSTS — export shape", () => {
  it("is a readonly array of suffix strings", () => {
    expect(Array.isArray(ALLOWED_IMAGE_URL_HOSTS)).toBe(true);
    expect(ALLOWED_IMAGE_URL_HOSTS.length).toBeGreaterThan(0);
    for (const entry of ALLOWED_IMAGE_URL_HOSTS) {
      expect(typeof entry).toBe("string");
      expect(entry.startsWith(".")).toBe(false);
    }
  });

  it("includes the four core Adobe-published storage domains", () => {
    expect(ALLOWED_IMAGE_URL_HOSTS).toContain("amazonaws.com");
    expect(ALLOWED_IMAGE_URL_HOSTS).toContain("windows.net");
    expect(ALLOWED_IMAGE_URL_HOSTS).toContain("dropboxusercontent.com");
    expect(ALLOWED_IMAGE_URL_HOSTS).toContain("adobe.io");
  });
});
