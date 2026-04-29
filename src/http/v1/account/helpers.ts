/**
 * Helpers for validating account fields.
 *
 * UC3 keeps validation light: format checks at the API boundary, no third-party
 * verification (no email confirmation, no jurisdiction lookup against an external
 * registry). Stronger guarantees are added in later UCs as needed.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ISO 3166-1 alpha-2: two uppercase letters.
const COUNTRY_CODE_RE = /^[A-Z]{2}$/;

const MAX_EMAIL_LENGTH = 254;
const MAX_DISPLAY_NAME_LENGTH = 100;

export function validateEmail(value: unknown): string | null {
  if (typeof value !== "string") return "email must be a string";
  if (value.length === 0) return "email is required";
  if (value.length > MAX_EMAIL_LENGTH) {
    return `email must be at most ${MAX_EMAIL_LENGTH} characters`;
  }
  if (!EMAIL_RE.test(value)) return "email is not a valid format";
  return null;
}

export function validateJurisdiction(value: unknown): string | null {
  if (typeof value !== "string") {
    return "jurisdictionCountryCode must be a string";
  }
  if (!COUNTRY_CODE_RE.test(value)) {
    return "jurisdictionCountryCode must be an ISO 3166-1 alpha-2 code (e.g. ES, AR, US)";
  }
  return null;
}

export function validateDisplayName(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return "displayName must be a string";
  if (value.length > MAX_DISPLAY_NAME_LENGTH) {
    return `displayName must be at most ${MAX_DISPLAY_NAME_LENGTH} characters`;
  }
  return null;
}
