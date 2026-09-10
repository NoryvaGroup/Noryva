import { describe, expect, it } from "vitest";
import {
  EMPTY_MAIL_CHANNEL,
  evaluateOutboundIdentity,
  rowToMailChannel,
} from "./mail-channel";

const VERIFIED_ROW = {
  provider: "smtp",
  sender_email: "no-reply@kund.se",
  sender_name: "Kund AB",
  reply_to_email: "svar@kund.se",
  inbound_route_key: "route-abc",
  connection_alias: "kund-smtp",
  status: "verified",
  verified_at: "2026-09-01T10:00:00Z",
};

describe("mail channel", () => {
  it("saknad rad ger fail closed utan fallback", () => {
    const ch = rowToMailChannel(null);
    expect(ch).toEqual(EMPTY_MAIL_CHANNEL);
    expect(ch.configured).toBe(false);
    expect(ch.verified).toBe(false);
    expect(ch.senderEmail).toBe("");
    expect(JSON.stringify(ch)).not.toMatch(/noryva/i);
  });

  it("verifierad rad ger säker metadata", () => {
    const ch = rowToMailChannel(VERIFIED_ROW);
    expect(ch).toEqual({
      configured: true,
      verified: true,
      provider: "smtp",
      senderEmail: "no-reply@kund.se",
      senderName: "Kund AB",
      replyToEmail: "svar@kund.se",
      inboundRouteKey: "route-abc",
      connectionAlias: "kund-smtp",
      status: "verified",
      verifiedAt: "2026-09-01T10:00:00Z",
    });
  });

  it("draft/disabled eller ofullständig rad är aldrig verifierad", () => {
    expect(rowToMailChannel({ ...VERIFIED_ROW, status: "draft" }).verified).toBe(false);
    expect(rowToMailChannel({ ...VERIFIED_ROW, status: "disabled" }).verified).toBe(false);
    expect(rowToMailChannel({ ...VERIFIED_ROW, sender_email: "" }).verified).toBe(false);
    expect(rowToMailChannel({ ...VERIFIED_ROW, reply_to_email: "" }).verified).toBe(false);
  });

  it("släpper aldrig igenom credential-liknande fält", () => {
    const ch = rowToMailChannel({
      ...VERIFIED_ROW,
      password: "hemligt",
      api_key: "nyckel",
      smtp_token: "token",
    } as Record<string, unknown>);
    expect(JSON.stringify(ch)).not.toMatch(/hemligt|nyckel|token/i);
  });

  it("outbound tillåts endast med verifierad identitet", () => {
    expect(evaluateOutboundIdentity(rowToMailChannel(VERIFIED_ROW)).allowed).toBe(true);
    expect(evaluateOutboundIdentity(EMPTY_MAIL_CHANNEL)).toEqual({
      allowed: false,
      reason: "Ingen mailidentitet konfigurerad.",
    });
    expect(
      evaluateOutboundIdentity(rowToMailChannel({ ...VERIFIED_ROW, status: "draft" })).allowed,
    ).toBe(false);
    expect(
      evaluateOutboundIdentity(rowToMailChannel({ ...VERIFIED_ROW, reply_to_email: "" })).reason,
    ).toMatch(/Svarsadress/);
  });
});
