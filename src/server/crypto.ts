import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Credentials of connections are stored encrypted (AES-256-GCM).
 * Format: v1.<iv>.<tag>.<ciphertext>, each part base64url.
 */

function keyFromEnv(): Buffer {
  const raw = env().ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("ENCRYPTION_KEY is not set (32 random bytes, base64). See .env.example.");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must decode to exactly 32 bytes.");
  return key;
}

export function encryptJson(value: unknown, key: Buffer = keyFromEnv()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv, tag, ciphertext]
    .map((p) => (typeof p === "string" ? p : p.toString("base64url")))
    .join(".");
}

export function decryptJson<T>(payload: string, key: Buffer = keyFromEnv()): T {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Unsupported ciphertext format");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

/** Signs short-lived values (OAuth state) so they cannot be forged. */
export function sign(value: string, key: Buffer = keyFromEnv()): string {
  const mac = createHmac("sha256", key).update(value).digest("base64url");
  return `${Buffer.from(value).toString("base64url")}.${mac}`;
}

export function verifySigned(token: string, key: Buffer = keyFromEnv()): string | null {
  const [encoded, mac] = token.split(".");
  if (!encoded || !mac) return null;
  const value = Buffer.from(encoded, "base64url").toString("utf8");
  const expected = createHmac("sha256", key).update(value).digest();
  const given = Buffer.from(mac, "base64url");
  return given.length === expected.length && timingSafeEqual(given, expected) ? value : null;
}
