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
  IF p_run_kind NOT IN ('manual','autonomous') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_kind',
                              'reason', 'Ogiltig körtyp.');
  END IF;

  -- Atomiskt: parallella workers serialiseras på samma lås innan taken läses.
  PERFORM pg_advisory_xact_lock(hashtext('noryva.agent_run_ledger'));

  SELECT COALESCE(sum(estimated_cost_sek), 0) INTO v_spent
    FROM public.agent_run_ledger
   WHERE status <> 'failed' AND created_at >= date_trunc('month', now());

  -- Dygnstaket gäller PER ROLL.
  SELECT count(*) INTO v_runs_day_role
    FROM public.agent_run_ledger
   WHERE run_kind = 'autonomous' AND status <> 'failed'
     AND role = p_role
     AND created_at >= date_trunc('day', now());

  SELECT count(*) INTO v_runs_day
    FROM public.agent_run_ledger
   WHERE run_kind = 'autonomous' AND status <> 'failed'
     AND created_at >= date_trunc('day', now());

  SELECT count(*) INTO v_runs_month
    FROM public.agent_run_ledger
   WHERE run_kind = 'autonomous' AND status <> 'failed'
     AND created_at >= date_trunc('month', now());

  v_projected := v_spent + GREATEST(COALESCE(p_reserved_cost_sek, 0), 0);

  IF v_projected > p_hard_cap_sek THEN
    RETURN jsonb_build_object('ok', false, 'code', 'hard_blocked', 'state', 'hard_blocked',
      'reason', 'Månadens hårda kostnadstak är nått. Inga nya agentkörningar startas.',
      'spentMonthSek', v_spent, 'autonomousRunsTodayRole', v_runs_day_role,
      'autonomousRunsToday', v_runs_day, 'autonomousRunsMonth', v_runs_month);
  END IF;

  IF p_run_kind = 'autonomous' THEN
    IF v_projected > p_soft_cap_sek THEN
      RETURN jsonb_build_object('ok', false, 'code', 'soft_paused', 'state', 'soft_paused',
        'reason', 'Månadens mjuka kostnadstak är nått. Autonoma körningar pausas.',
        'spentMonthSek', v_spent, 'autonomousRunsTodayRole', v_runs_day_role,
        'autonomousRunsToday', v_runs_day, 'autonomousRunsMonth', v_runs_month);
    END IF;
    IF v_runs_day_role >= p_max_autonomous_runs_day THEN
      RETURN jsonb_build_object('ok', false, 'code', 'daily_run_cap', 'state', 'run_capped',
        'reason', 'Dygnets tak för autonoma körningar är nått för den här agenten.',
        'spentMonthSek', v_spent, 'autonomousRunsTodayRole', v_runs_day_role,
        'autonomousRunsToday', v_runs_day, 'autonomousRunsMonth', v_runs_month);
    END IF;
    IF v_runs_month >= p_max_autonomous_runs_month THEN
      RETURN jsonb_build_object('ok', false, 'code', 'monthly_run_cap', 'state', 'run_capped',
        'reason', 'Månadens tak för autonoma körningar är nått.',
        'spentMonthSek', v_spent, 'autonomousRunsTodayRole', v_runs_day_role,
        'autonomousRunsToday', v_runs_day, 'autonomousRunsMonth', v_runs_month);
    END IF;
  END IF;

  INSERT INTO public.agent_run_ledger (task_id, role, run_kind, status, model, estimated_cost_sek)
  VALUES (p_task_id, p_role, p_run_kind, 'reserved', COALESCE(p_model, ''),
          GREATEST(COALESCE(p_reserved_cost_sek, 0), 0))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'code', 'reserved', 'state', 'ok',
    'runId', v_id, 'spentMonthSek', v_projected,
    'autonomousRunsTodayRole', v_runs_day_role + CASE WHEN p_run_kind = 'autonomous' THEN 1 ELSE 0 END,
    'autonomousRunsToday', v_runs_day + CASE WHEN p_run_kind = 'autonomous' THEN 1 ELSE 0 END,
    'autonomousRunsMonth', v_runs_month + CASE WHEN p_run_kind = 'autonomous' THEN 1 ELSE 0 END);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agent_budget_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'spentMonthSek', COALESCE((
      SELECT round(sum(estimated_cost_sek), 2) FROM public.agent_run_ledger
       WHERE status <> 'failed' AND created_at >= date_trunc('month', now())
    ), 0),
    'spentTodaySek', COALESCE((
      SELECT round(sum(estimated_cost_sek), 2) FROM public.agent_run_ledger
       WHERE status <> 'failed' AND created_at >= date_trunc('day', now())
    ), 0),
    'autonomousRunsToday', COALESCE((
      SELECT count(*) FROM public.agent_run_ledger
       WHERE run_kind = 'autonomous' AND status <> 'failed'
         AND created_at >= date_trunc('day', now())
    ), 0),
    'autonomousRunsTodayByRole', COALESCE((
      SELECT jsonb_object_agg(role, c) FROM (
        SELECT role, count(*) AS c FROM public.agent_run_ledger
         WHERE run_kind = 'autonomous' AND status <> 'failed'
           AND created_at >= date_trunc('day', now())
         GROUP BY role
      ) t
    ), '{}'::jsonb),
    'autonomousRunsMonth', COALESCE((
      SELECT count(*) FROM public.agent_run_ledger
       WHERE run_kind = 'autonomous' AND status <> 'failed'
         AND created_at >= date_trunc('month', now())
    ), 0),
    'runsMonth', COALESCE((
      SELECT count(*) FROM public.agent_run_ledger
       WHERE status <> 'failed' AND created_at >= date_trunc('month', now())
    ), 0)
  );
END;
$function$;