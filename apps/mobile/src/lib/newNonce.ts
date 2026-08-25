import * as Crypto from "expo-crypto";

/** Collision-safe id for nonces / optimistic message ids (RN-safe, no PRNG detection). */
export function newNonce(): string {
  return Crypto.randomUUID();
}
