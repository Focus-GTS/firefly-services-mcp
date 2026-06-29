# Changelog

All notable changes to `@focusgts/firefly-services-mcp` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/), and this
project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.3]

### Changed
- **All 19 tools now live-validated end-to-end** against the Adobe Firefly Services sandbox. `apply_actions` validated by running a real `.atn` action file through the API via GCS signed URLs. README status -> 19/19.

## [0.2.2]

### Fixed
- `photoshop_remove_background` now calls the **Remove Background V2** API (`POST /v2/remove-background`). The legacy V1 `/sensei/cutout` endpoint the SDK wraps reached End-of-Life on 2025-10-15 and returns HTTP 502; the tool now calls V2 directly with the IMS token. Live-validated against the sandbox (now **18/19 tools live**).

### Changed
- `photoshop_remove_background` input contract: V2 hosts the result itself, so `output_url`/`output_storage`/`mask_format` are removed; added `mode` (`cutout`/`mask`), `trim`, and `output_media_type`. Returns a jobId + statusUrl; poll with `firefly_get_job_status` to get the Adobe-hosted result URL.

## [0.2.1]

### Changed
- Live-validated 8 more Photoshop/Lightroom tools end-to-end against the Adobe sandbox via GCS signed URLs (now 17/19 total). README status updated.

### Fixed
- scripts/gen-test-psds.mjs: corrected a variable reference, the placed-layer GUID format, and the read-back validation so it generates valid PSD test fixtures (smart object + text layer).

## [0.2.0]

### Added
- **`firefly_get_job_status` tool** — poll an asynchronous Firefly job (e.g. the
  `statusUrl` returned by `firefly_generate_video`, or a Photoshop/Lightroom job)
  and surface status, output URLs, and inline image results. Closes the gap where
  async tools returned a status URL the caller could not act on. Includes an SSRF
  guard restricting the polled host to `*.adobe.io`.
- Image references now accept **`upload_id`** (snake_case, preferred) in addition
  to the legacy `uploadId`. Both normalize to the same value, so existing callers
  keep working while the documented surface is now consistent snake_case.

### Changed
- `firefly_expand_image` description now states the hard requirement: provide
  **either** a target size (`width` + `height`) **or** a `mask` — a call with
  neither fails.
- Documentation: clarified the two storage-reference models (Firefly's
  `upload_id | url | path` object vs. the Photoshop/Lightroom pre-signed
  `input_url` / `output_url` string model).

## [0.1.2]

### Added
- README "See it in action" section with live-generated example images.

### Fixed
- LICENSE now ships the full Apache-2.0 text (was a truncated stub).
- README links corrected for the org move and de-staled npm install section.

## [0.1.1]

### Fixed
- Initial post-publish corrections (license, README links).

## [0.1.0]

### Added
- First public release: 18 tools across Firefly (8), Photoshop API (6), and
  Lightroom API (4) over the Model Context Protocol. Firefly surface
  live-validated against the Adobe Firefly Services sandbox.
