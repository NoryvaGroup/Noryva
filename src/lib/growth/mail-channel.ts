/**
 * Kundspecifik mailidentitet (avsändare + inbound-route).
 *
 * SÄKERHET: den här modulen hanterar ENDAST metadata. Inga lösenord, tokens,
 * API-nycklar eller SMTP-credentials lagras i databasen eller lämnas ut i API.
 * Credentials bor uteslutande i transportlagret (t.ex. Make-anslutningen).
 */

export type MailChannelStatus = "draft" | "verified" | "disabled";

export type MailChannel = {
  configured: boolean;
  verified: boolean;
  provider: string;
  senderEmail: string;
  senderName: string;
  replyToEmail: string;
  inboundRouteKey: string;
  connectionAlias: string;
  status: MailChannelStatus | "";
  verifiedAt: string | null;
};

/** Fail closed: utan rad finns ingen avsändaridentitet – aldrig någon fallback. */
export const EMPTY_MAIL_CHANNEL: MailChannel = {
  configured: false,
  verified: false,
  provider: "",
  senderEmail: "",
  senderName: "",
  replyToEmail: "",
  inboundRouteKey: "",
  connectionAlias: "",
  status: "",
  verifiedAt: null,
};

function readStatus(value: unknown): MailChannelStatus | "" {
  return value === "verified" || value === "draft" || value === "disabled" ? value : "";
}

/** Projicerar en databasrad till säker metadata. Släpper aldrig okända fält vidare. */
export function rowToMailChannel(row: Record<string, unknown> | null | undefined): MailChannel {
  if (!row) return EMPTY_MAIL_CHANNEL;
  const status = readStatus(row["status"]);
  const senderEmail = String(row["sender_email"] ?? "").trim();
  const replyToEmail = String(row["reply_to_email"] ?? "").trim();
  return {
    configured: true,
    verified: status === "verified" && senderEmail !== "" && replyToEmail !== "",
    provider: String(row["provider"] ?? "").trim(),
    senderEmail,
    senderName: String(row["sender_name"] ?? "").trim(),
    replyToEmail,
    inboundRouteKey: String(row["inbound_route_key"] ?? "").trim(),
    connectionAlias: String(row["connection_alias"] ?? "").trim(),
    status,
    verifiedAt: row["verified_at"] ? String(row["verified_at"]) : null,
  };
}

export type OutboundAllowance = { allowed: boolean; reason: string };

/**
 * Ren kontroll av om kunden HAR en giltig avsändaridentitet.
 * Skickar ingenting och aktiverar ingenting – utskick är fortsatt hårdspärrat.
 */
export function evaluateOutboundIdentity(channel: MailChannel): OutboundAllowance {
  if (!channel.configured) return { allowed: false, reason: "Ingen mailidentitet konfigurerad." };
  if (channel.status !== "verified") {
    return { allowed: false, reason: "Mailidentiteten är inte verifierad." };
  }
  if (!channel.senderEmail) return { allowed: false, reason: "Avsändaradress saknas." };
  if (!channel.replyToEmail) return { allowed: false, reason: "Svarsadress saknas." };
  return { allowed: true, reason: "" };
}
