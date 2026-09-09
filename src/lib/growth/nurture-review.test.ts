/**
 * Tester för granskningskön (review outbox).
 *
 * Inga externa anrop, ingen SMTP, inga modellanrop. Databasstubben speglar
 * exakt semantiken i SQL-funktionerna approve/cancel/claim/complete/fail.
 */
import { describe, expect, it, vi } from "vitest";
import {
  evaluateReviewGate,
  externalSendDecision,
  isValidEmail,
  occurrenceKey,
  reviewFingerprint,
} from "./nurture-review";
import {
  approveNurtureReviewCore,
  claimNurtureReviewCore,
  completeNurtureReviewCore,
  failNurtureReviewCore,
  recipientFromLead,
  refreshDueNurtureReviewsCore,
  registerReviewedNurtureReplyCore,
} from "./nurture-review.server";

const LEAD_A = "11111111-1111-4111-8111-111111111111";
const CUST_A = "22222222-2222-4222-8222-222222222222";
const LEAD_B = "33333333-3333-4333-8333-333333333333";
const CUST_B = "44444444-4444-4444-8444-444444444444";
const PAST = "2020-01-01T00:00:00.000Z";

type Row = Record<string, any>;

/* ------------------------------------------------------------------ stub */

function makeSupabase() {
  const state: Record<string, Row[]> = {
    leads: [
      {
        id: LEAD_A,
        customer_id: CUST_A,
        industry: "varuautomater",
        created_at: PAST,
        payload: {
          payload_version: 2,
          answers: { foretag: "Testbolaget", postnummer: "50123", epost: "info@noryva.se" },
          make: { epost: "info@noryva.se", postnummer: "50123", fullstandigt_namn: "A" },
        },
      },
      {
        id: LEAD_B,
        customer_id: CUST_B,
        industry: "tak",
        created_at: PAST,
        payload: {
          payload_version: 2,
          answers: { foretag: "Takbolaget", postnummer: "41234", epost: "kund@example.com" },
          make: { epost: "kund@example.com", postnummer: "41234", fullstandigt_namn: "B" },
        },
      },
    ],
    customers: [
      {
        id: CUST_A,
        name: "Borås varuautomater",
        industry: "varuautomater",
        service_area: "Borås",
        status: "published",
      },
      { id: CUST_B, name: "Taklyftet", industry: "tak", service_area: "Göteborg", status: "published" },
    ],
    customer_profiles: [
      {
        customer_id: CUST_A,
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
      {
        customer_id: CUST_B,
        tone: "professionell",
        language: "sv",
        lead_prefix: "",
        qualification_profile: {},
        followup_rules: {},
        booking_rules: {},
        notify_recipients: [],
        ai_assistant_enabled: false,
        execution_mode: "review",
        local_postal_prefix: "",
        regional_postal_prefix: "",
      },
    ],
    conversations: [],
    conversation_messages: [],
    growth_nurture_state: [
      {
        lead_id: LEAD_A,
        customer_id: CUST_A,
        status: "pending",
        reason: "",
        intent_level: "LÅG",
        questions: [],
        next_step_at: PAST,
        steps_taken: 0,
        last_reply_intent: "",
        human_takeover: false,
        upgrade_signal: false,
        stopped_reason: "",
        execution_mode: "review",
      },
      {
        lead_id: LEAD_B,
        customer_id: CUST_B,
        status: "pending",
        reason: "",
        intent_level: "NORMAL",
        questions: [],
        next_step_at: PAST,
        steps_taken: 0,
        last_reply_intent: "",
        human_takeover: false,
        upgrade_signal: false,
        stopped_reason: "",
        execution_mode: "review",
      },
    ],
    growth_lead_state: [],
    growth_outcomes: [],
    lead_outcomes: [],
    nurture_reviews: [],
    ai_cost_events: [],
  };

  let seq = 0;
  const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

  function query(table: string) {
    const preds: Array<(r: Row) => boolean> = [];
    let limit = Infinity;
    const rows = () => (state[table] ??= []).filter((r) => preds.every((p) => p(r))).slice(0, limit);
    const b: any = {
      select: () => b,
      eq: (c: string, v: any) => (preds.push((r) => r[c] === v), b),
      in: (c: string, v: any[]) => (preds.push((r) => v.includes(r[c])), b),
      not: (c: string, _op: string, _v: any) => (preds.push((r) => r[c] != null), b),
      lte: (c: string, v: any) => (preds.push((r) => String(r[c] ?? "") <= String(v)), b),
      gte: (c: string, v: any) => (preds.push((r) => String(r[c] ?? "") >= String(v)), b),
      order: () => b,
      limit: (n: number) => ((limit = n), b),
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => ({ data: rows()[0] ?? null, error: null }),
      insert: (row: Row) => {
        const created = { id: uuid(), created_at: new Date().toISOString(), ...row };
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
        else list.push({ id: uuid(), ...row });
        return { data: null, error: null };
      },
      update: (patch: Row) => {
        const res: any = {
          eq: (c: string, v: any) => (preds.push((r) => r[c] === v), res),
          select: () => res,
          maybeSingle: async () => {
            const hit = rows();
            for (const r of hit) Object.assign(r, patch);
            return { data: hit[0] ?? null, error: null };
          },
          then: (resolve: any) => {
            for (const r of rows()) Object.assign(r, patch);
            return resolve({ data: null, error: null });
          },
        };
        return res;
      },
      then: (resolve: any) => resolve({ data: rows(), error: null }),
    };
    return b;
  }

  /** Spegling av SQL-funktionerna. Samma villkor, samma returkoder. */
  async function rpc(name: string, args: Row = {}) {
    const reviews = (state["nurture_reviews"] ??= []);
    const find = () => reviews.find((r) => r["id"] === args["p_review_id"]);
    switch (name) {
      case "has_role":
        return { data: true, error: null };
      case "nurture_source_revision": {
        const lead = state["leads"]!.find((l) => l["id"] === args["p_lead_id"])!;
        const n = state["growth_nurture_state"]!.find((x) => x["lead_id"] === args["p_lead_id"]);
        const conv = state["conversations"]!.find((c) => c["lead_id"] === args["p_lead_id"]);
        let reason = "";
        if (!n) reason = "Ingen uppföljningsplan finns för förfrågan.";
        else if (n["status"] === "cancelled") reason = "Uppföljningen är avslutad.";
        else if (n["status"] === "replied") reason = "Leadet har svarat – hanteras i konversationen.";
        else if (n["human_takeover"] === true) reason = "Kräver mänsklig handläggning.";
        else if (n["last_reply_intent"] === "avbojer") reason = "Leadet har tackat nej.";
        else if (conv?.["human_owner"]) reason = "Konversationen har en mänsklig ägare.";
        const revision = JSON.stringify([
          lead?.["customer_id"],
          n?.["status"],
          n?.["steps_taken"],
          n?.["human_takeover"],
          n?.["last_reply_intent"],
          n?.["next_step_at"],
          n?.["questions"],
          conv?.["human_owner"] ?? "",
          conv?.["stage"] ?? "",
        ]);
        return { data: { ok: reason === "", reason, revision }, error: null };
      }
      case "approve_nurture_review": {
        const r = find();
        if (!r) return { data: { ok: false, code: "not_found" }, error: null };
        if (r["content_fingerprint"] !== args["p_fingerprint"])
          return { data: { ok: false, code: "stale" }, error: null };
        if (r["source_revision"] !== args["p_source_revision"])
          return { data: { ok: false, code: "stale_source" }, error: null };
        if (r["status"] !== "pending_review")
          return { data: { ok: false, code: "invalid_status", status: r["status"] }, error: null };
        if (r["blocked_reason"]) return { data: { ok: false, code: "blocked" }, error: null };
        Object.assign(r, { status: "approved", approved_at: new Date().toISOString() });
        return { data: { ok: true, code: "approved", reviewId: r["id"] }, error: null };
      }
      case "cancel_nurture_review": {
        const r = find();
        if (!r) return { data: { ok: false, code: "not_found" }, error: null };
        if (["claimed", "sent", "unknown"].includes(r["status"]))
          return { data: { ok: false, code: "invalid_status" }, error: null };
        Object.assign(r, { status: "cancelled" });
        return { data: { ok: true, code: "cancelled" }, error: null };
      }
      case "claim_nurture_review": {
        const r = find();
        if (!r) return { data: { ok: false, code: "not_found" }, error: null };
        if (r["status"] !== "approved")
          return { data: { ok: false, code: "not_claimable", status: r["status"] }, error: null };
        if (args["p_source_revision"] != null && r["source_revision"] !== args["p_source_revision"])
          return { data: { ok: false, code: "stale_source" }, error: null };
        const attempt = uuid();
        Object.assign(r, { status: "claimed", attempt_id: attempt });
        return {
          data: {
            ok: true,
            code: "claimed",
            reviewId: r["id"],
            attemptId: attempt,
            leadId: r["lead_id"],
            customerId: r["customer_id"],
            conversationId: r["conversation_id"],
            recipientEmail: r["recipient_email"],
            subject: r["subject"],
            body: r["body"],
            contentFingerprint: r["content_fingerprint"],
          },
          error: null,
        };
      }
      case "complete_nurture_review": {
        const r = find();
        if (!r) return { data: { ok: false, code: "not_found" }, error: null };
        if (r["attempt_id"] !== args["p_attempt_id"])
          return { data: { ok: false, code: "attempt_mismatch" }, error: null };
        if (r["status"] === "sent")
          return {
            data: {
              ok: true,
              code: "already_sent",
              duplicate: true,
              transportMessageId: r["transport_message_id"],
            },
            error: null,
          };
        if (r["status"] !== "claimed")
          return { data: { ok: false, code: "invalid_status", status: r["status"] }, error: null };
        Object.assign(r, {
          status: "sent",
          transport_message_id: String(args["p_transport_message_id"]).trim(),
        });
        const n = (state["growth_nurture_state"] ??= []).find((x) => x["lead_id"] === r["lead_id"]);
        if (n) {
          n["steps_taken"] = (n["steps_taken"] ?? 0) + 1;
          if (!["replied", "cancelled"].includes(n["status"])) n["status"] = "sent";
        }
        const sourceRef = `nurture-transport:${String(args["p_transport_message_id"]).trim()}`;
        const msgs = (state["conversation_messages"] ??= []);
        if (r["conversation_id"] && !msgs.some((m) => m["source_ref"] === sourceRef)) {
          msgs.push({
            id: uuid(),
            conversation_id: r["conversation_id"],
            lead_id: r["lead_id"],
            customer_id: r["customer_id"],
            direction: "outbound",
            channel: "email",
            redacted_body: `${r["subject"]}\n\n${r["body"]}`,
            source_ref: sourceRef,
          });
        }
        return {
          data: {
            ok: true,
            code: "sent",
            duplicate: false,
            leadId: r["lead_id"],
            customerId: r["customer_id"],
            conversationId: r["conversation_id"],
            transportMessageId: r["transport_message_id"],
          },
          error: null,
        };
      }
      case "fail_nurture_review": {
        const r = find();
        if (!r) return { data: { ok: false, code: "not_found" }, error: null };
        if (r["attempt_id"] !== args["p_attempt_id"])
          return { data: { ok: false, code: "attempt_mismatch" }, error: null };
        if (["failed", "unknown"].includes(r["status"]))
          return { data: { ok: true, code: "already_recorded", status: r["status"] }, error: null };
        if (r["status"] !== "claimed")
          return { data: { ok: false, code: "invalid_status", status: r["status"] }, error: null };
        const status = args["p_outcome"] === "not_sent" ? "failed" : "unknown";
        Object.assign(r, { status, failure_reason: args["p_reason"] || "Okänt transportfel." });
        return { data: { ok: true, code: status, status }, error: null };
      }
      default:
        return { data: null, error: null };
    }
  }

  return { supabase: { from: query, rpc }, state };
}

const ctxOf = (supabase: any) => ({ supabase, userId: null });
const ENV_ON = { NORYVA_NURTURE_REVIEW_WEBHOOK_URL: "https://hook.example/x" };
const okDispatch = async () => ({ ok: true });

async function seedReview(ctx: any, state: Record<string, Row[]>, leadId: string) {
  await refreshDueNurtureReviewsCore(ctx, { now: new Date("2026-01-01T00:00:00.000Z") });
  return state["nurture_reviews"]!.find((r) => r["lead_id"] === leadId)!;
}

/* ------------------------------------------------------------- rena regler */

describe("granskningsspärrar (rena funktioner)", () => {
  const base = {
    intentLevel: "LÅG",
    terminal: false,
    humanTakeover: false,
    conversationHumanOwner: null,
    optedOut: false,
    nurtureStatus: "pending",
    customerStatus: "published",
    recipientEmail: "kund@example.com",
    hasPreview: true,
    executionMode: "review",
  };

  it("släpper igenom ett giltigt LÅG-lead", () => {
    expect(evaluateReviewGate(base)).toBe("");
  });

  it("spärrar HÖG och AKUT", () => {
    expect(evaluateReviewGate({ ...base, intentLevel: "HÖG" })).toContain("HÖG");
    expect(evaluateReviewGate({ ...base, intentLevel: "AKUT" })).toContain("AKUT");
  });

  it("spärrar avgjort utfall, mänsklig handläggning och mänsklig ägare", () => {
    expect(evaluateReviewGate({ ...base, terminal: true })).not.toBe("");
    expect(evaluateReviewGate({ ...base, humanTakeover: true })).not.toBe("");
    expect(evaluateReviewGate({ ...base, conversationHumanOwner: "user-1" })).not.toBe("");
  });

  it("spärrar avböjt lead, avslutad plan, inaktiv kund och ogiltig adress", () => {
    expect(evaluateReviewGate({ ...base, optedOut: true })).not.toBe("");
    expect(evaluateReviewGate({ ...base, nurtureStatus: "cancelled" })).not.toBe("");
    expect(evaluateReviewGate({ ...base, customerStatus: "draft" })).toContain("aktiv");
    expect(evaluateReviewGate({ ...base, recipientEmail: "trasig" })).toContain("mottagaradress");
  });

  it("externa utskick är avstängda som standard men släpper igenom testadressen", () => {
    expect(externalSendDecision({ enabled: false, storedRecipient: "kund@example.com" }).allowed).toBe(
      false,
    );
    expect(externalSendDecision({ enabled: false, storedRecipient: "INFO@noryva.se" }).allowed).toBe(true);
    expect(externalSendDecision({ enabled: true, storedRecipient: "kund@example.com" }).allowed).toBe(true);
  });

  it("avtryck och nycklar är deterministiska", () => {
    const input = {
      leadId: LEAD_A,
      customerId: CUST_A,
      recipientEmail: "a@b.se",
      subject: "S",
      body: "B",
      questions: ["q"],
      dueAt: PAST,
    };
    expect(reviewFingerprint(input)).toBe(reviewFingerprint(input));
    expect(reviewFingerprint({ ...input, body: "B2" })).not.toBe(reviewFingerprint(input));
    expect(occurrenceKey(0, PAST)).toBe(`0:${PAST}`);
    expect(isValidEmail("a@b.se")).toBe(true);
    expect(isValidEmail("a@b")).toBe(false);
  });

  it("mottagaren läses ur lagrad payload, aldrig ur anropet", () => {
    expect(recipientFromLead({ make: { epost: "A@Example.com" } })).toBe("a@example.com");
    expect(recipientFromLead({ answers: { epost: "b@example.com" } })).toBe("b@example.com");
    expect(recipientFromLead({ answers: { epost: "trasig" } })).toBe("");
  });
});

/* --------------------------------------------------------------- serverflöde */

describe("granskningskö – serverflöde", () => {
  it("skapar granskningsposter för förfallna uppföljningar i två branscher", async () => {
    const { supabase, state } = makeSupabase();
    const ctx = ctxOf(supabase);
    const result = await refreshDueNurtureReviewsCore(ctx, { now: new Date("2026-01-01T00:00:00Z") });

    expect(result.externalEffect).toBe(false);
    expect(result.notificationSent).toBe(false);
    expect(state["nurture_reviews"]!.length).toBe(2);

    const a = state["nurture_reviews"]!.find((r) => r["lead_id"] === LEAD_A)!;
    const b = state["nurture_reviews"]!.find((r) => r["lead_id"] === LEAD_B)!;
    expect(a["recipient_email"]).toBe("info@noryva.se");
    expect(b["recipient_email"]).toBe("kund@example.com");
    expect(a["subject"]).toBeTruthy();
    expect(a["body"]).toContain("Hej!");
    expect(a["content_fingerprint"]).toBeTruthy();
  });

  it("är idempotent: samma underlag skapar inga dubbletter", async () => {
    const { supabase, state } = makeSupabase();
    const ctx = ctxOf(supabase);
    await refreshDueNurtureReviewsCore(ctx, { now: new Date("2026-01-01T00:00:00Z") });
    const second = await refreshDueNurtureReviewsCore(ctx, { now: new Date("2026-01-01T01:00:00Z") });
    expect(second.created).toBe(0);
    expect(state["nurture_reviews"]!.length).toBe(2);
  });

  it("godkännande utan konfigurerad brygga förbrukar ingenting", async () => {
    const { supabase, state } = makeSupabase();
    const ctx = ctxOf(supabase);
    const review = await seedReview(ctx, state, LEAD_A);

    const result = await approveNurtureReviewCore(
      ctx,
      { reviewId: review["id"], expectedFingerprint: review["content_fingerprint"] },
      {},
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe("config_missing");
    expect(review["status"]).toBe("pending_review");
  });

  it("avvisar godkännande med gammalt avtryck och kräver ny granskning", async () => {
    const { supabase, state } = makeSupabase();
    const ctx = ctxOf(supabase);
    const review = await seedReview(ctx, state, LEAD_A);

    const result = await approveNurtureReviewCore(
      ctx,
      { reviewId: review["id"], expectedFingerprint: "deadbeef" },
      ENV_ON,
      okDispatch,
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe("stale");
    expect(review["status"]).toBe("pending_review");
  });

  it("godkänner en gång och avvisar det andra samtidiga godkännandet", async () => {
    const { supabase, state } = makeSupabase();
    const ctx = ctxOf(supabase);
    const review = await seedReview(ctx, state, LEAD_A);
    const dispatch = vi.fn(async () => ({ ok: true }));

    const first = await approveNurtureReviewCore(
      ctx,
      { reviewId: review["id"], expectedFingerprint: review["content_fingerprint"] },
      ENV_ON,
      dispatch,
    );
    const second = await approveNurtureReviewCore(
      ctx,
      { reviewId: review["id"], expectedFingerprint: review["content_fingerprint"] },
      ENV_ON,
      dispatch,
    );

    expect(first.ok).toBe(true);
    expect(first.dispatched).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.code).toBe("invalid_status");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(review["status"]).toBe("approved");
  });

  it("spärrar godkännande när leadet fått mänsklig handläggning", async () => {
    const { supabase, state } = makeSupabase();
    const ctx = ctxOf(supabase);
    const review = await seedReview(ctx, state, LEAD_A);
    state["conversations"]![0]!["human_owner"] = "55555555-5555-4555-8555-555555555555";

    const result = await approveNurtureReviewCore(
      ctx,
      { reviewId: review["id"], expectedFingerprint: review["content_fingerprint"] },
      ENV_ON,
      okDispatch,
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe("blocked");
    expect(review["status"]).toBe("blocked");
  });

  it("lämnar ut sändbart innehåll exakt en gång och blockerar extern adress när flaggan är av", async () => {
    const { supabase, state } = makeSupabase();
    const ctx = ctxOf(supabase);

    const extern = await seedReview(ctx, state, LEAD_B);
    await approveNurtureReviewCore(
      ctx,
      { reviewId: extern["id"], expectedFingerprint: extern["content_fingerprint"] },
      ENV_ON,
      okDispatch,
    );
    const blocked = await claimNurtureReviewCore(ctx, { reviewId: extern["id"] }, {});
    expect(blocked.ok).toBe(false);
    expect(blocked.code).toBe("external_send_disabled");
    expect(extern["status"]).toBe("approved");

    const test = state["nurture_reviews"]!.find((r) => r["lead_id"] === LEAD_A)!;
    await approveNurtureReviewCore(
      ctx,
      { reviewId: test["id"], expectedFingerprint: test["content_fingerprint"] },
      ENV_ON,
      okDispatch,
    );
    const claim = await claimNurtureReviewCore(ctx, { reviewId: test["id"] }, {});
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.recipientEmail).toBe("info@noryva.se");
    expect(claim.replyTo).toBe("info@noryva.se");
    expect(claim.externalEffect).toBe(false);

    const again = await claimNurtureReviewCore(ctx, { reviewId: test["id"] }, {});
    expect(again.ok).toBe(false);
    expect(again.code).toBe("not_claimable");
  });

  it("bokför utskick en gång, räknar steg en gång och är idempotent vid omtagning", async () => {
    const { supabase, state } = makeSupabase();
    const ctx = ctxOf(supabase);
    const review = await seedReview(ctx, state, LEAD_A);
    await approveNurtureReviewCore(
      ctx,
      { reviewId: review["id"], expectedFingerprint: review["content_fingerprint"] },
      ENV_ON,
      okDispatch,
    );
    const claim: any = await claimNurtureReviewCore(ctx, { reviewId: review["id"] }, {});

    const done = await completeNurtureReviewCore(ctx, {
      reviewId: review["id"],
      attemptId: claim.attemptId,
      transportMessageId: "<msg-1@noryva.se>",
    });
    const retry = await completeNurtureReviewCore(ctx, {
      reviewId: review["id"],
      attemptId: claim.attemptId,
      transportMessageId: "<msg-1@noryva.se>",
    });

    expect(done.ok).toBe(true);
    expect(retry.ok && retry.duplicate).toBe(true);
    expect(state["growth_nurture_state"]!.find((n) => n["lead_id"] === LEAD_A)!["steps_taken"]).toBe(1);
    const outbound = state["conversation_messages"]!.filter(
      (m) => String(m["source_ref"]).startsWith("nurture-transport:"),
    );
    expect(outbound.length).toBe(1);
    expect(outbound[0]!["channel"]).toBe("email");
  });

  it("okänt transportutfall släpper aldrig posten för nytt försök", async () => {
    const { supabase, state } = makeSupabase();
    const ctx = ctxOf(supabase);
    const review = await seedReview(ctx, state, LEAD_A);
    await approveNurtureReviewCore(
      ctx,
      { reviewId: review["id"], expectedFingerprint: review["content_fingerprint"] },
      ENV_ON,
      okDispatch,
    );
    const claim: any = await claimNurtureReviewCore(ctx, { reviewId: review["id"] }, {});

    const failed = await failNurtureReviewCore(ctx, {
      reviewId: review["id"],
      attemptId: claim.attemptId,
      reason: "SMTP timeout",
    });
    expect(failed.ok).toBe(true);
    expect(failed.reviewStatus).toBe("unknown");
    expect(failed.releasedForRetry).toBe(false);

    const reclaim = await claimNurtureReviewCore(ctx, { reviewId: review["id"] }, {});
    expect(reclaim.ok).toBe(false);
    const late = await completeNurtureReviewCore(ctx, {
      reviewId: review["id"],
      attemptId: claim.attemptId,
      transportMessageId: "<msg-late@noryva.se>",
    });
    expect(late.ok).toBe(false);
  });

  it("markerar bekräftat icke-skickat som failed", async () => {
    const { supabase, state } = makeSupabase();
    const ctx = ctxOf(supabase);
    const review = await seedReview(ctx, state, LEAD_A);
    await approveNurtureReviewCore(
      ctx,
      { reviewId: review["id"], expectedFingerprint: review["content_fingerprint"] },
      ENV_ON,
      okDispatch,
    );
    const claim: any = await claimNurtureReviewCore(ctx, { reviewId: review["id"] }, {});
    const failed = await failNurtureReviewCore(ctx, {
      reviewId: review["id"],
      attemptId: claim.attemptId,
      outcome: "not_sent",
      reason: "Avvisad adress",
    });
    expect(failed.reviewStatus).toBe("failed");
  });
});

/* ------------------------------------------------------------------ svar in */

describe("inkommande svar på skickad uppföljning", () => {
  async function sendOne() {
    const { supabase, state } = makeSupabase();
    const ctx = ctxOf(supabase);
    const review = await seedReview(ctx, state, LEAD_A);
    await approveNurtureReviewCore(
      ctx,
      { reviewId: review["id"], expectedFingerprint: review["content_fingerprint"] },
      ENV_ON,
      okDispatch,
    );
    const claim: any = await claimNurtureReviewCore(ctx, { reviewId: review["id"] }, {});
    await completeNurtureReviewCore(ctx, {
      reviewId: review["id"],
      attemptId: claim.attemptId,
      transportMessageId: "<thread-1@noryva.se>",
    });
    return { ctx, state, review };
  }

  it("registrerar svar via meddelande-id och dedupar på inkommande id", async () => {
    const { ctx, state } = await sendOne();
    const payload = {
      inReplyTo: "<thread-1@noryva.se>",
      fromEmail: "info@noryva.se",
      body: "Ja, det är fortfarande aktuellt.",
      messageId: "<in-1@example.com>",
    };

    const first = await registerReviewedNurtureReplyCore(ctx, payload);
    expect(first.ok).toBe(true);
    expect(first.code).toBe("registered");
    expect(first.notificationSent).toBe(false);
    expect(first.externalEffect).toBe(false);

    const second = await registerReviewedNurtureReplyCore(ctx, payload);
    expect(second.code).toBe("duplicate");
    const inbound = state["conversation_messages"]!.filter((m) => m["direction"] === "inbound");
    expect(inbound.length).toBe(1);
  });

  it("avvisar fel avsändare och okänd tråd", async () => {
    const { ctx } = await sendOne();
    const wrongSender = await registerReviewedNurtureReplyCore(ctx, {
      inReplyTo: "<thread-1@noryva.se>",
      fromEmail: "angripare@example.com",
      body: "Hej",
    });
    expect(wrongSender.ok).toBe(false);
    expect(wrongSender.code).toBe("sender_mismatch");

    const unknownThread = await registerReviewedNurtureReplyCore(ctx, {
      inReplyTo: "<finns-inte@example.com>",
      fromEmail: "info@noryva.se",
      body: "Hej",
    });
    expect(unknownThread.ok).toBe(false);
    expect(unknownThread.code).toBe("thread_not_found");
  });
});
