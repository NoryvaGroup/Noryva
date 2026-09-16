CREATE OR REPLACE FUNCTION public.agent_budget_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Fail closed: endast admin (eller server-side service role, där auth.uid() är null
  -- och anropet sker med service_role) får läsa kostnadsöversikten.
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

REVOKE ALL ON FUNCTION public.agent_budget_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_budget_snapshot() TO authenticated, service_role;