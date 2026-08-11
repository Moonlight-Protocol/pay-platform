/**
 * PrivacyChannel client factory + cache.
 *
 * Mirrors provider-platform's channel-client. Caches one PrivacyChannel per
 * channelContractId so on-chain reads (utxo_balances et al) skip the
 * constructor cost on every request.
 */
import type { NetworkConfig } from "@colibri/core";
import { PrivacyChannel } from "@moonlight/moonlight-sdk";
import { NETWORK_CONFIG } from "@/config/env.ts";

const MAX_CACHE_SIZE = 100;
const channelCache = new Map<string, PrivacyChannel>();

function buildNetworkConfig(): NetworkConfig {
  return NETWORK_CONFIG;
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
