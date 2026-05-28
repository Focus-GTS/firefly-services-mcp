/**
 * TokenCache — IMS error redaction tests.
 *
 * Uses MSW to fake the Adobe IMS token endpoint with various error response
 * shapes (echoed client_id, fragments of submitted client_secret, non-JSON
 * bodies) and verifies that the logger output and thrown Error message
 * contain only the OAuth-standard `error` / `error_description` envelope
 * fields — never the raw body, never the secret.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { TokenCache } from "../../../src/auth/token-cache.js";
import { logger } from "../../../src/util/logger.js";

const IMS_TOKEN_URL = "https://ims-na1.adobelogin.com/ims/token/v3";

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function fakeCreds() {
  return {
    clientId: "client-id-VERY-SECRET",
    clientSecret: "client-secret-DO-NOT-LEAK",
    scopes: ["firefly_api", "ff_apis"],
  };
}

/**
 * Spy on the pino logger's error sink so we can assert exactly what was
 * passed to logger.error(). We replace the bound `error` method on the
 * singleton logger and restore in afterEach.
 */
function spyOnLoggerError() {
  const original = logger.error.bind(logger);
  const spy = vi.fn();
  // Cast through unknown to satisfy pino's overloaded signature.
  (logger as unknown as { error: (...args: unknown[]) => void }).error = ((
    ...args: unknown[]
  ) => {
    spy(...args);
    // Don't actually emit; tests don't need the stderr noise.
  }) as unknown as typeof logger.error;
  return {
    spy,
    restore: () => {
      (logger as unknown as { error: typeof logger.error }).error = original;
    },
  };
}

describe("TokenCache.refresh — IMS error body redaction", () => {
  it("logs only `error` and `error_description` from a structured IMS error", async () => {
    server.use(
      http.post(IMS_TOKEN_URL, () =>
        HttpResponse.json(
          {
            error: "invalid_client",
            error_description: "Client authentication failed",
            // These would-be-leaked fields MUST NOT appear in the log.
            client_id: "client-id-VERY-SECRET",
            client_secret: "client-secret-DO-NOT-LEAK",
            details: { grant_type: "client_credentials" },
          },
          { status: 401 },
        ),
      ),
    );

    const { spy, restore } = spyOnLoggerError();
    const cache = new TokenCache(fakeCreds());

    try {
      await expect(cache.getToken()).rejects.toThrow(/IMS token refresh failed/);

      // logger.error was called with (logObj, message)
      expect(spy).toHaveBeenCalled();
      const [logObj] = spy.mock.calls[0]!;
      const serialised = JSON.stringify(logObj);

      // Standard OAuth envelope fields surface.
      expect(serialised).toContain("invalid_client");
      expect(serialised).toContain("Client authentication failed");

      // Secrets and non-standard fields are dropped.
      expect(serialised).not.toContain("client-secret-DO-NOT-LEAK");
      expect(serialised).not.toContain("client-id-VERY-SECRET");
      expect(serialised).not.toContain("grant_type");
    } finally {
      restore();
    }
  });

  it("logs a fixed marker when the IMS body is not valid JSON", async () => {
    const nonJsonBody =
      "HTML error page leaking client_secret=client-secret-DO-NOT-LEAK in some random string";
    server.use(
      http.post(IMS_TOKEN_URL, () =>
        new HttpResponse(nonJsonBody, { status: 500 }),
      ),
    );

    const { spy, restore } = spyOnLoggerError();
    const cache = new TokenCache(fakeCreds());

    try {
      await expect(cache.getToken()).rejects.toThrow(/IMS token refresh failed/);

      const [logObj] = spy.mock.calls[0]!;
      const serialised = JSON.stringify(logObj);

      // The redaction marker is present.
      expect(serialised).toContain("<non-JSON IMS error body redacted>");
      // The raw body and the leaked secret never surface.
      expect(serialised).not.toContain("client-secret-DO-NOT-LEAK");
      expect(serialised).not.toContain("HTML error page");
    } finally {
      restore();
    }
  });

  it("does not leak the raw body in the thrown Error message", async () => {
    server.use(
      http.post(IMS_TOKEN_URL, () =>
        new HttpResponse(
          "garbage body with embedded client_secret=client-secret-DO-NOT-LEAK",
          { status: 500 },
        ),
      ),
    );

    const cache = new TokenCache(fakeCreds());
    try {
      await cache.getToken();
      expect.fail("expected getToken to throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("IMS token refresh failed");
      expect(msg).not.toContain("client-secret-DO-NOT-LEAK");
      expect(msg).not.toContain("garbage body");
    }
  });

  it("does not leak echoed client_id / client_secret in the thrown Error", async () => {
    server.use(
      http.post(IMS_TOKEN_URL, () =>
        HttpResponse.json(
          {
            error: "invalid_grant",
            error_description: "Bad creds",
            client_id: "client-id-VERY-SECRET",
            client_secret: "client-secret-DO-NOT-LEAK",
          },
          { status: 400 },
        ),
      ),
    );

    const cache = new TokenCache(fakeCreds());
    try {
      await cache.getToken();
      expect.fail("expected throw");
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("invalid_grant");
      expect(msg).toContain("Bad creds");
      expect(msg).not.toContain("client-secret-DO-NOT-LEAK");
      expect(msg).not.toContain("client-id-VERY-SECRET");
    }
  });
});

describe("TokenCache.refresh — happy path still works", () => {
  it("returns a token on 200", async () => {
    server.use(
      http.post(IMS_TOKEN_URL, () =>
        HttpResponse.json({
          access_token: "fake-token-ok",
          token_type: "bearer",
          expires_in: 3600,
        }),
      ),
    );

    const cache = new TokenCache(fakeCreds());
    const token = await cache.getToken();
    expect(token).toBe("fake-token-ok");
  });
});

describe("TokenCache.invalidate", () => {
  it("forces the next getToken to hit IMS again", async () => {
    let calls = 0;
    server.use(
      http.post(IMS_TOKEN_URL, () => {
        calls += 1;
        return HttpResponse.json({
          access_token: `token-${calls}`,
          expires_in: 3600,
        });
      }),
    );

    const cache = new TokenCache(fakeCreds());
    expect(await cache.getToken()).toBe("token-1");
    // Cached — no new request.
    expect(await cache.getToken()).toBe("token-1");
    expect(calls).toBe(1);

    cache.invalidate();
    expect(await cache.getToken()).toBe("token-2");
    expect(calls).toBe(2);
  });
});
