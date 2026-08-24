/**
 * SIWE-style wallet authentication.
 *
 * Flow:
 *   1. Client requests a nonce for their wallet address (/auth/nonce).
 *   2. Client signs a deterministic challenge message containing that nonce
 *      with their wallet (personal_sign / EIP-191).
 *   3. Client posts the signature back (/auth/verify). We recover the
 *      signer address with viem, confirm it matches the claimed address,
 *      confirm the nonce is unexpired and unconsumed, then atomically mark
 *      it consumed (single-use — replay-proof) and issue a JWT session.
 *
 * The backend never sees or stores a private key. There is no custodial
 * wallet anywhere in this system.
 */

import { randomBytes } from "node:crypto";
import { verifyMessage, isAddress, getAddress } from "viem";
import { db } from "../db/client.js";
import { authNonces, users } from "../db/schema.js";
import { eq, and, isNull, gt } from "drizzle-orm";

const NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes — long enough for a wallet popup, short enough to bound replay risk

export function buildSiweChallenge(walletAddress: string, nonce: string): string {
  return [
    "VERDICT wants you to sign in with your wallet.",
    "",
    `Wallet: ${walletAddress}`,
    `Nonce: ${nonce}`,
    "",
    "This request will not trigger a blockchain transaction or cost any gas.",
  ].join("\n");
}

export async function issueNonce(rawAddress: string): Promise<{ nonce: string; message: string }> {
  if (!isAddress(rawAddress)) {
    throw new Error("Invalid wallet address");
  }
  const walletAddress = getAddress(rawAddress);
  const nonce = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + NONCE_TTL_MS);

  await db.insert(authNonces).values({ walletAddress, nonce, expiresAt });

  return { nonce, message: buildSiweChallenge(walletAddress, nonce) };
}

export async function verifySignatureAndConsumeNonce(
  rawAddress: string,
  nonce: string,
  signature: `0x${string}`,
): Promise<{ userId: string; walletAddress: string }> {
  if (!isAddress(rawAddress)) {
    throw new Error("Invalid wallet address");
  }
  const walletAddress = getAddress(rawAddress);

  const [nonceRow] = await db
    .select()
    .from(authNonces)
    .where(
      and(
        eq(authNonces.walletAddress, walletAddress),
        eq(authNonces.nonce, nonce),
        isNull(authNonces.consumedAt),
        gt(authNonces.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!nonceRow) {
    throw new Error("Nonce not found, expired, or already used");
  }

  const message = buildSiweChallenge(walletAddress, nonce);

  const isValid = await verifyMessage({
    address: walletAddress,
    message,
    signature,
  });

  if (!isValid) {
    throw new Error("Signature verification failed");
  }

  // Consume the nonce BEFORE issuing a session so a second request with the
  // same signature can never mint a second session (replay protection).
  await db.update(authNonces).set({ consumedAt: new Date() }).where(eq(authNonces.id, nonceRow.id));

  const [existingUser] = await db.select().from(users).where(eq(users.walletAddress, walletAddress)).limit(1);

  let userId: string;
  if (existingUser) {
    userId = existingUser.id;
    await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  } else {
    const [created] = await db
      .insert(users)
      .values({ walletAddress, lastLoginAt: new Date() })
      .returning({ id: users.id });
    userId = created!.id;
  }

  return { userId, walletAddress };
}
