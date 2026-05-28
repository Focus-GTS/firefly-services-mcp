/**
 * Token cache — refresh-before-expiry for IMS access tokens.
 *
 * Per the canonical pattern documented in the firefly-services-auth skill:
 * refresh 5 minutes before expiry rather than reactively on 401. A single
 * in-flight refresh promise per cache instance prevents thundering-herd
 * refreshes under concurrent tool calls.
 */
import { logger } from "../util/logger.js";
import type { Credentials } from "./credentials.js";

const IMS_TOKEN_URL = "https://ims-na1.adobelogin.com/ims/token/v3";
const SAFETY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Extract only the OAuth 2.0 standard `error` and `error_description` fields
 * from an IMS error response body. Other fields are dropped — Adobe IMS has
 * been observed to echo `client_id` back in error responses and, on certain
 * malformed-grant errors, fragments of the submitted form body (which
 * contains `client_secret`). Logging the raw body would leak a live secret.
 *
 * If the body is not valid JSON, returns a fixed marker string instead.
 */
function redactImsErrorBody(body: string): {
  error?: string;
  error_description?: string;
  body?: string;
} {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const out: { error?: string; error_description?: string } = {};
    if (typeof parsed.error === "string") out.error = parsed.error;
    if (typeof parsed.error_description === "string") {
      out.error_description = parsed.error_description;
    }
    return out;
  } catch {
    return { body: "<non-JSON IMS error body redacted>" };
  }
}

export class TokenCache {
  private token: string | null = null;
  private expiresAt = 0;
  private inFlightRefresh: Promise<string> | null = null;

  constructor(private readonly creds: Credentials) {}

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt - SAFETY_BUFFER_MS) {
      return this.token;
    }
    if (this.inFlightRefresh) {
      return this.inFlightRefresh;
    }
    this.inFlightRefresh = this.refresh().finally(() => {
      this.inFlightRefresh = null;
    });
    return this.inFlightRefresh;
  }

  private async refresh(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.creds.clientId,
      client_secret: this.creds.clientSecret,
      scope: this.creds.scopes.join(","),
    });

    logger.debug({ scopes: this.creds.scopes }, "refreshing IMS token");

    const res = await fetch(IMS_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    if (!res.ok) {
      const errBody = await res.text();
      const redacted = redactImsErrorBody(errBody);
      logger.error(
        { status: res.status, ...redacted },
        "IMS token refresh failed",
      );
      // The thrown error message is human-facing and may surface to the LLM
      // via mapSdkError, so it must also be redacted — never include the raw
      // body, only the OAuth-standard `error` / `error_description` envelope.
      const reason = redacted.error
        ? `${redacted.error}${redacted.error_description ? `: ${redacted.error_description}` : ""}`
        : "<non-JSON IMS error body redacted>";
      throw new Error(`IMS token refresh failed: HTTP ${res.status}: ${reason}`);
    }

    const json = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      token_type?: string;
    };

    if (!json.access_token) {
      throw new Error(`IMS returned 200 but no access_token in response: ${JSON.stringify(json)}`);
    }

    this.token = json.access_token;
    this.expiresAt = Date.now() + (json.expires_in ?? 86399) * 1000;
    logger.info(
      { expires_in: json.expires_in, expiresAt: new Date(this.expiresAt).toISOString() },
      "IMS token refreshed",
    );
    return this.token;
  }

  /** Returns metadata about the cached token without forcing a refresh. */
  status(): { hasToken: boolean; expiresAt: number | null; expiresInSec: number | null } {
    return {
      hasToken: this.token !== null,
      expiresAt: this.token ? this.expiresAt : null,
      expiresInSec: this.token ? Math.max(0, Math.floor((this.expiresAt - Date.now()) / 1000)) : null,
    };
  }

  /**
   * Drop the cached token so the next getToken() call hits IMS again.
   * Used by firefly_check_auth's force_refresh flag and by callers that
   * know a token has been revoked server-side.
   */
  invalidate(): void {
    this.token = null;
    this.expiresAt = 0;
  }
}
