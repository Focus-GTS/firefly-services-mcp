/**
 * Shared image-size presets for the Firefly generate-* tools.
 *
 * The four image-generating tools (generate-image, generate-similar,
 * expand-image, generate-object-composite) all advertise the same eight
 * supported sizes per the SDK's GenerateImagesRequest documentation. Before
 * this module those eight entries were duplicated 4x in tree.
 *
 * Video has its own preset list (different aspect ratios + resolutions) and
 * lives inside generate-video.ts on purpose; do not merge them.
 */

export const IMAGE_SIZE_PRESETS = [
  "square_1024",
  "square_2048",
  "landscape_2304x1792",
  "portrait_1792x2304",
  "widescreen_2688x1536",
  "landscape_1344x768",
  "landscape_1152x896",
  "portrait_896x1152",
] as const;

export type ImageSizePreset = (typeof IMAGE_SIZE_PRESETS)[number];

export const SIZE_BY_PRESET: Record<ImageSizePreset, { width: number; height: number }> = {
  square_1024: { width: 1024, height: 1024 },
  square_2048: { width: 2048, height: 2048 },
  landscape_2304x1792: { width: 2304, height: 1792 },
  portrait_1792x2304: { width: 1792, height: 2304 },
  widescreen_2688x1536: { width: 2688, height: 1536 },
  landscape_1344x768: { width: 1344, height: 768 },
  landscape_1152x896: { width: 1152, height: 896 },
  portrait_896x1152: { width: 896, height: 1152 },
};
