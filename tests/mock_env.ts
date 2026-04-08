/**
 * Mock env module for API integration tests.
 *
 * Replaces @/config/env.ts (via tests/deno.json import map) so tests don't
 * need a .env file. Pay-platform's env surface is INFRA + OPERATIONAL only —
 * no Stellar network config, no contract IDs.
 *
 * Test fixtures (keypairs used to sign auth challenges, etc.) are kept here
 * with the _TEST_ prefix so it's clear they're test-only and not part of the
 * env-vs-mock surface.
 */
import { Keypair } from "stellar-sdk";

// Fixed test keypair — deterministic so signature outputs are reproducible.
const walletKeypair = Keypair.fromSecret("SBPCP2AQ63VWALVCJTV63UYBFWDTQWCURW2PG74XWXGK4CFMQZIBRYK5");

export const DATABASE_URL = "mock://not-used-pglite-replaces-this";
export const PORT = "0";
export const MODE = "development";
export const SERVICE_DOMAIN = "test.pay.local";
export const SERVICE_AUTH_SECRET = "test-secret-for-tests";

export const CHALLENGE_TTL = 300;
export const SESSION_TTL = 3600;

// Test fixture — used by api tests to sign SEP-43/53 challenges.
export const _TEST_WALLET_KEYPAIR = walletKeypair;
