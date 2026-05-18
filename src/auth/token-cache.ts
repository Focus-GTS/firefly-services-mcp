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
      logger.error({ status: res.status, body: errBody }, "IMS token refresh failed");
      throw new Error(`IMS token refresh failed: HTTP ${res.status}: ${errBody}`);
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
}
