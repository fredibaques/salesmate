import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson, sign, verifySigned } from "./crypto";

describe("credential encryption", () => {
  it("round-trips JSON and uses a fresh IV each time", () => {
    const secret = { apiKey: "abc", nested: { n: 1 } };
    const a = encryptJson(secret);
    const b = encryptJson(secret);
    expect(a).not.toBe(b);
    expect(decryptJson(a)).toEqual(secret);
  });

  it("detects tampering and wrong keys", () => {
    const token = encryptJson({ x: 1 });
    const parts = token.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptJson(parts.join("."))).toThrow();
    expect(() => decryptJson(token, randomBytes(32))).toThrow();
  });

  it("signs and verifies short values", () => {
    const token = sign("org-1:user-1");
    expect(verifySigned(token)).toBe("org-1:user-1");
    expect(verifySigned(token.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).toBeNull();
  });
});
