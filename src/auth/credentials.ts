/**
 * Credentials — env-var loading.
 *
 * Per ADR-003, v0.1 ships single-credential-per-server-instance.
 * Credentials are read from environment variables at startup and not refreshed
 * during the process lifetime.
 */

export interface Credentials {
  clientId: string;
  clientSecret: string;
  /** Optional comma-separated scope override. Defaults to the canonical FFS scope set. */
  scopes: string[];
}

const DEFAULT_SCOPES = [
  "openid",
  "AdobeID",
  "session",
  "additional_info",
  "read_organizations",
  "firefly_api",
  "ff_apis",
  "firefly_enterprise",
  "creative_sdk",
];

export class MissingCredentialsError extends Error {
  constructor(missing: string[]) {
    super(
      `Missing required environment variable(s): ${missing.join(", ")}.\n\n` +
        "Set FIREFLY_SERVICES_CLIENT_ID and FIREFLY_SERVICES_CLIENT_SECRET to a valid OAuth Server-to-Server credential pair issued via the Adobe Developer Console.",
    );
    this.name = "MissingCredentialsError";
  }
}

export function loadCredentials(): Credentials {
  const clientId = process.env.FIREFLY_SERVICES_CLIENT_ID;
  const clientSecret = process.env.FIREFLY_SERVICES_CLIENT_SECRET;
  const scopesRaw = process.env.FIREFLY_SERVICES_SCOPES;

  const missing: string[] = [];
  if (!clientId) missing.push("FIREFLY_SERVICES_CLIENT_ID");
  if (!clientSecret) missing.push("FIREFLY_SERVICES_CLIENT_SECRET");
  if (missing.length > 0) {
    throw new MissingCredentialsError(missing);
  }

  return {
    clientId: clientId!,
    clientSecret: clientSecret!,
    scopes: scopesRaw ? scopesRaw.split(",").map(s => s.trim()).filter(Boolean) : DEFAULT_SCOPES,
  };
}
