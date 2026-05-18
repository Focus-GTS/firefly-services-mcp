/**
 * Lightroom client factory — wires our TokenCache into the official SDK.
 *
 * Same pattern as firefly-client.ts and photoshop-client.ts.
 */
import { LightroomClient } from "@adobe/lightroom-apis";
import type { ClientConfig, TokenProvider } from "@adobe/firefly-services-sdk-core";
import type { Credentials } from "./credentials.js";
import type { TokenCache } from "./token-cache.js";

class TokenCacheAdapter implements TokenProvider {
  constructor(private readonly cache: TokenCache) {}
  async getToken(_env: string | undefined): Promise<string> {
    return this.cache.getToken();
  }
}

let cachedClient: LightroomClient | null = null;

export function getLightroomClient(creds: Credentials, tokenCache: TokenCache): LightroomClient {
  if (cachedClient) return cachedClient;
  const config: ClientConfig = {
    clientId: creds.clientId,
    tokenProvider: new TokenCacheAdapter(tokenCache),
  };
  cachedClient = new LightroomClient(config);
  return cachedClient;
}
