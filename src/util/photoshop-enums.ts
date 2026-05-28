/**
 * Shared Photoshop enum mappers.
 *
 * The six Photoshop tools (apply-actions, apply-edits, document-manifest,
 * edit-text, remove-background, smart-object-replace) all need to translate
 * the same MCP-facing string literals into the @adobe/photoshop-apis enums.
 * Before this util those mappers were duplicated 5x in tree, with a subtle
 * footgun: each `switch` lacked a `default:` arm and silently returned
 * `undefined` for unknown values, which combined with tests that bypassed
 * zod meant unknown storage strings could quietly land in the SDK request.
 *
 * Centralising them here gives us one place to keep the exhaustive `default:`
 * that throws on unknown input.
 */
import { ImageFormatType, StorageType } from "@adobe/photoshop-apis";

export const PHOTOSHOP_STORAGE_VALUES = ["external", "azure", "dropbox"] as const;
export type PhotoshopStorageValue = (typeof PHOTOSHOP_STORAGE_VALUES)[number];

export const PHOTOSHOP_OUTPUT_FORMATS = [
  "image/jpeg",
  "image/png",
  "image/tiff",
  "image/vnd.adobe.photoshop",
] as const;
export type PhotoshopOutputFormat = (typeof PHOTOSHOP_OUTPUT_FORMATS)[number];

/**
 * Translate the MCP-facing storage string into the SDK's StorageType enum.
 * Throws on unknown input — the `default:` arm exists so unknown values
 * fail loudly rather than silently flowing through as `undefined`.
 */
export function toStorageType(s: PhotoshopStorageValue): StorageType {
  switch (s) {
    case "external":
      return StorageType.EXTERNAL;
    case "azure":
      return StorageType.AZURE;
    case "dropbox":
      return StorageType.DROPBOX;
    default: {
      const _exhaustive: never = s;
      throw new Error(`Unknown Photoshop storage type: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Translate the MCP-facing output-format MIME string into the SDK's
 * ImageFormatType enum. Throws on unknown input for the same reason as
 * toStorageType.
 */
export function toImageFormat(s: PhotoshopOutputFormat): ImageFormatType {
  switch (s) {
    case "image/jpeg":
      return ImageFormatType.IMAGE_JPEG;
    case "image/png":
      return ImageFormatType.IMAGE_PNG;
    case "image/tiff":
      return ImageFormatType.IMAGE_TIFF;
    case "image/vnd.adobe.photoshop":
      return ImageFormatType.IMAGE_VND_ADOBE_PHOTOSHOP;
    default: {
      const _exhaustive: never = s;
      throw new Error(`Unknown Photoshop output format: ${String(_exhaustive)}`);
    }
  }
}
