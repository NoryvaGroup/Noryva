CREATE OR REPLACE FUNCTION public.agent_budget_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY INVOKER
SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
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
       WHERE run_kind IN ('autonomous','boardroom') AND status <> 'failed'
         AND created_at >= date_trunc('day', now())
    ), 0),
    'autonomousRunsTodayByRole', COALESCE((
      SELECT jsonb_object_agg(role, c) FROM (
        SELECT role, count(*) AS c FROM public.agent_run_ledger
         WHERE run_kind IN ('autonomous','boardroom') AND status <> 'failed'
           AND created_at >= date_trunc('day', now())
         GROUP BY role
      ) t
    ), '{}'::jsonb),
    'autonomousRunsMonth', COALESCE((
      SELECT count(*) FROM public.agent_run_ledger
       WHERE run_kind IN ('autonomous','boardroom') AND status <> 'failed'
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