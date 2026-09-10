/**
 * Tester för TEST/REVIEW-kedjan lead -> conversation -> nurture-preview ->
 * inkommande svar. Ingen databas, inga externa anrop, inga utskick.
 */
import { describe, expect, it } from "vitest";
import { previewNurtureTestCore, registerNurtureReplyCore } from "./nurture.server";

const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";

type Row = Record<string, any>;

function makeSupabase() {
  const state: Record<string, Row[]> = {
    leads: [
      {
        id: LEAD_ID,
        customer_id: CUSTOMER_ID,
        industry: "varuautomater",
        created_at: "2026-01-01T00:00:00.000Z",
        payload: {
          answers: { foretag: "Testbolaget", postnummer: "50123" },
        },
      },
    ],
    customers: [
      { id: CUSTOMER_ID, name: "Borås varuautomater", industry: "varuautomater", service_area: "Borås" },
    ],
    customer_profiles: [
      {
        customer_id: CUSTOMER_ID,
        tone: "professionell",
        language: "sv",
        lead_prefix: "",
        qualification_profile: {},
        followup_rules: {},
        booking_rules: {},
        notify_recipients: [],
        ai_assistant_enabled: false,
        execution_mode: "review",
        local_postal_prefix: "50",
        regional_postal_prefix: "51",
      },
    ],
    conversations: [],
    conversation_messages: [],
    growth_nurture_state: [],
    growth_lead_state: [],
    growth_outcomes: [],
    lead_outcomes: [],
  };

  let seq = 0;
  const supabase: any = {
    from(table: string) {
      const filters: Array<[string, any]> = [];
      const rows = () => (state[table] ??= []).filter((r) => filters.every(([c, v]) => r[c] === v));
      const builder: any = {
        select: () => builder,
        eq: (c: string, v: any) => {
          filters.push([c, v]);
          return builder;
        },
        in: () => builder,
        not: () => builder,
        lte: () => builder,
        gte: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        single: async () => ({ data: rows()[0] ?? null, error: null }),
        insert: (row: Row) => {
          seq += 1;
          const created = { id: `${table}-${seq}`, ...row };
          (state[table] ??= []).push(created);
          const res: any = {
            select: () => res,
            single: async () => ({ data: created, error: null }),
            maybeSingle: async () => ({ data: created, error: null }),
            then: (resolve: any) => resolve({ data: created, error: null }),
          };
          return res;
        },
        upsert: async (row: Row) => {
          const list = (state[table] ??= []);
          const idx = list.findIndex((r) => r["lead_id"] === row["lead_id"]);
          if (idx >= 0) list[idx] = { ...list[idx], ...row };
          else list.push({ ...row });
          return { data: null, error: null };
        },
        update: (patch: Row) => {
          const res: any = {
            eq: (c: string, v: any) => {
              filters.push([c, v]);
              return res;
            },
            then: (resolve: any) => {
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
    async rpc() {
      return { data: true, error: null };
    },
  };

  return { supabase, state };
}

const ctxOf = (supabase: any) => ({ supabase, userId: null });

describe("nurture conversation-kedja (TEST/REVIEW)", () => {
  it("skapar konversationen idempotent och lagrar utkastet som utgående meddelande", async () => {
    const { supabase, state } = makeSupabase();
    const ctx = ctxOf(supabase);

    const first = await previewNurtureTestCore(ctx, LEAD_ID);
    expect(state["conversations"]!.length).toBe(1);
    expect(first.conversationId).toBe(state["conversations"]![0]!["id"]);
    expect(first.notificationSent).toBe(false);
    expect(first.externalEffect).toBe(false);

    const second = await previewNurtureTestCore(ctx, LEAD_ID);
    expect(state["conversations"]!.length).toBe(1);
    expect(second.conversationId).toBe(first.conversationId);

    const outbound = state["conversation_messages"]!.filter((m) => m["direction"] === "outbound");
    if (first.preview) {
      expect(outbound.length).toBe(1);
      expect(second.outboundDuplicate).toBe(true);
      expect(outbound[0]!["channel"]).toBe("mock");
      expect(String(outbound[0]!["source_ref"])).toContain("nurture-preview:");
    } else {
      expect(outbound.length).toBe(0);
    }
  });

  it("lagrar inkommande svar maskerat, idempotent via source_ref, utan extern effekt", async () => {
    const { supabase, state } = makeSupabase();
    const ctx = ctxOf(supabase);
    await previewNurtureTestCore(ctx, LEAD_ID);

    const body = "Hej, ni når mig på anna@example.com eller 070-123 45 67. Låter intressant.";
    const reasoning = { env: {} };
    const first = await registerNurtureReplyCore(ctx, {
      leadId: LEAD_ID,
      body,
      sourceRef: "make-evt-1",
      reasoning,
    });
    expect(first.inboundStored).toBe(true);
    expect(first.notificationSent).toBe(false);
    expect(first.externalEffect).toBe(false);
    expect(first.redactedBody).not.toContain("anna@example.com");
    expect(first.redactedBody).not.toContain("070");

    const again = await registerNurtureReplyCore(ctx, {
      leadId: LEAD_ID,
      body,
      sourceRef: "make-evt-1",
      reasoning,
    });
    expect(again.inboundDuplicate).toBe(true);

    const inbound = state["conversation_messages"]!.filter((m) => m["direction"] === "inbound");
    expect(inbound.length).toBe(1);
    expect(inbound[0]!["conversation_id"]).toBe(first.conversationId);
    expect(inbound[0]!["lead_id"]).toBe(LEAD_ID);
    expect(inbound[0]!["customer_id"]).toBe(CUSTOMER_ID);
    expect(String(inbound[0]!["redacted_body"])).not.toContain("anna@example.com");

    const stage = state["conversations"]![0]!["stage"];
    expect(["replied", "closed", "meeting_booked"]).toContain(stage);
  });

  it("faller tillbaka på hash av svaret när sourceRef saknas", async () => {
    const { supabase, state } = makeSupabase();
    const ctx = ctxOf(supabase);
    const body = "Tack, hör av er om ett par veckor.";
    const a = await registerNurtureReplyCore(ctx, { leadId: LEAD_ID, body, reasoning: { env: {} } });
    const b = await registerNurtureReplyCore(ctx, { leadId: LEAD_ID, body, reasoning: { env: {} } });
    expect(a.sourceRef).toBe(b.sourceRef);
    expect(b.inboundDuplicate).toBe(true);
    expect(state["conversation_messages"]!.filter((m) => m["direction"] === "inbound").length).toBe(1);
  });

  it("låter neutral aktuell reply förbli signalneutral trots gammalt mötesutfall", async () => {
    const { supabase, state } = makeSupabase();
    state["growth_outcomes"]!.push({
      lead_id: LEAD_ID,
      variant_id: null,
      outcome_type: "meeting_booked",
      outcome_value: null,
      revenue_value: null,
    });
    state["growth_nurture_state"]!.push({
      lead_id: LEAD_ID,
      customer_id: CUSTOMER_ID,
      status: "sent",
      intent_level: "HÖG",
      upgrade_signal: true,
      human_takeover: false,
      execution_mode: "review",
      steps_taken: 1,
    });

    const result = await registerNurtureReplyCore(ctxOf(supabase), {
      leadId: LEAD_ID,
      body: "hej! /test\n\nDen 9 sep. 2026 skrev Noryva:\n> Kan vi boka ett möte?",
      sourceRef: "neutral-after-old-meeting",
      reasoning: {
        env: { OPENAI_API_KEY: "sk-test" },
        fetchImpl: async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({
              output_text: JSON.stringify({
                intent: "ovrigt",
                positivePurchaseIntent: false,
                explicitMeetingIntent: false,
                confidence: 0.99,
                reason: "Neutral testtext.",
              }),
            }),
          }) as Response,
      },
    });

    expect(result.effect.upgradeSignal).toBe(false);
    expect(result.effect.outcome).toBeNull();
    expect(result.state.upgrade_signal).toBe(false);
    expect(result.intent.level).toBe("HÖG");
    expect(state["growth_outcomes"]).toHaveLength(1);
    expect(result.notificationSent).toBe(false);
    expect(result.externalEffect).toBe(false);
  });
});
