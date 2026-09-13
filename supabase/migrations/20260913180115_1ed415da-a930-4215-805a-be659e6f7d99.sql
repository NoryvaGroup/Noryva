CREATE OR REPLACE FUNCTION public.reserve_agent_run(p_role text, p_task_id uuid, p_run_kind text, p_reserved_cost_sek numeric, p_soft_cap_sek numeric, p_hard_cap_sek numeric, p_max_autonomous_runs_day integer, p_max_autonomous_runs_month integer, p_model text DEFAULT ''::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_spent numeric;
  v_runs_day_role integer;
  v_runs_day integer;
  v_runs_month integer;
  v_projected numeric;
  v_id uuid;
BEGIN
  IF p_run_kind NOT IN ('manual','autonomous','boardroom') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_kind', 'reason', 'Ogiltig körtyp.');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('noryva.agent_run_ledger'));

  SELECT COALESCE(sum(estimated_cost_sek), 0) INTO v_spent
    FROM public.agent_run_ledger
   WHERE status <> 'failed' AND created_at >= date_trunc('month', now());

  SELECT count(*) INTO v_runs_day_role
    FROM public.agent_run_ledger
   WHERE run_kind IN ('autonomous','boardroom') AND status <> 'failed'
     AND role = p_role AND created_at >= date_trunc('day', now());

  SELECT count(*) INTO v_runs_day
    FROM public.agent_run_ledger
   WHERE run_kind IN ('autonomous','boardroom') AND status <> 'failed'
     AND created_at >= date_trunc('day', now());

  SELECT count(*) INTO v_runs_month
    FROM public.agent_run_ledger
   WHERE run_kind IN ('autonomous','boardroom') AND status <> 'failed'
     AND created_at >= date_trunc('month', now());

  v_projected := v_spent + GREATEST(COALESCE(p_reserved_cost_sek, 0), 0);

  IF v_projected > p_hard_cap_sek THEN
    RETURN jsonb_build_object('ok', false, 'code', 'hard_blocked', 'state', 'hard_blocked', 'reason', 'Månadens hårda kostnadstak är nått. Inga nya agentkörningar startas.');
  END IF;

  IF p_run_kind IN ('autonomous','boardroom') THEN
    IF v_projected > p_soft_cap_sek THEN
      RETURN jsonb_build_object('ok', false, 'code', 'soft_paused', 'state', 'soft_paused', 'reason', 'Månadens mjuka kostnadstak är nått. Agentkörningar pausas.');
    END IF;
    IF v_runs_day_role >= p_max_autonomous_runs_day THEN
      RETURN jsonb_build_object('ok', false, 'code', 'daily_run_cap', 'state', 'run_capped', 'reason', 'Dygnets tak för agentkörningar är nått för den här agenten.');
    END IF;
    IF v_runs_month >= p_max_autonomous_runs_month THEN
      RETURN jsonb_build_object('ok', false, 'code', 'monthly_run_cap', 'state', 'run_capped', 'reason', 'Månadens tak för agentkörningar är nått.');
    END IF;
  END IF;

  INSERT INTO public.agent_run_ledger (task_id, role, run_kind, status, model, estimated_cost_sek)
  VALUES (p_task_id, p_role, p_run_kind, 'reserved', COALESCE(p_model, ''), GREATEST(COALESCE(p_reserved_cost_sek, 0), 0))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'code', 'reserved', 'state', 'ok', 'runId', v_id, 'spentMonthSek', v_projected);
END;
$function$;