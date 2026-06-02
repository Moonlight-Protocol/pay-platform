/**
 * PrivacyChannel client factory + cache.
 *
 * Mirrors provider-platform's channel-client. Caches one PrivacyChannel per
 * channelContractId so on-chain reads (utxo_balances et al) skip the
 * constructor cost on every request.
 */
import { NetworkConfig } from "@colibri/core";
import { PrivacyChannel } from "@moonlight/moonlight-sdk";
import { STELLAR_NETWORK_PASSPHRASE, STELLAR_RPC_URL } from "@/config/env.ts";

const MAX_CACHE_SIZE = 100;
const channelCache = new Map<string, PrivacyChannel>();

function buildNetworkConfig(): NetworkConfig {
  const horizonUrl = STELLAR_RPC_URL.includes("/soroban/rpc")
    ? STELLAR_RPC_URL.replace("/soroban/rpc", "")
    : STELLAR_RPC_URL;
  return NetworkConfig.CustomNet({
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    rpcUrl: STELLAR_RPC_URL,
    horizonUrl,
    allowHttp: STELLAR_RPC_URL.startsWith("http://"),
  });
}

export function getChannelClient(
  channelContractId: string,
  channelAuthId: string,
  assetContractId: string,
): PrivacyChannel {
  const cached = channelCache.get(channelContractId);
  if (cached) return cached;

  if (channelCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = channelCache.keys().next().value;
    if (oldestKey !== undefined) channelCache.delete(oldestKey);
  }

  const client = new PrivacyChannel(
    buildNetworkConfig(),
    channelContractId as `C${string}`,
    channelAuthId as `C${string}`,
    assetContractId as `C${string}`,
  );
  channelCache.set(channelContractId, client);
  return client;
}

export function clearChannelCache(): void {
  channelCache.clear();
}
