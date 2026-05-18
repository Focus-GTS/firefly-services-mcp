/**
 * Firefly client factory — wires our TokenCache into the official SDK's
 * TokenProvider contract.
 *
 * The SDK accepts a `ClientConfig` with a `tokenProvider` interface. We adapt
 * our TokenCache to that interface so the SDK's per-request auth flow uses
 * our cache (refresh-before-expiry, in-flight dedupe). This keeps a single
 * source of truth for token lifecycle — no duplicate caches.
 */
import { FireflyClient } from "@adobe/firefly-apis";
import type { ClientConfig, TokenProvider } from "@adobe/firefly-services-sdk-core";
import type { Credentials } from "./credentials.js";
import type { TokenCache } from "./token-cache.js";

class TokenCacheAdapter implements TokenProvider {
  constructor(private readonly cache: TokenCache) {}
  async getToken(_env: string | undefined): Promise<string> {
    return this.cache.getToken();
  }
}

let cachedClient: FireflyClient | null = null;

/** Returns a singleton FireflyClient bound to our TokenCache. */
export function getFireflyClient(creds: Credentials, tokenCache: TokenCache): FireflyClient {
  if (cachedClient) return cachedClient;
  const config: ClientConfig = {
    clientId: creds.clientId,
    tokenProvider: new TokenCacheAdapter(tokenCache),
  };
  cachedClient = new FireflyClient(config);
  return cachedClient;
}
