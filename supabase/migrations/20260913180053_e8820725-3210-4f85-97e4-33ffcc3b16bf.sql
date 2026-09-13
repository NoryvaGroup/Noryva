ALTER TABLE public.agent_meetings ADD COLUMN processing_token uuid, ADD COLUMN claimed_at timestamptz;

CREATE FUNCTION public.claim_agent_meeting_turn(p_meeting_id uuid, p_expected_status text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_token uuid := gen_random_uuid();
BEGIN
  UPDATE public.agent_meetings
  SET processing_token = v_token, claimed_at = now(), updated_at = now()
  WHERE id = p_meeting_id
    AND status = p_expected_status
    AND (processing_token IS NULL OR claimed_at < now() - interval '5 minutes');
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN v_token;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_agent_meeting_turn(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_agent_meeting_turn(uuid, text) TO authenticated, service_role;