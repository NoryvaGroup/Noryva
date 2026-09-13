CREATE OR REPLACE FUNCTION public.claim_agent_meeting_turn(p_meeting_id uuid, p_expected_status text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_token uuid := gen_random_uuid();
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.agent_meetings
  SET processing_token = v_token, claimed_at = now(), updated_at = now()
  WHERE id = p_meeting_id
    AND status = p_expected_status
    AND (processing_token IS NULL OR claimed_at < now() - interval '5 minutes');
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_agent_meeting_step(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_agent_meeting_turn(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_agent_meeting_turn(uuid, text) TO authenticated;

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