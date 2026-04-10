import { assertEquals } from "@std/assert";
import {
  validateDisplayName,
  validateEmail,
  validateJurisdiction,
} from "./helpers.ts";

Deno.test("validateEmail accepts a normal address", () => {
  assertEquals(validateEmail("alice@example.com"), null);
});

Deno.test("validateEmail rejects non-string", () => {
  assertEquals(validateEmail(42), "email must be a string");
  assertEquals(validateEmail(undefined), "email must be a string");
  assertEquals(validateEmail(null), "email must be a string");
});

Deno.test("validateEmail rejects empty string", () => {
  assertEquals(validateEmail(""), "email is required");
});

Deno.test("validateEmail rejects an address over 254 chars", () => {
  const local = "a".repeat(245);
  const tooLong = `${local}@x.io`; // 245 + 5 = 250 ok
  assertEquals(validateEmail(tooLong), null);
  const overLimit = `${local}@xxxxxxx.io`; // 245 + 11 = 256 too long
  assertEquals(
    validateEmail(overLimit),
    "email must be at most 254 characters",
  );
});

Deno.test("validateEmail rejects malformed strings", () => {
  for (const bad of ["plain", "no@dot", "@x.io", "a@b", "spaces in@x.io"]) {
    assertEquals(
      validateEmail(bad),
      "email is not a valid format",
      `expected reject: ${bad}`,
    );
  }
});

Deno.test("validateJurisdiction accepts ISO 3166-1 alpha-2 uppercase", () => {
  for (const code of ["US", "AR", "ES", "GB", "JP"]) {
    assertEquals(validateJurisdiction(code), null);
  }
});

Deno.test("validateJurisdiction rejects lowercase (handler normalizes after validation)", () => {
  // Validator is intentionally strict — handler does not pre-normalize.
  // See post.ts: validation runs before .toUpperCase().
  assertEquals(
    validateJurisdiction("us"),
    "jurisdictionCountryCode must be an ISO 3166-1 alpha-2 code (e.g. ES, AR, US)",
  );
});

Deno.test("validateJurisdiction rejects wrong length", () => {
  for (const bad of ["U", "USA", "", "U S"]) {
    assertEquals(
      validateJurisdiction(bad),
      "jurisdictionCountryCode must be an ISO 3166-1 alpha-2 code (e.g. ES, AR, US)",
    );
  }
});

Deno.test("validateJurisdiction rejects non-string", () => {
  assertEquals(
    validateJurisdiction(123),
    "jurisdictionCountryCode must be a string",
  );
});

Deno.test("validateDisplayName accepts null and undefined (optional field)", () => {
  assertEquals(validateDisplayName(null), null);
  assertEquals(validateDisplayName(undefined), null);
});

Deno.test("validateDisplayName accepts a normal name", () => {
  assertEquals(validateDisplayName("Alice"), null);
});

Deno.test("validateDisplayName rejects non-string when present", () => {
  assertEquals(validateDisplayName(42), "displayName must be a string");
});

Deno.test("validateDisplayName rejects names over 100 chars", () => {
  assertEquals(validateDisplayName("a".repeat(100)), null);
  assertEquals(
    validateDisplayName("a".repeat(101)),
    "displayName must be at most 100 characters",
  );
});
