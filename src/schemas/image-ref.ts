/**
 * Image reference schema — the canonical triple-mode input shape used by
 * every MCP tool that accepts a source image.
 *
 * Per ADR-004:
 *   - uploadId: already uploaded to Firefly via firefly_upload_image
 *   - url:      pre-signed URL on caller-controlled storage (S3, Azure, GCS, Dropbox)
 *   - path:     local filesystem path; the tool will auto-upload before the SDK call
 *
 * Exactly one of the three MUST be set. Validation enforces this.
 *
 * Security: the `url` field is restricted to HTTPS URLs whose host matches
 * the Adobe-published allowlist of cloud storage providers. IP literals,
 * `localhost`, file://, ftp://, http:// are all rejected. The allowlist
 * is exported so a future ADR can extend it without forking this schema.
 */
import { z } from "zod";

/**
 * Domains allowed in image-ref URLs. Each entry is a domain suffix matched
 * against the URL host with a leading "." or as an exact match. Drawn from
 * the Firefly Services public docs ("Public storage" section) and audit H2.
 *
 * Exported so future ADRs / tools can extend without forking this schema.
 */
export const ALLOWED_IMAGE_URL_HOSTS: readonly string[] = [
  "amazonaws.com",
  "windows.net",
  "dropboxusercontent.com",
  "adobe.io",
];

/** True if `host` is a numeric IP literal (IPv4 or IPv6). */
function isIpLiteral(host: string): boolean {
  // Strip IPv6 brackets if present.
  const h = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  // Quick IPv4 check.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true;
  // Loose IPv6 check — any presence of ":" is enough to flag, since
  // legitimate hostnames never contain a colon (the URL parser strips ports).
  if (h.includes(":")) return true;
  return false;
}

/** True if `host` matches one of the allowed domain suffixes. */
function isAllowedHost(host: string): boolean {
  const h = host.toLowerCase();
  return ALLOWED_IMAGE_URL_HOSTS.some(
    (suffix) => h === suffix || h.endsWith(`.${suffix}`),
  );
}

/** Reject loopback / link-local hostnames that aren't IP literals. */
const FORBIDDEN_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "broadcasthost",
  "ip6-localhost",
  "ip6-loopback",
]);

/**
 * Validate a URL string against the Firefly Services image-ref policy.
 * Returns true if allowed. Exported for tests.
 */
export function isAllowedImageUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname;
  if (!host) return false;
  if (FORBIDDEN_HOSTNAMES.has(host.toLowerCase())) return false;
  if (isIpLiteral(host)) return false;
  if (!isAllowedHost(host)) return false;
  return true;
}

export const imageRefSchema = z
  .object({
    uploadId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "UUID returned by a previous firefly_upload_image call. The most efficient way to reference an image already known to Firefly.",
      ),
    url: z
      .string()
      .url()
      .refine(isAllowedImageUrl, {
        message:
          "URL must use HTTPS and resolve to one of the Adobe-allowed cloud storage hosts: " +
          ALLOWED_IMAGE_URL_HOSTS.join(", ") +
          ". IP literals, localhost, file://, and http:// are not accepted.",
      })
      .optional()
      .describe(
        "Pre-signed HTTPS URL granting GET access to the image on caller-controlled storage. " +
          "Host must match one of the Firefly-allowed cloud storage domains: " +
          ALLOWED_IMAGE_URL_HOSTS.join(", ") +
          ". HTTP, file://, IP literals, and localhost are rejected.",
      ),
    path: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Local filesystem path to an image file (relative paths resolve against " +
          "FIREFLY_SERVICES_UPLOAD_ROOT, default: server CWD). The tool will auto-upload " +
          "via firefly_upload_image semantics before the underlying SDK call. Convenient for " +
          "one-off use; less efficient than re-using an uploadId for repeated calls.",
      ),
  })
  .refine(
    (v) => {
      const set = [v.uploadId, v.url, v.path].filter(Boolean).length;
      return set === 1;
    },
    {
      message:
        "Exactly one of uploadId, url, or path must be set. Got zero or multiple.",
    },
  )
  .describe(
    "A reference to an image. Provide exactly one of uploadId, url, or path.",
  );

export type ImageRef = z.infer<typeof imageRefSchema>;
