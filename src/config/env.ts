import { requireEnv } from "@/utils/env/loadEnv.ts";
import { loadOptionalEnv } from "@/utils/env/loadEnv.ts";

export const DATABASE_URL = requireEnv("DATABASE_URL");
export const PORT = requireEnv("PORT");
export const MODE = requireEnv("MODE");
export const SERVICE_DOMAIN = requireEnv("SERVICE_DOMAIN");
export const SERVICE_AUTH_SECRET = requireEnv("SERVICE_AUTH_SECRET");

export const CHALLENGE_TTL = Number(requireEnv("CHALLENGE_TTL"));
export const SESSION_TTL = Number(requireEnv("SESSION_TTL"));

/** Stellar secret key for authenticating with provider-platform. */
export const PAY_SERVICE_SK = loadOptionalEnv("PAY_SERVICE_SK");

/** Stellar/Soroban RPC endpoint for on-chain operations. */
export const STELLAR_RPC_URL = requireEnv("STELLAR_RPC_URL");

/** Network passphrase derived from MODE. */
export const STELLAR_NETWORK_PASSPHRASE = (() => {
  switch (MODE) {
    case "production":
      return "Public Global Stellar Network ; September 2015";
    case "development":
      return "Standalone Network ; February 2017";
    default:
      return "Test SDF Network ; September 2015";
  }
})();
