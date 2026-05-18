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
 */
import { z } from "zod";

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
      .optional()
      .describe(
        "Pre-signed URL granting GET access to the image on caller-controlled storage. Domains allowed by Firefly: amazonaws.com, windows.net, dropboxusercontent.com.",
      ),
    path: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Local filesystem path to an image file. The tool will auto-upload the file via firefly_upload_image semantics before the underlying SDK call. Convenient for one-off use; less efficient than re-using an uploadId for repeated calls against the same source.",
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
