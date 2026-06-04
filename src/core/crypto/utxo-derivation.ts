/**
 * Server-side UTXO key derivation for Moonlight Pay accounts.
 *
 * The client computes `utxoRoot` once at signup:
 *   utxoRoot = HKDF-SHA256(
 *     IKM  = masterSeed,
 *     salt = utf8("moonlight-pay"),
 *     info = utf8("moonlight-pay-utxo-v1"),
 *     L    = 32,
 *   )
 * and ships it encrypted (AES-256-GCM via encrypt-sk.ts) to pay-platform.
 *
 * Pay-platform decrypts the root on demand and derives the keypair at the
 * given index here. The masterSeed never reaches the backend.
 *
 *   seed_i     = SHA-256(utxoRoot ‖ utf8(i.toString()))
 *   expanded_i = HKDF-SHA256(IKM=seed_i, salt=∅, info="moonlight-p256", L=48)
 *   priv_i     = expanded_i[0:32]
 *   pub_i      = p256·G·priv_i      (uncompressed 65-byte: 0x04 ‖ X ‖ Y)
 */
import { p256 } from "@noble/curves/p256";

export const UTXO_ROOT_HKDF_SALT = "moonlight-pay";
export const UTXO_ROOT_HKDF_INFO = "moonlight-pay-utxo-v1";
const P256_HKDF_INFO = "moonlight-p256";

export interface UtxoKeypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

export async function deriveUtxoKeypair(
  utxoRoot: Uint8Array,
  index: number,
): Promise<UtxoKeypair> {
  const indexBytes = new TextEncoder().encode(index.toString());
  const seedInput = new Uint8Array(utxoRoot.length + indexBytes.length);
  seedInput.set(utxoRoot);
  seedInput.set(indexBytes, utxoRoot.length);

  const seed = new Uint8Array(
    await crypto.subtle.digest("SHA-256", seedInput),
  );

  const seedBuf = new ArrayBuffer(seed.length);
  new Uint8Array(seedBuf).set(seed);
  const expandKey = await crypto.subtle.importKey(
    "raw",
    seedBuf,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const expanded = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(P256_HKDF_INFO),
    },
    expandKey,
    384,
  );

  const privateKey = new Uint8Array(expanded).slice(0, 32);
  const publicKey = p256.ProjectivePoint.fromPrivateKey(privateKey)
    .toRawBytes(false);

  return { publicKey: new Uint8Array(publicKey), privateKey };
}

export async function deriveUtxoPublicKey(
  utxoRoot: Uint8Array,
  index: number,
): Promise<Uint8Array> {
  return (await deriveUtxoKeypair(utxoRoot, index)).publicKey;
}
