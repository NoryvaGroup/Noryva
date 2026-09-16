/**
 * Tester för 24h-påminnelser: due-listan samt claim/complete/fail.
 * Ingen riktig databas, inga nätverksanrop, inga mail – Supabase är en stub
 * som simulerar de atomiska SQL-funktionerna.
 */
import { describe, expect, it } from "vitest";
import {
  claimLeadReminderCore,
  completeLeadReminderCore,
  dueLeadRemindersCore,
  failLeadReminderCore,
  REMINDER_KIND,
} from "./lead-reminders.server";

const NOW = new Date("2026-09-10T12:00:00.000Z");
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";
const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const ENV = { NORYVA_LEAD_ACTION_SECRET: "action-secret" } as Record<string, string>;

type Row = Record<string, any>;

function iso(minutesAgo: number) {
  return new Date(NOW.getTime() - minutesAgo * 60_000).toISOString();
}

function lead(over: Row = {}): Row {
  return {
    id: LEAD_ID,
    customer_id: CUSTOMER_ID,
    created_at: iso(60 * 48),
    customer_status: "Ny",
    contacted_at: null,
    ...over,
  };
}

function baseState(over: Record<string, Row[]> = {}): Record<string, Row[]> {
  return {
    leads: [lead()],
    customers: [{ id: CUSTOMER_ID, name: "Testkund" }],
    customer_profiles: [
      { customer_id: CUSTOMER_ID, notify_recipients: ["kund@example.se"] },
    ],
    growth_lead_state: [{ lead_id: LEAD_ID, intent_level: "HÖG" }],
    lead_reminder_deliveries: [],
    ...over,
  };
}

/** Stub som efterliknar de tre SQL-funktionernas atomiska villkor. */
function makeSupabase(state: Record<string, Row[]>) {
  const writes: Array<{ table: string; patch: Row }> = [];
  const supabase: any = {
    from(table: string) {
      const eqs: Array<[string, any]> = [];
      const lts: Array<[string, any]> = [];
      let rowLimit = Infinity;
      const rows = () =>
        (state[table] ?? [])
          .filter(
            (r) =>
              eqs.every(([c, v]) => r[c] === v) &&
              lts.every(([c, v]) => String(r[c]) < String(v)),
          )
          .slice(0, rowLimit);
      const builder: any = {
        select: () => builder,
        eq: (c: string, v: any) => {
          eqs.push([c, v]);
          return builder;
        },
        lt: (c: string, v: any) => {
          lts.push([c, v]);
          return builder;
        },
        order: () => builder,
        limit: (n: number) => {
          rowLimit = n;
          return builder;
        },
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        update: (patch: Row) => {
          const res: any = {
            eq: (c: string, v: any) => {
              eqs.push([c, v]);
              return res;
            },
            then: (resolve: any) => {
              writes.push({ table, patch });
              for (const row of rows()) Object.assign(row, patch);
              return resolve({ data: null, error: null });
            },
          };
          return res;
        },
        then: (resolve: any) => resolve({ data: rows(), error: null }),
      };
      return builder;
    },
    async rpc(name: string, args: any) {
      const reminders = (state["lead_reminder_deliveries"] ??= []);
      if (name === "claim_lead_reminder") {
        const l = (state["leads"] ?? []).find((r) => r["id"] === args.p_lead_id);
        if (!l) return { data: { ok: false, code: "not_found" }, error: null };
        if (l["customer_status"] !== "Ny") {
          return { data: { ok: false, code: "lead_not_pending" }, error: null };
        }
        if (
          Date.parse(l["created_at"]) >
          NOW.getTime() - (args.p_older_than_hours ?? 24) * 3_600_000
        ) {
          return { data: { ok: false, code: "not_due" }, error: null };
        }
        let row = reminders.find(
          (r) => r["lead_id"] === args.p_lead_id && r["kind"] === args.p_kind,
        );
        if (!row) {
          row = { id: "rem-1", lead_id: args.p_lead_id, customer_id: l["customer_id"], kind: args.p_kind, status: "pending" };
          reminders.push(row);
        }
        if (row["status"] === "sent") return { data: { ok: false, code: "already_sent" }, error: null };
        if (row["status"] === "unknown")
          return { data: { ok: false, code: "delivery_unknown" }, error: null };
        if (row["status"] === "claimed") {
          const fresh =
            NOW.getTime() - Date.parse(String(row["claimed_at"])) <
            (args.p_stale_claim_minutes ?? 15) * 60_000;
          return { data: { ok: false, code: fresh ? "in_progress" : "stale_claim" }, error: null };
        }
        row["status"] = "claimed";
        row["attempt_id"] = "attempt-1";
        row["claimed_at"] = NOW.toISOString();
        return {
          data: {
            ok: true,
            code: "claimed",
            reminderId: row["id"],
            attemptId: row["attempt_id"],
            leadId: args.p_lead_id,
            customerId: l["customer_id"],
            kind: args.p_kind,
          },
          error: null,
        };
      }
      if (name === "complete_lead_reminder") {
        const row = reminders.find((r) => r["id"] === args.p_reminder_id);
        if (!row) return { data: { ok: false, code: "not_found" }, error: null };
        if (row["attempt_id"] !== args.p_attempt_id) {
          return { data: { ok: false, code: "attempt_mismatch" }, error: null };
        }
        if (row["status"] === "sent") {
          if (row["transport_message_id"] !== args.p_transport_message_id) {
            return { data: { ok: false, code: "transport_mismatch" }, error: null };
          }
          return {
            data: { ok: true, code: "already_sent", duplicate: true, transportMessageId: row["transport_message_id"] },
            error: null,
          };
        }
        if (row["status"] !== "claimed") {
          return { data: { ok: false, code: "invalid_status" }, error: null };
        }
        row["status"] = "sent";
        row["sent_at"] = NOW.toISOString();
        row["transport_message_id"] = args.p_transport_message_id;
        return {
          data: { ok: true, code: "sent", duplicate: false, transportMessageId: args.p_transport_message_id },
          error: null,
        };
      }
      if (name === "fail_lead_reminder") {
        const row = reminders.find((r) => r["id"] === args.p_reminder_id);
        if (!row) return { data: { ok: false, code: "not_found" }, error: null };
        if (row["attempt_id"] !== args.p_attempt_id) {
          return { data: { ok: false, code: "attempt_mismatch" }, error: null };
        }
        const status = args.p_outcome === "not_sent" ? "failed" : "unknown";
        row["status"] = status;
        return { data: { ok: true, code: status, status }, error: null };
      }
      return { data: null, error: null };
    },
  };
  return { supabase, writes };
}

function ctxFor(state: Record<string, Row[]>) {
  const fake = makeSupabase(state);
  return { ctx: { supabase: fake.supabase, userId: null } as any, fake };
}

describe("due-lead-reminders med transportstate", () => {
  it("tar med gamla leads som fortfarande är Ny", async () => {
    const state = baseState();
    const { ctx } = ctxFor(state);
    const result = await dueLeadRemindersCore(ctx, {}, ENV, NOW);
    expect(result.count).toBe(1);
    expect(result.reminders[0]!.claimable).toBe(true);
    expect(result.reminders[0]!.reminderStatus).toBe("none");
    expect(result.externalEffect).toBe(false);
  });

  it("utesluter Kontaktad oavsett extern status", async () => {
    const state = baseState({
      leads: [lead({ customer_status: "Kontaktad", contacted_at: iso(10) })],
    });
    const { ctx } = ctxFor(state);
    expect((await dueLeadRemindersCore(ctx, {}, ENV, NOW)).count).toBe(0);
  });

  it("utesluter redan skickade påminnelser", async () => {
    const state = baseState({
      lead_reminder_deliveries: [
        { id: "rem-1", lead_id: LEAD_ID, kind: REMINDER_KIND, status: "sent", sent_at: iso(30) },
      ],
    });
    const { ctx } = ctxFor(state);
    expect((await dueLeadRemindersCore(ctx, {}, ENV, NOW)).count).toBe(0);
  });

  it("utesluter osäkra (unknown) och pågående claims", async () => {
    const unknownState = baseState({
      lead_reminder_deliveries: [
        { id: "rem-1", lead_id: LEAD_ID, kind: REMINDER_KIND, status: "unknown" },
      ],
    });
    expect((await dueLeadRemindersCore(ctxFor(unknownState).ctx, {}, ENV, NOW)).count).toBe(0);

    const claimedState = baseState({
      lead_reminder_deliveries: [
        { id: "rem-1", lead_id: LEAD_ID, kind: REMINDER_KIND, status: "claimed", claimed_at: iso(2) },
      ],
    });
    expect((await dueLeadRemindersCore(ctxFor(claimedState).ctx, {}, ENV, NOW)).count).toBe(0);
  });

  it("flaggar fastnad claim för manuell avstämning utan autoretry", async () => {
    const state = baseState({
      lead_reminder_deliveries: [
        { id: "rem-1", lead_id: LEAD_ID, kind: REMINDER_KIND, status: "claimed", claimed_at: iso(120) },
      ],
    });
    const result = await dueLeadRemindersCore(ctxFor(state).ctx, {}, ENV, NOW);
    expect(result.count).toBe(1);
    expect(result.reminders[0]!.claimable).toBe(false);
    expect(result.reminders[0]!.needsManualReview).toBe(true);
  });

  it("skriver ingenting", async () => {
    const state = baseState();
    const { ctx, fake } = ctxFor(state);
    await dueLeadRemindersCore(ctx, {}, ENV, NOW);
    expect(fake.writes).toHaveLength(0);
  });
});

describe("claim/complete/fail för påminnelser", () => {
  it("claimar en gång och nekar dubbel claim", async () => {
    const state = baseState();
    const { ctx } = ctxFor(state);
    const first: any = await claimLeadReminderCore(ctx, { leadId: LEAD_ID }, ENV, NOW);
    expect(first.ok).toBe(true);
    expect(first.notifyRecipients).toEqual(["kund@example.se"]);
    expect(first.customerName).toBe("Testkund");
    expect(typeof first.contactUrl).toBe("string");

    const second: any = await claimLeadReminderCore(ctx, { leadId: LEAD_ID }, ENV, NOW);
    expect(second.ok).toBe(false);
    expect(second.code).toBe("in_progress");
  });

  it("nekar claim när leadet hunnit bli Kontaktad", async () => {
    const state = baseState();
    const { ctx } = ctxFor(state);
    state["leads"]![0]!["customer_status"] = "Kontaktad";
    const result: any = await claimLeadReminderCore(ctx, { leadId: LEAD_ID }, ENV, NOW);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("lead_not_pending");
  });

  it("nekar claim när påminnelsen inte är förfallen", async () => {
    const state = baseState({ leads: [lead({ created_at: iso(60) })] });
    const result: any = await claimLeadReminderCore(ctxFor(state).ctx, { leadId: LEAD_ID }, ENV, NOW);
    expect(result.code).toBe("not_due");
  });

  it("lämnar aldrig ut lead-PII eller hemligheter i claim-svaret", async () => {
    const state = baseState();
    state["leads"]![0]!["payload"] = { answers: { epost: "privat@example.se" } };
    const result = await claimLeadReminderCore(ctxFor(state).ctx, { leadId: LEAD_ID }, ENV, NOW);
    const raw = JSON.stringify(result);
    expect(raw).not.toContain("privat@example.se");
    expect(raw).not.toContain("action-secret");
  });

  it("complete är idempotent och kräver rätt attempt", async () => {
    const state = baseState();
    const { ctx } = ctxFor(state);
    const claim: any = await claimLeadReminderCore(ctx, { leadId: LEAD_ID }, ENV, NOW);
    const first: any = await completeLeadReminderCore(ctx, {
      reminderId: claim.reminderId,
      attemptId: claim.attemptId,
      transportMessageId: "msg-1",
    });
    expect(first.ok).toBe(true);
    expect(first.duplicate).toBe(false);

    const again: any = await completeLeadReminderCore(ctx, {
      reminderId: claim.reminderId,
      attemptId: claim.attemptId,
      transportMessageId: "msg-1",
    });
    expect(again.duplicate).toBe(true);

    const wrong: any = await completeLeadReminderCore(ctx, {
      reminderId: claim.reminderId,
      attemptId: "00000000-0000-4000-8000-000000000000",
      transportMessageId: "msg-1",
    });
    expect(wrong.ok).toBe(false);
    expect(wrong.code).toBe("attempt_mismatch");
  });

  it("fail: not_sent blir failed, standard blir unknown utan autoretry", async () => {
    const state = baseState();
    const { ctx } = ctxFor(state);
    const claim: any = await claimLeadReminderCore(ctx, { leadId: LEAD_ID }, ENV, NOW);
    const failed: any = await failLeadReminderCore(ctx, {
      reminderId: claim.reminderId,
      attemptId: claim.attemptId,
      outcome: "not_sent",
      reason: "SMTP-fel",
    });
    expect(failed.reminderStatus).toBe("failed");
    expect(failed.autoRetryAllowed).toBe(false);

    const state2 = baseState();
    const c2 = ctxFor(state2);
    const claim2: any = await claimLeadReminderCore(c2.ctx, { leadId: LEAD_ID }, ENV, NOW);
    const unknown: any = await failLeadReminderCore(c2.ctx, {
      reminderId: claim2.reminderId,
      attemptId: claim2.attemptId,
    });
    expect(unknown.reminderStatus).toBe("unknown");
    // Ett unknown får aldrig plockas upp igen automatiskt.
    const retry: any = await claimLeadReminderCore(c2.ctx, { leadId: LEAD_ID }, ENV, NOW);
    expect(retry.ok).toBe(false);
    expect(retry.code).toBe("delivery_unknown");
  });
});
