import { describe, expect, it } from "vitest";
import {
  buildInboundEventKey,
  computeSignature,
  createHmacVerifier,
  decideInbound,
} from "./webhook-security";

const secret = "test-secret";
const now = new Date("2026-02-01T12:00:00Z");
const ts = String(Math.floor(now.getTime() / 1000));
const body = JSON.stringify({ hello: "world" });

const verifier = createHmacVerifier({ source: "mock", secret });

describe("signaturverifiering", () => {
  it("godkänner korrekt signatur", () => {
    const sig = computeSignature(secret, ts, body);
    expect(verifier.verify(body, { "x-signature": sig, "x-timestamp": ts }, now).valid).toBe(true);
  });

  it("avvisar felaktig signatur", () => {
    const check = verifier.verify(body, { "x-signature": "fel", "x-timestamp": ts }, now);
    expect(check.valid).toBe(false);
  });

  it("avvisar för gamla anrop (replay)", () => {
    const oldTs = String(Math.floor(now.getTime() / 1000) - 3600);
    const sig = computeSignature(secret, oldTs, body);
    const check = verifier.verify(body, { "x-signature": sig, "x-timestamp": oldTs }, now);
    expect(check.valid).toBe(false);
    expect(check.reason).toMatch(/replay/);
  });

  it("kräver signatur och tidsstämpel", () => {
    expect(verifier.verify(body, {}, now).valid).toBe(false);
  });
});

describe("dubbletthantering", () => {
  it("bygger stabil nyckel", () => {
    expect(buildInboundEventKey("mock", "abc")).toBe("mock:abc");
  });

  it("avvisar redan behandlade anrop", () => {
    const ok = { valid: true, reason: "" };
    expect(decideInbound(ok, false).accept).toBe(true);
    expect(decideInbound(ok, true)).toMatchObject({ accept: false, duplicate: true });
    expect(decideInbound({ valid: false, reason: "x" }, false).accept).toBe(false);
  });
});
