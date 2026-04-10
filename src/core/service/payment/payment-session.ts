/**
 * In-memory payment session store.
 *
 * Between prepare and submit, pay-platform holds:
 * - The temporary P256 keypairs (used to SPEND on behalf of the customer)
 * - The pre-built MLXDR operations (minus the customer's deposit signature)
 * - The merchant's receive UTXO IDs (to mark as RESERVED/SPENT)
 *
 * Sessions expire after 5 minutes if not submitted.
 */
import { LOG } from "@/config/logger.ts";

const SESSION_TTL_MS = 5 * 60 * 1000;

export interface PaymentSession {
  id: string;
  customerWallet: string;
  merchantWallet: string;
  amountStroops: bigint;
  feeStroops: bigint;
  /** Council ID from the councils table. */
  councilId: string;
  /** Privacy provider URL to submit the bundle to. */
  ppUrl: string;
  /** The privacy channel contract ID. */
  privacyChannelId: string;
  /** The channel auth contract ID. */
  channelAuthId: string;
  /** The asset contract ID (e.g. native XLM SAC). */
  assetId: string;
  /** Network passphrase for the council's network. */
  networkPassphrase: string;
  /** Temporary P256 private keys (hex) for the SPEND operations. */
  tempPrivateKeys: string[];
  /** Temporary P256 public keys (base64) for the CREATE operations. */
  tempPublicKeys: string[];
  /** Pre-built MLXDR operations (everything except the deposit auth). */
  operationsMLXDR: string[];
  /** The deposit auth entry hash the customer needs to sign. */
  depositAuthHash: string;
  /** Merchant receive UTXO IDs to mark as SPENT on success. */
  merchantUtxoIds: string[];
  /** Description from the POS link. */
  description: string | null;
  createdAt: number;
}

const sessions = new Map<string, PaymentSession>();

export function createSession(session: PaymentSession): void {
  sessions.set(session.id, session);
  LOG.debug("Payment session created", { id: session.id });
}

export function getSession(id: string): PaymentSession | undefined {
  const session = sessions.get(id);
  if (!session) return undefined;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    sessions.delete(id);
    LOG.debug("Payment session expired", { id });
    return undefined;
  }
  return session;
}

export function deleteSession(id: string): void {
  sessions.delete(id);
}

// Cleanup expired sessions every minute
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}, 60_000);
