import { requireEnv } from "@/utils/env/loadEnv.ts";
import { loadOptionalEnv } from "@/utils/env/loadEnv.ts";
import { selectNetwork } from "@/config/network.ts";
import * as E from "@/config/error.ts";

export const DATABASE_URL = requireEnv("DATABASE_URL");
export const PORT = requireEnv("PORT");
export const MODE = requireEnv("MODE");
export const SERVICE_DOMAIN = requireEnv("SERVICE_DOMAIN");
export const SERVICE_AUTH_SECRET = requireEnv("SERVICE_AUTH_SECRET");

export const CHALLENGE_TTL = Number(requireEnv("CHALLENGE_TTL"));
export const SESSION_TTL = Number(requireEnv("SESSION_TTL"));

/** Stellar secret key for authenticating with provider-platform. */
export const PAY_SERVICE_SK = loadOptionalEnv("PAY_SERVICE_SK");

/**
 * Network selection, matching provider-platform and council-platform: the
 * network is its own axis, not a consequence of MODE. MODE describes the
 * deployment (production hardening, development conveniences); NETWORK
 * describes which Stellar network is being talked to. Deriving one from the
 * other made the testnet deployment, which runs MODE=production, resolve to
 * the mainnet passphrase and to a Horizon URL that does not exist.
 */
export const { NETWORK_CONFIG, NETWORK } = selectNetwork(requireEnv("NETWORK"));

/**
 * `NetworkConfig` types these as optional, but `selectNetwork` sets all three
 * for every branch it returns. Narrow once here so call sites get plain
 * strings, and fail at boot rather than at the first request if that ever
 * stops being true.
 */
function required(value: string | undefined, _field: string): string {
  if (!value) throw new E.INVALID_NETWORK();
  return value;
}

/** Stellar/Soroban RPC endpoint for on-chain operations. */
export const STELLAR_RPC_URL = required(NETWORK_CONFIG.rpcUrl, "rpcUrl");

/** Horizon endpoint. Distinct host from the RPC on testnet and mainnet. */
export const HORIZON_URL = required(NETWORK_CONFIG.horizonUrl, "horizonUrl");

export const STELLAR_NETWORK_PASSPHRASE = required(
  NETWORK_CONFIG.networkPassphrase,
  "networkPassphrase",
);
