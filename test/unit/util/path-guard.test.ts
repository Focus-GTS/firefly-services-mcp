/**
 * path-guard — filesystem traversal defense tests.
 *
 * Covers the policy enforced by src/util/path-guard.ts:
 *   - in-root paths allowed
 *   - out-of-root paths rejected (lexical and via symlink)
 *   - hidden files / dotted segments rejected
 *   - missing files surface PATH_NOT_FOUND
 *   - directories surface PATH_NOT_FILE
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { guardUserPath, getUploadRoot } from "../../../src/util/path-guard.js";

let originalRoot: string | undefined;
let tmpRoot = "";
let outsideRoot = "";
const dirsToCleanup: string[] = [];

beforeEach(async () => {
  // Realpath each tmpdir to handle macOS /var → /private/var symlink so the
  // upload-root match is exact.
  tmpRoot = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "ff-guard-root-")),
  );
  outsideRoot = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "ff-guard-outside-")),
  );
  dirsToCleanup.push(tmpRoot, outsideRoot);

  originalRoot = process.env.FIREFLY_SERVICES_UPLOAD_ROOT;
  process.env.FIREFLY_SERVICES_UPLOAD_ROOT = tmpRoot;
});

afterEach(async () => {
  for (const d of dirsToCleanup.splice(0)) {
    await fs.rm(d, { recursive: true, force: true });
  }
  if (originalRoot === undefined) {
    delete process.env.FIREFLY_SERVICES_UPLOAD_ROOT;
  } else {
    process.env.FIREFLY_SERVICES_UPLOAD_ROOT = originalRoot;
  }
});

describe("getUploadRoot", () => {
  it("returns the configured env var when set", () => {
    expect(getUploadRoot()).toBe(tmpRoot);
  });

  it("falls back to process.cwd() when env var is missing or empty", () => {
    delete process.env.FIREFLY_SERVICES_UPLOAD_ROOT;
    expect(getUploadRoot()).toBe(path.resolve(process.cwd()));

    process.env.FIREFLY_SERVICES_UPLOAD_ROOT = "   ";
    expect(getUploadRoot()).toBe(path.resolve(process.cwd()));
  });
});

describe("guardUserPath — happy paths", () => {
  it("accepts an absolute path inside the upload root", async () => {
    const file = path.join(tmpRoot, "image.png");
    await fs.writeFile(file, Buffer.from([1, 2, 3]));

    const result = await guardUserPath(file);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolvedPath).toBe(file);
      expect(result.basename).toBe("image.png");
      expect(result.uploadRoot).toBe(tmpRoot);
    }
  });

  it("accepts a relative path resolved against the upload root", async () => {
    const file = path.join(tmpRoot, "sub", "img.jpg");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.from([1]));

    const result = await guardUserPath("sub/img.jpg");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolvedPath).toBe(file);
      expect(result.basename).toBe("img.jpg");
    }
  });
});

describe("guardUserPath — out-of-root rejection", () => {
  it("rejects an absolute path outside the upload root", async () => {
    const file = path.join(outsideRoot, "secret.png");
    await fs.writeFile(file, Buffer.from([1]));

    const result = await guardUserPath(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("PATH_OUTSIDE_ROOT");
    }
  });

  it("rejects a relative path that traverses out (../)", async () => {
    // tmpRoot/sub/../../something — this resolves outside tmpRoot.
    const result = await guardUserPath("../escape.png");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("PATH_OUTSIDE_ROOT");
    }
  });

  it("rejects /etc/passwd specifically", async () => {
    const result = await guardUserPath("/etc/passwd");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Could be PATH_OUTSIDE_ROOT or PATH_NOT_FOUND depending on filesystem,
      // but it MUST NOT succeed.
      expect(["PATH_OUTSIDE_ROOT", "PATH_NOT_FOUND"]).toContain(result.code);
    }
  });
});

describe("guardUserPath — symlink rejection", () => {
  it("rejects a symlink pointing outside the upload root", async () => {
    const secret = path.join(outsideRoot, "secret.png");
    await fs.writeFile(secret, Buffer.from([1, 2, 3]));

    const link = path.join(tmpRoot, "innocent.png");
    await fs.symlink(secret, link);

    const result = await guardUserPath(link);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("PATH_SYMLINK_ESCAPES_ROOT");
    }
  });

  it("accepts a symlink pointing inside the upload root", async () => {
    const real = path.join(tmpRoot, "real.png");
    await fs.writeFile(real, Buffer.from([1]));
    const link = path.join(tmpRoot, "link.png");
    await fs.symlink(real, link);

    const result = await guardUserPath(link);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.resolvedPath).toBe(real);
    }
  });
});

describe("guardUserPath — hidden files", () => {
  it("rejects a hidden file by basename", async () => {
    const file = path.join(tmpRoot, ".env");
    await fs.writeFile(file, "SECRET=value");

    const result = await guardUserPath(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("PATH_HIDDEN_FILE");
    }
  });

  it("rejects a file inside a hidden directory segment", async () => {
    const dir = path.join(tmpRoot, ".ssh");
    await fs.mkdir(dir);
    const file = path.join(dir, "id_rsa.png");
    await fs.writeFile(file, "fake-key");

    const result = await guardUserPath(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("PATH_HIDDEN_FILE");
    }
  });

  it("rejects a symlink whose realpath includes a hidden segment", async () => {
    const dir = path.join(tmpRoot, ".cache");
    await fs.mkdir(dir);
    const real = path.join(dir, "thing.png");
    await fs.writeFile(real, Buffer.from([1]));
    const link = path.join(tmpRoot, "innocent.png");
    await fs.symlink(real, link);

    const result = await guardUserPath(link);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("PATH_HIDDEN_FILE");
    }
  });
});

describe("guardUserPath — missing / non-file", () => {
  it("returns PATH_NOT_FOUND for a missing file", async () => {
    const result = await guardUserPath(path.join(tmpRoot, "missing.png"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("PATH_NOT_FOUND");
    }
  });

  it("returns PATH_NOT_FILE for a directory", async () => {
    const dir = path.join(tmpRoot, "subdir");
    await fs.mkdir(dir);

    const result = await guardUserPath(dir);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("PATH_NOT_FILE");
    }
  });
});
