/**
 * Photoshop client factory — wires our TokenCache into the official SDK.
 *
 * Same pattern as firefly-client.ts: adapt our TokenCache to the SDK's
 * TokenProvider interface so the SDK uses a single source of truth for
 * token lifecycle.
 */
import { PhotoshopClient } from "@adobe/photoshop-apis";
import type { ClientConfig, TokenProvider } from "@adobe/firefly-services-sdk-core";
import type { Credentials } from "./credentials.js";
import type { TokenCache } from "./token-cache.js";

class TokenCacheAdapter implements TokenProvider {
  constructor(private readonly cache: TokenCache) {}
  async getToken(_env: string | undefined): Promise<string> {
    return this.cache.getToken();
  }
}

let cachedClient: PhotoshopClient | null = null;

export function getPhotoshopClient(creds: Credentials, tokenCache: TokenCache): PhotoshopClient {
  if (cachedClient) return cachedClient;
  const config: ClientConfig = {
    clientId: creds.clientId,
    tokenProvider: new TokenCacheAdapter(tokenCache),
  };
  cachedClient = new PhotoshopClient(config);
  return cachedClient;
}
