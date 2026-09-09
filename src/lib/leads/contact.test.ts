import { afterEach, describe, expect, it, vi } from "vitest";
import { buildContactUrl, createContactToken, verifyContactToken } from "./contact-token";
import { loadLeadContactView, markLeadContactedCore } from "./contact.server";

const SECRET = "lead-action-test-secret";
const LEAD = "11111111-1111-4111-8111-111111111111";
const OTHER_LEAD = "22222222-2222-4222-8222-222222222222";
const env = { NORYVA_LEAD_ACTION_SECRET: SECRET } as Record<string, string | undefined>;

type Row = { id: string; customer_status: string; contacted_at: string | null; payload: unknown };

function fakeDb(rows: Row[]) {
  const updates: Array<Record<string, unknown>> = [];
  const supabase = {
    from() {
      const state: { id?: string; neq?: string; patch?: Record<string, unknown>; mode: string } = {
        mode: "select",
      };
      const api: any = {
        select() {
          return api;
        },
        update(patch: Record<string, unknown>) {
          state.mode = "update";
          state.patch = patch;
          return api;
        },
        eq(_col: string, value: string) {
          state.id = value;
          return api;
        },
        neq(_col: string, value: string) {
          state.neq = value;
          return api;
        },
        maybeSingle() {
          const row = rows.find((r) => r.id === state.id) ?? null;
          return Promise.resolve({ data: row, error: null });
        },
        then(resolve: (v: unknown) => void) {
          const row = rows.find((r) => r.id === state.id);
          if (row && state.patch && row.customer_status !== state.neq) {
            Object.assign(row, state.patch);
            updates.push({ id: row.id, ...state.patch });
          }
          resolve({ data: null, error: null });
        },
      };
      return api;
    },
  };
  return { supabase, updates, rows };
}

function row(id: string, status = "Ny"): Row {
  return { id, customer_status: status, contacted_at: null, payload: { foretagsnamn: "Testbolaget" } };
}

afterEach(() => vi.unstubAllGlobals());

describe("token", () => {
  it("godkänner en korrekt token för rätt lead", () => {
    const token = createContactToken({ secret: SECRET, leadId: LEAD });
    expect(verifyContactToken({ secret: SECRET, leadId: LEAD, token }).valid).toBe(true);
  });

  it("avvisar manipulerad token och fel lead", () => {
    const token = createContactToken({ secret: SECRET, leadId: LEAD });
    const [exp, sig] = token.split(".");
    const tampered = `${exp}.${sig!.slice(0, -1)}${sig!.endsWith("a") ? "b" : "a"}`;
    expect(verifyContactToken({ secret: SECRET, leadId: LEAD, token: tampered }).valid).toBe(false);
    expect(verifyContactToken({ secret: SECRET, leadId: OTHER_LEAD, token }).valid).toBe(false);
    expect(verifyContactToken({ secret: "annan", leadId: LEAD, token }).valid).toBe(false);
  });

  it("avvisar utgången token", () => {
    const token = createContactToken({ secret: SECRET, leadId: LEAD, ttlSeconds: 60 });
    const later = new Date(Date.now() + 120_000);
    const check = verifyContactToken({ secret: SECRET, leadId: LEAD, token, now: later });
    expect(check.valid).toBe(false);
    expect(check.reason).toMatch(/gått ut/);
  });

  it("bygger en publik Noryva-URL", () => {
    const url = buildContactUrl({ secret: SECRET, leadId: LEAD });
    expect(url.startsWith("https://noryva.se/lead/kontaktad?lead=")).toBe(true);
    expect(url).not.toMatch(/make\.com/);
  });
});

describe("kundåtgärd", () => {
  it("GET-vyn ändrar ingen status", async () => {
    const db = fakeDb([row(LEAD)]);
    const token = createContactToken({ secret: SECRET, leadId: LEAD });
    const view = await loadLeadContactView({ supabase: db.supabase, env, leadId: LEAD, token });
    expect(view.ok).toBe(true);
    expect(db.updates).toHaveLength(0);
    expect(db.rows[0]!.customer_status).toBe("Ny");
  });

  it("POST uppdaterar endast rätt lead", async () => {
    const db = fakeDb([row(LEAD), row(OTHER_LEAD)]);
    vi.stubGlobal("fetch", vi.fn());
    const token = createContactToken({ secret: SECRET, leadId: LEAD });
    const res = await markLeadContactedCore({ supabase: db.supabase, env, leadId: LEAD, token });
    expect(res).toMatchObject({ ok: true, status: "Kontaktad", alreadyDone: false });
    expect(db.rows[0]!.customer_status).toBe("Kontaktad");
    expect(db.rows[1]!.customer_status).toBe("Ny");
  });

  it("avvisar POST med token för ett annat lead", async () => {
    const db = fakeDb([row(LEAD), row(OTHER_LEAD)]);
    const token = createContactToken({ secret: SECRET, leadId: OTHER_LEAD });
    const res = await markLeadContactedCore({ supabase: db.supabase, env, leadId: LEAD, token });
    expect(res.ok).toBe(false);
    expect(db.updates).toHaveLength(0);
  });

  it("upprepad POST är idempotent", async () => {
    const db = fakeDb([row(LEAD)]);
    const token = createContactToken({ secret: SECRET, leadId: LEAD });
    await markLeadContactedCore({ supabase: db.supabase, env, leadId: LEAD, token });
    const second = await markLeadContactedCore({ supabase: db.supabase, env, leadId: LEAD, token });
    expect(second).toMatchObject({ ok: true, alreadyDone: true });
    expect(db.updates).toHaveLength(1);
  });

  it("synkfel mot Make ångrar inte databasstatusen", async () => {
    const db = fakeDb([row(LEAD)]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("nätverksfel");
      }),
    );
    const token = createContactToken({ secret: SECRET, leadId: LEAD });
    const res = await markLeadContactedCore({
      supabase: db.supabase,
      env: { ...env, NORYVA_LEAD_STATUS_WEBHOOK_URL: "https://example.invalid/hook" },
      leadId: LEAD,
      token,
    });
    expect(res).toMatchObject({ ok: true, status: "Kontaktad", synced: false });
    expect(db.rows[0]!.customer_status).toBe("Kontaktad");
  });
});
