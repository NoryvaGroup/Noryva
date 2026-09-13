/**
 * Pilot readiness / kund-onboarding – READ-ONLY diagnostik.
 *
 * SÄKERHET: kräver inloggad administratör. Funktionen läser endast; den skriver
 * aldrig, aktiverar inget och triggar inga externa anrop (mail/SMS/Make/AI).
 * Varje delfråga är fail-safe: om en läsning misslyckas blir gruppen `null`,
 * vilket ger `unknown` i reglerna i stället för falskt grönt.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rowToMailChannel } from "./growth/mail-channel";
import {
  buildHandoff,
  evaluateReadiness,
  isTestCustomer,
  operationalIssues,
  summarizeGoNoGo,
  THRESHOLDS,
  type ReadinessFacts,
} from "./readiness/rules";

type AdminContext = { supabase: any; userId: string };

async function assertAdmin(context: AdminContext) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error || data !== true) throw new Error("Behörighet saknas.");
}

/** Returnerar `null` i stället för att kasta, så en trasig läsning ger unknown. */
async function safeRows(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<any[] | null> {
  try {
    const { data, error } = await query;
    if (error) return null;
    return (data as any[]) ?? [];
  } catch {
    return null;
  }
}

function groupBy<T>(rows: T[] | null, key: (row: T) => string | null): Map<string, T[]> | null {
  if (!rows) return null;
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    if (!id) continue;
    const list = map.get(id);
    if (list) list.push(row);
    else map.set(id, [row]);
  }
  return map;
}

function olderThan(iso: string | null | undefined, minutes: number) {
  if (!iso) return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return Date.now() - t > minutes * 60_000;
}

export const listPilotReadiness = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as AdminContext;
    await assertAdmin(ctx);

    const customers = await safeRows(
      ctx.supabase
        .from("customers")
        .select("id, name, slug, status, industry, recipient_email, delivery_webhook_url")
        .order("name")
        .limit(200),
    );
    if (!customers) throw new Error("Kunderna kunde inte hämtas.");

    const [questions, profiles, mailChannels, leads, nurture, reminders, inbound] = await Promise.all([
      safeRows(ctx.supabase.from("form_questions").select("customer_id, required").limit(2000)),
      safeRows(
        ctx.supabase
          .from("customer_profiles")
          .select("customer_id, notify_recipients, ai_assistant_enabled, execution_mode")
          .limit(500),
      ),
      safeRows(
        ctx.supabase
          .from("customer_mail_channels")
          .select("customer_id, provider, status, sender_email, sender_name, reply_to_email, verified_at")
          .limit(500),
      ),
      safeRows(
        ctx.supabase
          .from("leads")
          .select("id, customer_id, delivery_status, delivery_error, delivered_at, created_at, customer_status")
          .order("created_at", { ascending: false })
          .limit(1000),
      ),
      safeRows(
        ctx.supabase
          .from("nurture_reviews")
          .select("customer_id, status, claimed_at, sent_at, failure_reason, created_at")
          .order("created_at", { ascending: false })
          .limit(1000),
      ),
      safeRows(
        ctx.supabase
          .from("lead_reminder_deliveries")
          .select("customer_id, status, failure_reason, claimed_at, sent_at, created_at")
          .order("created_at", { ascending: false })
          .limit(1000),
      ),
      safeRows(
        ctx.supabase
          .from("nurture_inbound_events")
          .select("lead_id, status, created_at")
          .order("created_at", { ascending: false })
          .limit(1000),
      ),
    ]);

    const questionsBy = groupBy(questions, (q: any) => q.customer_id);
    const profileBy = new Map<string, any>((profiles ?? []).map((p: any) => [p.customer_id, p]));
    const mailBy = new Map<string, any>((mailChannels ?? []).map((m: any) => [m.customer_id, m]));
    const leadsBy = groupBy(leads, (l: any) => l.customer_id);
    const nurtureBy = groupBy(nurture, (n: any) => n.customer_id);
    const remindersBy = groupBy(reminders, (r: any) => r.customer_id);
    const leadCustomerById = new Map<string, string>((leads ?? []).map((l: any) => [l.id, l.customer_id]));
    const inboundBy = inbound
      ? groupBy(inbound, (e: any) => leadCustomerById.get(e.lead_id) ?? null)
      : null;

    const rows = customers.map((c: any) => {
      const customer = {
        id: String(c.id),
        name: String(c.name ?? ""),
        slug: String(c.slug ?? ""),
        status: String(c.status ?? ""),
        industry: String(c.industry ?? ""),
        recipientEmail: String(c.recipient_email ?? ""),
        deliveryWebhookUrl: String(c.delivery_webhook_url ?? ""),
      };

      const qRows = questionsBy?.get(customer.id) ?? (questionsBy ? [] : null);
      const profileRow = profiles ? (profileBy.get(customer.id) ?? null) : null;
      const mailRow = mailChannels ? (mailBy.get(customer.id) ?? null) : null;
      const leadRows = leadsBy?.get(customer.id) ?? (leadsBy ? [] : null);
      const nurtureRows = nurtureBy?.get(customer.id) ?? (nurtureBy ? [] : null);
      const reminderRows = remindersBy?.get(customer.id) ?? (remindersBy ? [] : null);
      const inboundRows = inboundBy?.get(customer.id) ?? (inboundBy ? [] : null);

      const latestLead = leadRows?.[0] ?? null;
      const channel = mailChannels ? rowToMailChannel(mailRow) : null;

      const facts: ReadinessFacts = {
        customer,
        questions: qRows
          ? { total: qRows.length, required: qRows.filter((q: any) => q.required === true).length }
          : null,
        profile: profiles
          ? {
              exists: Boolean(profileRow),
              notifyRecipients: Array.isArray(profileRow?.notify_recipients)
                ? profileRow.notify_recipients.filter((v: unknown) => String(v ?? "").trim()).length
                : 0,
              aiAssistantEnabled: profileRow?.ai_assistant_enabled === true,
              executionMode: String(profileRow?.execution_mode ?? ""),
            }
          : null,
        mailChannel: channel
          ? {
              configured: channel.configured,
              verified: channel.verified,
              status: channel.status,
              senderEmail: channel.senderEmail,
              replyToEmail: channel.replyToEmail,
              verifiedAt: channel.verifiedAt,
            }
          : null,
        leads: leadRows
          ? {
              total: leadRows.length,
              pending: leadRows.filter((l: any) => l.delivery_status === "pending").length,
              failed: leadRows.filter((l: any) => l.delivery_status === "failed").length,
              pendingOverWarn: leadRows.filter(
                (l: any) =>
                  l.delivery_status === "pending" &&
                  olderThan(l.created_at, THRESHOLDS.leadPendingWarnMinutes),
              ).length,
              pendingOverBlock: leadRows.filter(
                (l: any) =>
                  l.delivery_status === "pending" &&
                  olderThan(l.created_at, THRESHOLDS.leadPendingBlockMinutes),
              ).length,
              latest: latestLead
                ? {
                    deliveryStatus: String(latestLead.delivery_status ?? ""),
                    deliveryError: String(latestLead.delivery_error ?? ""),
                    deliveredAt: latestLead.delivered_at ?? null,
                    createdAt: String(latestLead.created_at ?? ""),
                  }
                : null,
            }
          : null,
        nurture: nurtureRows
          ? {
              pending: nurtureRows.filter((n: any) => n.status === "pending" || n.status === "planned").length,
              approved: nurtureRows.filter((n: any) => n.status === "approved").length,
              stuck: nurtureRows.filter(
                (n: any) => !n.sent_at && n.status === "claimed" && olderThan(n.claimed_at, THRESHOLDS.nurtureClaimedStuckMinutes),
              ).length,
              failed: nurtureRows.filter((n: any) => n.status === "failed" || n.status === "unknown").length,
            }
          : null,
        reminders: reminderRows
          ? {
              pending: reminderRows.filter((r: any) => r.status === "pending").length,
              failed: reminderRows.filter((r: any) => r.status === "failed" || r.status === "unknown").length,
              stuck: reminderRows.filter(
                (r: any) => !r.sent_at && r.status === "claimed" && olderThan(r.claimed_at, THRESHOLDS.reminderClaimedStuckMinutes),
              ).length,
              latestStatus: String(reminderRows[0]?.status ?? ""),
            }
          : null,
        replies: inboundRows
          ? {
              unprocessed: inboundRows.filter(
                (e: any) => e.status !== "done" && e.status !== "completed" && olderThan(e.created_at, THRESHOLDS.inboundUnprocessedMinutes),
              ).length,
            }
          : null,
        contacted: leadRows
          ? {
              total: leadRows.length,
              contacted: leadRows.filter((l: any) => String(l.customer_status ?? "").toLowerCase() === "kontaktad")
                .length,
            }
          : null,
      };

      const result = evaluateReadiness(facts);
      return {
        customer,
        isTest: isTestCustomer(customer),
        executionMode: facts.profile?.executionMode ?? "",
        status: result.status,
        coreReady: result.coreReady,
        fullReady: result.fullReady,
        checks: result.checks,
        blocking: result.blocking,
        warnings: result.warnings,
      };
    });

    return {
      readOnly: true as const,
      generatedAt: new Date().toISOString(),
      customers: rows,
      degraded: {
        questions: questions === null,
        profiles: profiles === null,
        mailChannels: mailChannels === null,
        leads: leads === null,
        nurture: nurture === null,
        reminders: reminders === null,
        inbound: inbound === null,
      },
    };
  });
