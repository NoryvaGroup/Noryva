import { beforeEach, describe, expect, it, vi } from "vitest";
import { advanceMeetingCore } from "./boardroom.server";
import { AGENTS_SESSIONS_URL } from "./openai-agents.server";

const budget = vi.hoisted(() => ({
  reserve: vi.fn(), record: vi.fn(), spent: vi.fn(),
}));
vi.mock("./budget.server", async (original) => ({
  ...await original<typeof import("./budget.server")>(),
  reserveAgentRun: budget.reserve,
  recordAgentRunUsage: budget.record,
  readBoardroomSpentTodaySek: budget.spent,
}));

const output = JSON.stringify({ summary: "Vi granskar nästa produktprioritering", selectedRoles: ["product_tech", "growth_sales"], needsCrossReview: false });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fixture() {
  const meeting: Record<string, any> = { id: "meeting", status: "draft", agenda: "Granska nästa interna produktprioritering", selected_roles: [], max_specialists: 3, needs_cross_review: false, estimated_cost_sek: 0, processing_token: null };
  const task: Record<string, any> = { id: "task", status: "queued", run_status: "not_started", runs_used: 0, result: {}, provider_run_id: "", idempotency_key: "boardroom:meeting:kickoff:noryva_manager" };
  const tables: Record<string, Record<string, any>[]> = { agent_meetings: [meeting], agent_tasks: [task], agent_meeting_messages: [], agent_run_ledger: [{ id: "ledger", task_id: "task" }] };
  const control = { failRaw: false, failParsed: false, ready: false, failCreate: false };
  const db = {
    rpc: vi.fn(async () => {
      if (meeting['processing_token']) return { data: null, error: null };
      meeting['processing_token'] = 'claim';
      return { data: 'claim', error: null };
    }),
    from(table: string) {
      let patch: Record<string, any> | undefined;
      let inserted: Record<string, any> | undefined;
      const filters: ((row: Record<string, any>) => boolean)[] = [];
      const run = () => {
        const rows = tables[table]!.filter(row => filters.every(f => f(row)));
        if (table === 'agent_tasks' && ((control.failRaw && patch?.['result']?.rawOutput) || (control.failParsed && patch?.['result']?.boardroomOutput))) return { data: null, error: { message: 'persistence failed' } };
        if (patch) rows.forEach(row => Object.assign(row, patch));
        if (inserted) { tables[table]!.push(inserted); return { data: [inserted], error: null }; }
        return { data: structuredClone(rows), error: null };
      };
      const query: any = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return query; },
        order: () => query, limit: () => query,
        update: (value: Record<string, any>) => { patch = value; return query; },
        insert: (value: Record<string, any>) => { inserted = value; return query; },
        maybeSingle: async () => { const r = run(); return { ...r, data: r.data?.[0] ?? null }; },
        single: async () => { const r = run(); return { ...r, data: r.data?.[0] ?? null }; },
        then: (resolve: (value: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
      };
      return query;
    },
  };
  const network = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "POST") {
      if (control.failCreate) throw new Error("unknown POST outcome");
      return response({ id: "sess_recover" });
    }
    if (init?.method === "DELETE") {
      expect(task['result'].rawOutput).toBe(output);
      return response({ deleted: true });
    }
    if (String(url).includes('/items')) {
      expect(task['provider_run_id']).toBe('sess_recover');
      expect(task['result'].ledgerId).toBe('ledger');
      return response({ data: control.ready ? [{ type: "message", role: "assistant", status: "completed", content: [{ text: output }] }] : [] });
    }
    return response({ usage: { input_tokens: 100, output_tokens: 50 } });
  });
  const ctx = { supabase: db, userId: 'admin', harness: { env: { NORYVA_AGENTS_API_ENABLED: 'true', OPENAI_API_KEY: 'sk-test' }, fetchImpl: network as typeof fetch, timeoutMs: 1, conflictBackoffMs: [] } };
  return { ctx, task, meeting, control, network, tables };
}

beforeEach(() => {
  budget.reserve.mockReset().mockResolvedValue({ ok: true, runId: 'ledger' });
  budget.record.mockReset().mockResolvedValue(0.5);
  budget.spent.mockReset().mockResolvedValue(0);
});

describe('boardroom session recovery', () => {
  it('resumes multiple pending polls with one POST and one reservation, then persists before DELETE', async () => {
    const f = fixture();
    for (let i = 0; i < 4; i++) expect(await advanceMeetingCore(f.ctx, 'meeting')).toMatchObject({ ok: true, pending: true });
    expect(f.task['status']).toBe('in_progress');
    expect(f.meeting['processing_token']).toBeNull();
    f.control.ready = true;
    expect(await advanceMeetingCore(f.ctx, 'meeting')).toMatchObject({ ok: true, status: 'round_1', providerRuns: 0 });
    expect(budget.reserve).toHaveBeenCalledTimes(1);
    expect(f.network.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(f.tables['agent_meeting_messages']).toHaveLength(1);
    expect(f.task['result'].ledgerId).toBe('ledger');
    expect(f.meeting['estimated_cost_sek']).toBe(0.5);
    expect(budget.record.mock.calls.every(([, input]) => input.status === 'completed')).toBe(true);
  });
  it('does not delete output when durable storage fails, and reuses session on retry', async () => {
    const f = fixture(); f.control.ready = true; f.control.failRaw = true;
    await expect(advanceMeetingCore(f.ctx, 'meeting')).rejects.toThrow('persistence failed');
    expect(f.network.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    expect(f.task['provider_run_id']).toBe('sess_recover');
    f.control.failRaw = false;
    await advanceMeetingCore(f.ctx, 'meeting');
    expect(f.network.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
  it('reuses durable raw output after cleanup if parsing-result persistence failed', async () => {
    const f = fixture(); f.control.ready = true; f.control.failParsed = true;
    await expect(advanceMeetingCore(f.ctx, 'meeting')).rejects.toThrow('persistence failed');
    expect(f.task['result'].rawOutput).toBe(output);
    const calls = f.network.mock.calls.length;
    f.control.failParsed = false;
    await advanceMeetingCore(f.ctx, 'meeting');
    expect(f.network).toHaveBeenCalledTimes(calls);
    expect(f.meeting['estimated_cost_sek']).toBe(0.5);
  });
  it('concurrent advances create only one provider session', async () => {
    const f = fixture();
    const results = await Promise.all([advanceMeetingCore(f.ctx, 'meeting'), advanceMeetingCore(f.ctx, 'meeting')]);
    expect(results.some(r => 'duplicate' in r && r.duplicate)).toBe(true);
    expect(f.network.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(budget.reserve).toHaveBeenCalledTimes(1);
  });
  it('unknown create outcome stops automatic retries and retains conservative accounting', async () => {
    const f = fixture(); f.control.failCreate = true;
    await expect(advanceMeetingCore(f.ctx, 'meeting')).rejects.toThrow('phase=create');
    expect(f.task['status']).toBe('failed');
    expect(f.task['runs_used']).toBe(1);
    expect(budget.record.mock.calls.every(([, input]) => input.status === 'completed')).toBe(true);
    await expect(advanceMeetingCore(f.ctx, 'meeting')).rejects.toThrow();
    expect(f.network.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
  });
  it('strict accounting failure blocks POST and releases the meeting claim', async () => {
    const f = fixture(); budget.record.mockRejectedValue(new Error('ledger unavailable'));
    await expect(advanceMeetingCore(f.ctx, 'meeting')).rejects.toThrow('ledger unavailable');
    expect(f.network).not.toHaveBeenCalled();
    expect(f.meeting['processing_token']).toBeNull();
  });
  it('an older failed task with a known session reuses its ledger instead of starting again', async () => {
    const f = fixture(); f.task['status'] = 'failed'; f.task['provider_run_id'] = 'sess_recover'; f.control.ready = true;
    await advanceMeetingCore(f.ctx, 'meeting');
    expect(budget.reserve).not.toHaveBeenCalled();
    expect(f.network.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
    expect(f.task['status']).toBe('awaiting_review');
  });
});
