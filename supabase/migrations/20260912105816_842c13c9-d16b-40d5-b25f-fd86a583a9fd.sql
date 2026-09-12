CREATE TABLE IF NOT EXISTS public.agent_run_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid,
  role text NOT NULL,
  run_kind text NOT NULL CHECK (run_kind IN ('manual','autonomous')),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','completed','failed')),
  model text NOT NULL DEFAULT '',
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  estimated_cost_sek numeric(12,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.agent_run_ledger TO authenticated;
GRANT ALL ON public.agent_run_ledger TO service_role;

ALTER TABLE public.agent_run_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can read agent run ledger" ON public.agent_run_ledger;
CREATE POLICY "Admins can read agent run ledger"
  ON public.agent_run_ledger FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS agent_run_ledger_created_at_idx ON public.agent_run_ledger (created_at DESC);
CREATE INDEX IF NOT EXISTS agent_run_ledger_kind_created_idx ON public.agent_run_ledger (run_kind, created_at DESC);

DROP TRIGGER IF EXISTS agent_run_ledger_updated_at ON public.agent_run_ledger;
CREATE TRIGGER agent_run_ledger_updated_at
  BEFORE UPDATE ON public.agent_run_ledger
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.agent_budget_snapshot()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
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
    'autonomousRunsMonth', COALESCE((
      SELECT count(*) FROM public.agent_run_ledger
       WHERE run_kind = 'autonomous' AND status <> 'failed'
         AND created_at >= date_trunc('month', now())
    ), 0),
    'runsMonth', COALESCE((
      SELECT count(*) FROM public.agent_run_ledger
       WHERE status <> 'failed' AND created_at >= date_trunc('month', now())
    ), 0)
  )
$function$;

CREATE OR REPLACE FUNCTION public.reserve_agent_run(
  p_role text,
  p_task_id uuid,
  p_run_kind text,
  p_reserved_cost_sek numeric,
  p_soft_cap_sek numeric,
  p_hard_cap_sek numeric,
  p_max_autonomous_runs_day integer,
  p_max_autonomous_runs_month integer,
  p_model text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_spent numeric;
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
      'spentMonthSek', v_spent, 'autonomousRunsToday', v_runs_day,
      'autonomousRunsMonth', v_runs_month);
  END IF;

  IF p_run_kind = 'autonomous' THEN
    IF v_projected > p_soft_cap_sek THEN
      RETURN jsonb_build_object('ok', false, 'code', 'soft_paused', 'state', 'soft_paused',
        'reason', 'Månadens mjuka kostnadstak är nått. Autonoma körningar pausas.',
        'spentMonthSek', v_spent, 'autonomousRunsToday', v_runs_day,
        'autonomousRunsMonth', v_runs_month);
    END IF;
    IF v_runs_day >= p_max_autonomous_runs_day THEN
      RETURN jsonb_build_object('ok', false, 'code', 'daily_run_cap', 'state', 'run_capped',
        'reason', 'Dygnets tak för autonoma körningar är nått.',
        'spentMonthSek', v_spent, 'autonomousRunsToday', v_runs_day,
        'autonomousRunsMonth', v_runs_month);
    END IF;
    IF v_runs_month >= p_max_autonomous_runs_month THEN
      RETURN jsonb_build_object('ok', false, 'code', 'monthly_run_cap', 'state', 'run_capped',
        'reason', 'Månadens tak för autonoma körningar är nått.',
        'spentMonthSek', v_spent, 'autonomousRunsToday', v_runs_day,
        'autonomousRunsMonth', v_runs_month);
    END IF;
  END IF;

  INSERT INTO public.agent_run_ledger (task_id, role, run_kind, status, model, estimated_cost_sek)
  VALUES (p_task_id, p_role, p_run_kind, 'reserved', COALESCE(p_model, ''),
          GREATEST(COALESCE(p_reserved_cost_sek, 0), 0))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'code', 'reserved', 'state', 'ok',
    'runId', v_id, 'spentMonthSek', v_projected,
    'autonomousRunsToday', v_runs_day + CASE WHEN p_run_kind = 'autonomous' THEN 1 ELSE 0 END,
    'autonomousRunsMonth', v_runs_month + CASE WHEN p_run_kind = 'autonomous' THEN 1 ELSE 0 END);
END;
$function$;

REVOKE ALL ON FUNCTION public.reserve_agent_run(text, uuid, text, numeric, numeric, numeric, integer, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_agent_run(text, uuid, text, numeric, numeric, numeric, integer, integer, text) TO service_role;
REVOKE ALL ON FUNCTION public.agent_budget_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_budget_snapshot() TO authenticated, service_role;