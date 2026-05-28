/**
 * Filesystem path guard for LLM-supplied paths.
 *
 * Background: tools like `firefly_upload_image` accept a `path` argument
 * supplied by the LLM and read it via `fs.readFile`. Without a guard, a
 * malicious tool invocation (whether via prompt injection or a confused
 * agent) can read arbitrary files — `~/.ssh/id_rsa`, `~/.aws/credentials`,
 * `/etc/passwd` — and exfiltrate them to Adobe via the upload endpoint.
 *
 * Policy enforced here:
 *   - Caller configures an allowed root via the `FIREFLY_SERVICES_UPLOAD_ROOT`
 *     environment variable. Defaults to `process.cwd()`.
 *   - The user-supplied path is resolved (relative paths are resolved against
 *     the upload root, NOT the process cwd, to avoid surprises) and then
 *     `fs.realpath`'d to follow symlinks.
 *   - The realpath MUST stay inside the upload root. Symlinks pointing out
 *     of the root are rejected.
 *   - Hidden files (basename starting with `.`) are rejected. The intent is
 *     not security-through-obscurity but a defense against the most common
 *     credential-file shape (`.env`, `.aws/credentials`, `.ssh/id_rsa`).
 *
 * Returns either a resolved absolute path (safe to read) or a structured
 * error code so the caller can produce a useful tool-error response.
 */
import fs from "node:fs/promises";
import path from "node:path";

export type GuardErrorCode =
  | "PATH_OUTSIDE_ROOT"
  | "PATH_HIDDEN_FILE"
  | "PATH_NOT_FOUND"
  | "PATH_NOT_FILE"
  | "PATH_SYMLINK_ESCAPES_ROOT";

export interface GuardError {
  ok: false;
  code: GuardErrorCode;
  message: string;
}

export interface GuardSuccess {
  ok: true;
  /** Absolute, fully-resolved (symlinks-followed) path safe to read. */
  resolvedPath: string;
  /** Basename of the resolved file. Safe to surface to the LLM. */
  basename: string;
  /** The configured upload root at the time of the check. */
  uploadRoot: string;
}

export type GuardResult = GuardSuccess | GuardError;

/** Get the configured upload root. Resolves the env var or process.cwd(). */
export function getUploadRoot(): string {
  const fromEnv = process.env.FIREFLY_SERVICES_UPLOAD_ROOT;
  const base = fromEnv && fromEnv.trim().length > 0 ? fromEnv : process.cwd();
  return path.resolve(base);
}

/**
 * Check whether `child` is contained within `parent`. Both paths must be
 * absolute and normalised. The check uses `path.relative` so that boundary
 * cases like `parent === child` (allowed) and prefix-match-without-separator
 * (`/var/data` vs `/var/data2`) are handled correctly.
 */
function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Validate a user-supplied filesystem path against the upload-root policy.
 * Returns either a resolved absolute path that is safe to read, or a
 * structured error describing why the path was rejected.
 */
export async function guardUserPath(userPath: string): Promise<GuardResult> {
  const uploadRoot = getUploadRoot();

  // Resolve relative paths against the upload root, not process.cwd(). This
  // prevents the surprise where a tool is launched from one directory and
  // accepts paths relative to a different one.
  const candidate = path.isAbsolute(userPath)
    ? path.resolve(userPath)
    : path.resolve(uploadRoot, userPath);

  // Cheap lexical check before touching the filesystem.
  if (!isInside(uploadRoot, candidate)) {
    return {
      ok: false,
      code: "PATH_OUTSIDE_ROOT",
      message:
        `Path resolves outside the configured upload root. ` +
        `Allowed root: ${uploadRoot}. Resolved: ${candidate}. ` +
        `Set FIREFLY_SERVICES_UPLOAD_ROOT to widen the allowed directory.`,
    };
  }

  // Reject hidden files by basename. Catches `.env`, `id_rsa`-like patterns
  // when stored as `.id_rsa`, and `.aws/credentials` (we check the basename
  // of every segment along the path inside the root).
  const segmentsInsideRoot = path.relative(uploadRoot, candidate).split(path.sep);
  for (const seg of segmentsInsideRoot) {
    if (seg.startsWith(".") && seg !== "" && seg !== "." && seg !== "..") {
      return {
        ok: false,
        code: "PATH_HIDDEN_FILE",
        message:
          `Hidden filename or directory segment "${seg}" is not allowed. ` +
          `Rename the file or move it out of a dotted directory.`,
      };
    }
  }

  // Resolve symlinks. If the realpath escapes the root, reject.
  let resolved: string;
  try {
    resolved = await fs.realpath(candidate);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      return {
        ok: false,
        code: "PATH_NOT_FOUND",
        message: `File not found at: ${candidate}`,
      };
    }
    return {
      ok: false,
      code: "PATH_NOT_FOUND",
      message: `Unable to resolve path: ${e.message ?? String(err)}`,
    };
  }

  if (!isInside(uploadRoot, resolved)) {
    return {
      ok: false,
      code: "PATH_SYMLINK_ESCAPES_ROOT",
      message:
        `Path resolves through a symlink to a location outside the upload root. ` +
        `Allowed root: ${uploadRoot}.`,
    };
  }

  // Also enforce hidden-file check on the realpath in case a symlink points
  // to a hidden file inside the root.
  const resolvedSegments = path.relative(uploadRoot, resolved).split(path.sep);
  for (const seg of resolvedSegments) {
    if (seg.startsWith(".") && seg !== "" && seg !== "." && seg !== "..") {
      return {
        ok: false,
        code: "PATH_HIDDEN_FILE",
        message:
          `Resolved path includes a hidden segment "${seg}". ` +
          `Hidden files and directories are not allowed.`,
      };
    }
  }

  // Final sanity: it must be a regular file (not a directory or socket).
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) {
      return {
        ok: false,
        code: "PATH_NOT_FILE",
        message: `Path is not a regular file: ${resolved}`,
      };
    }
  } catch (err) {
    return {
      ok: false,
      code: "PATH_NOT_FOUND",
      message: `Unable to stat path: ${(err as Error).message}`,
    };
  }

  return {
    ok: true,
    resolvedPath: resolved,
    basename: path.basename(resolved),
    uploadRoot,
  };
}
