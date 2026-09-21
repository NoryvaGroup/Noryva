import { runtimeEnvFromRequest } from "@/lib/growth/runtime-env";
import { EMPTY_SNAPSHOT, evaluateBudgetGate, readBudgetConfig } from "./budget";
import { readBoardroomSpentTodaySek, recordAgentRunUsage, reserveAgentRun } from "./budget.server";
import {
  compactContext,
  budgetPause,
  managerRevisionMessage,
  meetingPrompt,
  normalizeRoleKey,
  parseMeetingOutput,
  planNextTurn,
  revisionRoles,
  type MeetingLike,
  type MeetingMessage,
  type MeetingStatus,
  type MeetingType,
} from "./boardroom";
import { runHarnessSession, type HarnessDeps, type HarnessRole } from "./openai-agents.server";
import { AGENT_EXTERNAL_ACTIONS_ENABLED, AGENT_POLICY, AUTHORITY_EXECUTE_ENABLED } from "./tasks";
import { V2_TASK_TYPE } from "./v2.server";

export type BoardroomContext = { supabase: any; userId: string; harness?: HarnessDeps };

const MEETING_COLUMNS =
  "id, agenda, meeting_type, status, created_by, started_at, completed_at, selected_roles, max_specialists, current_round, needs_cross_review, final_summary, recommendation, alternatives, expected_effect, risk_level, estimated_effort, estimated_cost_sek, approval_status, error, created_at, updated_at";
const MESSAGE_COLUMNS =
  "id, meeting_id, round, sequence, role, message_type, content, reply_to_message_id, task_id, provider_run_id, ledger_id, input_tokens, output_tokens, estimated_cost_sek, created_at";

export async function listMeetingsCore(ctx: BoardroomContext) {
  const { data: meetings, error } = await ctx.supabase
    .from("agent_meetings")
    .select(MEETING_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(12);
  if (error) throw new Error(error.message);
  const ids = (meetings ?? []).map((meeting: { id: string }) => meeting.id);
  let messages: any[] = [];
  if (ids.length > 0) {
    const response = await ctx.supabase
      .from("agent_meeting_messages")
      .select(MESSAGE_COLUMNS)
      .in("meeting_id", ids)
      .order("sequence", { ascending: true });
    if (response.error) throw new Error(response.error.message);
    messages = response.data ?? [];
  }
  return { meetings: meetings ?? [], messages, mode: "REVIEW" as const };
}

export async function createMeetingCore(
  ctx: BoardroomContext,
  input: { agenda: string; meetingType: MeetingType; maxSpecialists: number },
) {
  const { validateMeetingInput } = await import("./boardroom");
  const agenda = validateMeetingInput({ agenda: input.agenda, maxSpecialists: input.maxSpecialists });
  const { data, error } = await ctx.supabase
    .from("agent_meetings")
    .insert({
      agenda,
      meeting_type: input.meetingType,
      status: "draft",
      created_by: ctx.userId,
      max_specialists: input.maxSpecialists,
      approval_status: "pending",
    })
    .select("id")
    .single();
  if (error) {
    if (/agent_meetings_one_active_idx|duplicate key|23505/i.test(String(error.message ?? ""))) {
      throw new Error("Ett annat möte är redan aktivt. Slutför eller stoppa det först.");
    }
    throw new Error(error.message);
  }
  return { ok: true as const, meetingId: data.id as string, status: "draft" as const, externalEffect: false as const };
}

function taskKey(meetingId: string, role: string, messageType: string) {
  return `boardroom:${meetingId}:${messageType}:${role}`;
}

function taskInstructions(role: HarnessRole, agenda: string, stage: string) {
  return `${AGENT_POLICY[role]} Boardroom-steg: ${stage}. Agenda: ${agenda.slice(0, 1200)}`;
}

function asMessages(rows: Record<string, unknown>[]): MeetingMessage[] {
  return rows.map((row) => ({
    role: String(row["role"]) as MeetingMessage["role"],
    message_type: String(row["message_type"]) as MeetingMessage["message_type"],
    content: String(row["content"] ?? ""),
    round: Number(row["round"] ?? 0),
    sequence: Number(row["sequence"] ?? 0),
  }));
}

function derivePausedStatus(meeting: MeetingLike, messages: MeetingMessage[]): MeetingStatus {
  if (meeting.status !== "paused_budget") return meeting.status;
  if (!messages.some((m) => m.message_type === "kickoff")) return "manager_kickoff";
  const selected = meeting.selected_roles;
  const analysed = new Set(messages.filter((m) => m.message_type === "analysis").map((m) => m.role));
  if (selected.some((role) => !analysed.has(role as MeetingMessage["role"]))) return "round_1";
  const critiqued = new Set(messages.filter((m) => m.message_type === "critique").map((m) => m.role));
  const requested = revisionRoles(messages);
  if (requested.length && requested.some((role) => !critiqued.has(role as MeetingMessage["role"]))) {
    return "cross_review";
  }
  if (meeting.needs_cross_review && !requested.length) {
    if (selected.some((role) => !critiqued.has(role as MeetingMessage["role"]))) return "cross_review";
  }
  if (!messages.some((m) => m.message_type === "qa_review")) return "qa_review";
  return "manager_synthesis";
}

async function createOrLoadTurnTask(ctx: BoardroomContext, input: {
  meetingId: string; role: HarnessRole; messageType: string; agenda: string; revision?: boolean;
}) {
  const key = taskKey(input.meetingId, input.role, input.messageType) + (input.revision ? ":revision" : "");
  const { data: existing, error: existingError } = await ctx.supabase
    .from("agent_tasks")
    .select("id, status, result, provider_run_id, provider_agent_id, usage, idempotency_key, runs_used, run_status")
    .eq("idempotency_key", key)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) return existing as Record<string, any>;
  const { data, error } = await ctx.supabase
    .from("agent_tasks")
    .insert({
      customer_id: null,
      lead_id: null,
      assigned_agent: input.role,
      task_type: V2_TASK_TYPE[input.role],
      priority: "normal",
      status: "queued",
      instructions: taskInstructions(input.role, input.agenda, input.messageType),
      // Internt mötessteg: valideras av boardroom-schemat och Manager, inte av användaren.
      // Endast mötets slutliga syntes går till meeting-level approval.
      requires_approval: false,
      approval_status: "pending",
      source_event: "boardroom_turn",
      idempotency_key: key,
      execution_mode: "review",
      provider_type: "openai_agents",
      run_status: "not_started",
      run_budget: 1,
      runs_used: 0,
    })
    .select("id, status, result, provider_run_id, provider_agent_id, usage, idempotency_key, runs_used, run_status")
    .single();
  if (error) {
    if (/duplicate key|23505/i.test(String(error.message ?? ""))) {
      const { data: winner, error: winnerError } = await ctx.supabase
        .from("agent_tasks")
        .select("id, status, result, provider_run_id, provider_agent_id, usage, idempotency_key, runs_used, run_status")
        .eq("idempotency_key", key)
        .maybeSingle();
      if (winnerError || !winner) throw new Error(winnerError?.message ?? "Mötessteget kunde inte återläsas.");
      return winner as Record<string, any>;
    }
    throw new Error(error.message);
  }
  return data as Record<string, any>;
}

async function releaseClaim(ctx: BoardroomContext, meetingId: string, token: string, update: Record<string, unknown>) {
  const { error } = await ctx.supabase
    .from("agent_meetings")
    .update({ ...update, processing_token: null, claimed_at: null })
    .eq("id", meetingId)
    .eq("processing_token", token);
  if (error) throw new Error(error.message);
}

function outputContent(parsed: Record<string, unknown>) {
  return JSON.stringify(parsed);
}

export async function advanceMeetingCore(ctx: BoardroomContext, meetingId: string) {
  if (AUTHORITY_EXECUTE_ENABLED || AGENT_EXTERNAL_ACTIONS_ENABLED) {
    throw new Error("Mötesmotorn kräver att alla externa befogenheter är avstängda.");
  }
  const { data: rawMeeting, error } = await ctx.supabase
    .from("agent_meetings")
    .select(MEETING_COLUMNS)
    .eq("id", meetingId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!rawMeeting) throw new Error("Mötet hittades inte.");
  const { data: rawMessages, error: messageError } = await ctx.supabase
    .from("agent_meeting_messages")
    .select(MESSAGE_COLUMNS)
    .eq("meeting_id", meetingId)
    .order("sequence", { ascending: true });
  if (messageError) throw new Error(messageError.message);

  const messages = asMessages(rawMessages ?? []);
  const effectiveStatus = derivePausedStatus(rawMeeting as MeetingLike, messages);
  const meeting = { ...(rawMeeting as MeetingLike), status: effectiveStatus };
  const turn = planNextTurn(meeting, messages);
  if (!turn) {
    if (["awaiting_approval", "completed"].includes(String(rawMeeting.status))) {
      return { ok: true as const, duplicate: true as const, status: rawMeeting.status, externalEffect: false as const };
    }
    throw new Error("Mötet saknar ett säkert nästa steg.");
  }

  const { data: token, error: claimError } = await ctx.supabase.rpc("claim_agent_meeting_turn", {
    p_meeting_id: meetingId,
    p_expected_status: rawMeeting.status,
  });
  if (claimError) throw new Error(claimError.message);
  if (!token) return { ok: true as const, duplicate: true as const, status: rawMeeting.status, externalEffect: false as const };

  try {
  const task = await createOrLoadTurnTask(ctx, {
    meetingId,
    role: turn.role,
    messageType: turn.messageType,
    agenda: meeting.agenda,
    revision: turn.messageType === "synthesis" && Boolean(managerRevisionMessage(messages)),
  });

  let parsed: Record<string, unknown> | null = null;
  let providerRunId = String(task["provider_run_id"] ?? "");
  let providerAgentId = "";
  let usage = (task["usage"] ?? {}) as { inputTokens?: number; outputTokens?: number };
  const checkpoint = { ...((task["result"] ?? {}) as Record<string, any>) };
  let ledgerId = String(checkpoint["ledgerId"] ?? "");
  let costSek = Number(checkpoint["costSek"] ?? 0);
  let providerRuns = 0;
  const saveTask = async (patch: Record<string, unknown>) => {
    const saved = await ctx.supabase.from("agent_tasks").update(patch).eq("id", task["id"]).select("id");
    if (saved.error || !saved.data?.length) throw new Error(saved.error?.message ?? "Mötessteget kunde inte sparas.");
  };
  const savedRawOutput = String((task["result"] as Record<string, unknown> | null)?.["rawOutput"] ?? "");
  if (task["status"] === "awaiting_review" && task["result"]?.boardroomOutput) {
    parsed = task["result"].boardroomOutput as Record<string, unknown>;
  } else if (savedRawOutput) {
    // Redan betald provider-output finns sparad. Tolka om lokalt – aldrig ett
    // nytt anrop bara för att en tidigare parsning misslyckades.
    parsed = parseMeetingOutput(turn.messageType, savedRawOutput) as Record<string, unknown>;
    providerRunId = String(task["provider_run_id"] ?? "");
    await saveTask({ status: "awaiting_review", run_status: "completed", result: { ...checkpoint, boardroomOutput: parsed, externalEffect: false } });
  } else {

    const budgetConfig = readBudgetConfig(ctx.harness?.env ?? runtimeEnvFromRequest(ctx.harness?.request));
    if (providerRunId) {
      // Old versions did not save the ledger id in the task. Reuse its latest
      // existing reservation; never reserve or start a second provider run.
      if (!ledgerId) {
        const ledger = await ctx.supabase.from("agent_run_ledger").select("id")
          .eq("task_id", task["id"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (ledger.error || !ledger.data?.id) throw new Error("Sessionens budgetrad saknas; ingen ny körning startades.");
        ledgerId = String(ledger.data.id);
      }
    } else {
      if (task["status"] !== "queued" || Number(task["runs_used"] ?? 0) > 0) {
        await releaseClaim(ctx, meetingId, String(token), { status: "failed", error: "Sessionsstartens utfall är okänt. Kräver avstämning innan en ny körning kan startas." });
        throw new Error("Sessionsstartens utfall är okänt. Ingen ny körning startades.");
      }
      const boardroomSpentTodaySek = await readBoardroomSpentTodaySek(ctx, budgetConfig);
      const dayGate = evaluateBudgetGate({
        kind: "boardroom", role: turn.role,
        snapshot: { ...EMPTY_SNAPSHOT, boardroomSpentTodaySek, boardroomMeetingSpentSek: Number(rawMeeting.estimated_cost_sek ?? 0) || 0 },
        config: budgetConfig,
      });
      if (!dayGate.allowed) {
        await releaseClaim(ctx, meetingId, String(token), budgetPause(dayGate.reason));
        return { ok: false as const, paused: true as const, status: "paused_budget" as const, reason: dayGate.reason, externalEffect: false as const };
      }
      const reservation = await reserveAgentRun(ctx, { role: turn.role, taskId: String(task["id"]), kind: "boardroom", config: budgetConfig });
      if (!reservation.ok) {
        await releaseClaim(ctx, meetingId, String(token), budgetPause(reservation.reason));
        return { ok: false as const, paused: true as const, status: "paused_budget" as const, reason: reservation.reason, externalEffect: false as const };
      }
      ledgerId = reservation.runId;
      const claimed = await ctx.supabase.from("agent_tasks")
        .update({ status: "in_progress", run_status: "running", runs_used: 1, result: { ledgerId, externalEffect: false } })
        .eq("id", task["id"]).eq("status", "queued").select("id");
      if (claimed.error || !claimed.data?.length) {
        await recordAgentRunUsage(ctx, { runId: ledgerId, role: turn.role, status: "failed", config: budgetConfig, strict: true });
        if (claimed.error) throw new Error(claimed.error.message);
        await releaseClaim(ctx, meetingId, String(token), {});
        return { ok: true as const, duplicate: true as const, status: rawMeeting.status, externalEffect: false as const };
      }
    }
    // Charge the conservative estimate before network I/O. A running/unknown
    // session is not free and must not age out as an orphaned reservation.
    // Ledger 'completed' represents an accounted charge, not task completion.
    costSek = await recordAgentRunUsage(ctx, { runId: ledgerId, role: turn.role, status: "completed", inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0, config: budgetConfig, strict: true });
    const run = await runHarnessSession(
      {
        role: turn.role,
        instructions: taskInstructions(turn.role, meeting.agenda, turn.messageType),
        input: meetingPrompt(meeting, turn, messages),
        requestKey: String(task["idempotency_key"] ?? taskKey(meetingId, turn.role, turn.messageType)),
        ...(providerRunId ? { resumeSessionId: providerRunId } : {}),
      },
      {
        ...(ctx.harness ?? {}),
        // Return while the session is still running; the UI continues polling.
        timeoutMs: ctx.harness?.timeoutMs ?? 15_000,
        onSession: async (sessionId) => {
          await saveTask({ provider_run_id: sessionId, status: "in_progress", run_status: "running", result: { ledgerId, costSek, externalEffect: false } });
        },
        onCompleted: async (completed) => {
          costSek = await recordAgentRunUsage(ctx, { runId: ledgerId, role: turn.role, status: "completed", inputTokens: completed.usage.inputTokens, outputTokens: completed.usage.outputTokens, config: budgetConfig, strict: true });
          // Persist recoverable output BEFORE provider cleanup or parsing.
          await saveTask({ provider_run_id: completed.providerRunId, provider_agent_id: completed.providerAgentId, usage: completed.usage, run_status: "completed", result: { ledgerId, costSek, rawOutput: completed.outputText, externalEffect: false } });
        },
      },
    );
    providerRunId = run.providerRunId;
    providerAgentId = run.providerAgentId;
    providerRuns = run.usage.runs;
    usage = run.usage;
    if (!run.ok) {
      if (run.phase === "poll" && run.runStatus === "running" && providerRunId) {
        await saveTask({
          result: {
            ...checkpoint,
            ledgerId,
            costSek,
            providerDiagnostic: run.error,
            externalEffect: false,
          },
        });
        await releaseClaim(ctx, meetingId, String(token), { status: effectiveStatus, error: "" });
        return { ok: true as const, pending: true as const, status: effectiveStatus, providerRuns, externalEffect: false as const };
      }
      // An explicit 409 without a session is the only automatic create retry.
      const conflict = /status 409\b/i.test(run.error) && !providerRunId;
      await saveTask({ status: conflict ? "queued" : "failed", run_status: conflict ? "not_started" : run.runStatus, provider_run_id: providerRunId, runs_used: conflict ? 0 : 1, result: { ledgerId, costSek, externalEffect: false }, usage });
      if (conflict) await recordAgentRunUsage(ctx, { runId: ledgerId, role: turn.role, status: "failed", config: budgetConfig, strict: true });
      await releaseClaim(ctx, meetingId, String(token), { status: conflict ? effectiveStatus : "failed", error: run.error });
      if (conflict) return { ok: true as const, pending: true as const, status: effectiveStatus, providerRuns: 0, externalEffect: false as const };
      throw new Error(run.error);
    }
    try {
      parsed = parseMeetingOutput(turn.messageType, run.outputText) as Record<string, unknown>;
    } catch (parseError) {
      await saveTask({ status: "failed" });
      await releaseClaim(ctx, meetingId, String(token), { status: "failed", error: (parseError as Error).message });
      throw parseError;
    }
    await saveTask({ status: "awaiting_review", run_status: "completed", provider_run_id: providerRunId, provider_agent_id: providerAgentId, usage, result: { ledgerId, costSek, rawOutput: run.outputText, boardroomOutput: parsed, externalEffect: false } });
  }

  if (!parsed) throw new Error("Mötessteget saknar ett sparat resultat.");

  // Manager får EN gång begära riktad komplettering innan slutsatsen skrivs.
  // Loop-skydd: bara en revision per möte, och aldrig från en roll som redan
  // levererat sin komplettering – annars går mötet direkt till slutsats.
  const critiquedRoles = new Set(messages.filter((m) => m.message_type === "critique").map((m) => m.role));
  const requestedRevision =
    turn.messageType === "synthesis" && !managerRevisionMessage(messages)
      ? (Array.isArray(parsed["revisionRoles"]) ? parsed["revisionRoles"] : [])
          .map((role) => normalizeRoleKey(role))
          .filter((role) => meeting.selected_roles.includes(role) && !critiquedRoles.has(role as never))
      : [];
  const isRevisionRequest = requestedRevision.length > 0;
  const messageType = isRevisionRequest ? "critique" : turn.messageType;
  const nextStatus = isRevisionRequest ? "cross_review" : turn.nextStatus;
  const content = isRevisionRequest
    ? JSON.stringify({
        summary: String(parsed["summary"] ?? "Manager begär riktad komplettering."),
        revisionRoles: requestedRevision,
        revisionFocus: String(parsed["revisionFocus"] ?? ""),
      })
    : outputContent(parsed);

  const messageInsert = {
    meeting_id: meetingId,
    round: turn.round,
    sequence: messages.length + 1,
    role: turn.role,
    message_type: messageType,
    content,
    task_id: task["id"],
    provider_run_id: providerRunId,
    ledger_id: ledgerId || null,
    input_tokens: Number(usage.inputTokens ?? 0),
    output_tokens: Number(usage.outputTokens ?? 0),
    estimated_cost_sek: costSek,
  };
  const { error: insertError } = await ctx.supabase.from("agent_meeting_messages").insert(messageInsert);
  if (insertError && !/duplicate key|23505/i.test(insertError.message)) throw new Error(insertError.message);

  const update: Record<string, unknown> = {
    status: nextStatus,
    current_round: turn.round,
    error: "",
    estimated_cost_sek: Number(rawMeeting.estimated_cost_sek ?? 0) + costSek,
    started_at: rawMeeting.started_at ?? new Date().toISOString(),
  };
  if (turn.messageType === "kickoff") {
    const selectedRoles = Array.isArray(parsed["selectedRoles"])
      ? parsed["selectedRoles"].slice(0, meeting.max_specialists)
      : [];
    if (selectedRoles.length < 2) {
      await releaseClaim(ctx, meetingId, String(token), { status: "failed", error: "Manager valde för få specialistroller." });
      throw new Error("Manager valde för få specialistroller.");
    }
    update["selected_roles"] = selectedRoles;
    update["needs_cross_review"] = parsed["needsCrossReview"];
  }
  if (turn.messageType === "synthesis" && !isRevisionRequest) {
    update["final_summary"] = parsed["summary"];
    update["recommendation"] = parsed["recommendation"];
    update["alternatives"] = parsed["alternatives"];
    update["expected_effect"] = parsed["expectedEffect"];
    update["risk_level"] = parsed["riskLevel"];
    update["estimated_effort"] = parsed["estimatedEffort"];
    update["completed_at"] = new Date().toISOString();
  }
  await releaseClaim(ctx, meetingId, String(token), update);
  return {
    ok: true as const,
    duplicate: false as const,
    status: nextStatus,
    role: turn.role,
    messageType,
    providerRuns,
    externalEffect: false as const,
  };
  } catch (error) {
    // Release only our token; never disturb a newer claim or cancellation.
    await releaseClaim(ctx, meetingId, String(token), {});
    throw error;
  }
}

export { compactContext };
