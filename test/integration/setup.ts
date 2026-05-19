/**
 * Shared MSW server setup for HTTP-layer mocked integration tests.
 *
 * These integration tests verify that the real Adobe SDK code paths produce
 * the right HTTPS requests and correctly parse the corresponding responses.
 * Unlike the unit tests under test/unit/ — which mock the SDK at the
 * method-call level — these tests mock the HTTP layer underneath the SDK
 * using MSW (Mock Service Worker, Node mode).
 *
 * The interceptor covers three host families:
 *   - https://ims-na1.adobelogin.com/* — Adobe IMS token endpoint, used by
 *     src/auth/token-cache.ts on first call.
 *   - https://firefly-api.adobe.io/*  — Firefly Services Firefly API base.
 *   - https://image.adobe.io/*        — Photoshop + Lightroom API base.
 *
 * Per-test files override the default handlers via `server.use(...)` to
 * assert on specific request shapes and respond with realistic SDK
 * response payloads.
 *
 * Lifecycle is intentionally NOT wired via vitest's setupFiles — each
 * integration test file calls `beforeAll(server.listen)` and friends
 * itself so unit tests stay hermetic and free of MSW overhead.
 */
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

export const IMS_TOKEN_URL = "https://ims-na1.adobelogin.com/ims/token/v3";
export const FIREFLY_API_BASE = "https://firefly-api.adobe.io";
export const IMAGE_API_BASE = "https://image.adobe.io";

/** Fake IMS access token returned by the default token handler. */
export const FAKE_IMS_TOKEN = "msw-fake-ims-token-1234567890abcdef";

/**
 * Default handlers — broad, permissive matchers so we never hit the real
 * network even if a test forgets to register a specific handler. A test
 * that wants to assert on request shape will install a more specific
 * handler via `server.use(...)` which takes priority.
 *
 * The IMS handler is intentionally generous (always returns a valid
 * token) because TokenCache will hit it once on first getToken() and
 * we don't want test files to need to know about that detail.
 */
const defaultHandlers = [
  // Adobe IMS — server-to-server token exchange.
  http.post(IMS_TOKEN_URL, () => {
    return HttpResponse.json({
      access_token: FAKE_IMS_TOKEN,
      token_type: "bearer",
      expires_in: 86399,
    });
  }),

  // Firefly API catch-all. Tests should override this with specific paths.
  http.all(`${FIREFLY_API_BASE}/*`, ({ request }) => {
    return new HttpResponse(
      JSON.stringify({
        error: "unmocked-firefly-endpoint",
        message: `Test reached ${request.method} ${request.url} but no handler was registered.`,
      }),
      { status: 599, headers: { "Content-Type": "application/json" } },
    );
  }),

  // Photoshop + Lightroom API catch-all (both live under image.adobe.io).
  http.all(`${IMAGE_API_BASE}/*`, ({ request }) => {
    return new HttpResponse(
      JSON.stringify({
        error: "unmocked-image-endpoint",
        message: `Test reached ${request.method} ${request.url} but no handler was registered.`,
      }),
      { status: 599, headers: { "Content-Type": "application/json" } },
    );
  }),
];

/** The shared MSW server instance. Tests import this directly. */
export const server = setupServer(...defaultHandlers);

/**
 * Convenience installer — register MSW lifecycle hooks for a test file.
 *
 * `onUnhandledRequest: "error"` makes any unmocked outbound request fail
 * loudly. The default catch-all handlers above ensure the assertions
 * still produce a structured tool error (vs an opaque network failure)
 * so the test output stays readable.
 */
export function installMswLifecycle(opts: {
  beforeAll: (fn: () => void | Promise<void>) => void;
  afterEach: (fn: () => void | Promise<void>) => void;
  afterAll: (fn: () => void | Promise<void>) => void;
}): void {
  opts.beforeAll(() => {
    server.listen({ onUnhandledRequest: "error" });
  });
  opts.afterEach(() => {
    server.resetHandlers();
  });
  opts.afterAll(() => {
    server.close();
  });
}

/**
 * Build a TokenCache wired against the MSW-mocked IMS endpoint. All
 * integration tests share the same fake credential set — there is no
 * real client_id / client_secret leakage because MSW intercepts the
 * fetch before it leaves the process.
 */
export function fakeCredentials() {
  return {
    clientId: "msw-fake-client-id",
    clientSecret: "msw-fake-client-secret",
    scopes: ["firefly_api", "ff_apis"],
  };
}

export { http, HttpResponse };
