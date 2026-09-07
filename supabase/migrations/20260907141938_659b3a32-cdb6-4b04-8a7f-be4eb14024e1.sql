ALTER TABLE public.leads DROP CONSTRAINT IF EXISTS leads_delivery_status_check;
ALTER TABLE public.leads ADD CONSTRAINT leads_delivery_status_check CHECK (delivery_status = ANY (ARRAY['pending'::text, 'sending'::text, 'not_configured'::text, 'delivered'::text, 'failed'::text]));
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS delivery_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS last_attempt_at timestamp with time zone;

CREATE OR REPLACE FUNCTION public.claim_lead_delivery(p_lead_id uuid, p_stale_seconds integer DEFAULT 120)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_status text;
BEGIN
  UPDATE public.leads
     SET delivery_status = 'sending',
         delivery_attempts = delivery_attempts + 1,
         last_attempt_at = now()
   WHERE id = p_lead_id
     AND (
       delivery_status IN ('pending', 'failed', 'not_configured')
       OR (delivery_status = 'sending' AND last_attempt_at < now() - make_interval(secs => p_stale_seconds))
     )
   RETURNING delivery_status INTO v_status;

  IF v_status IS NOT NULL THEN
    RETURN 'claimed';
  END IF;

  SELECT delivery_status INTO v_status FROM public.leads WHERE id = p_lead_id;
  RETURN COALESCE(v_status, 'missing');
END;
$$;

REVOKE ALL ON FUNCTION public.claim_lead_delivery(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_lead_delivery(uuid, integer) TO service_role;