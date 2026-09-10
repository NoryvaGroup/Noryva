CREATE OR REPLACE FUNCTION public.reconcile_nurture_review(
  p_review_id uuid,
  p_outcome text,
  p_transport_message_id text DEFAULT NULL,
  p_reason text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  r public.nurture_reviews%ROWTYPE;
  n public.growth_nurture_state%ROWTYPE;
  v_outcome text;
  v_msg text;
  v_source_ref text;
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;

  v_outcome := upper(btrim(COALESCE(p_outcome, '')));
  IF v_outcome NOT IN ('SENT', 'NOT_SENT', 'UNKNOWN') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_outcome');
  END IF;

  SELECT * INTO r FROM public.nurture_reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;

  -- Idempotens: en redan bokförd avstämning upprepas utan sidoeffekt.
  IF r.status = 'sent' THEN
    IF v_outcome <> 'SENT' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_status', 'status', r.status);
    END IF;
    IF COALESCE(r.transport_message_id, '') IS DISTINCT FROM btrim(COALESCE(p_transport_message_id, '')) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'transport_mismatch');
    END IF;
    RETURN jsonb_build_object('ok', true, 'code', 'already_sent', 'duplicate', true,
                              'status', 'sent', 'releasedForRetry', false,
                              'transportMessageId', r.transport_message_id);
  END IF;

  IF r.status NOT IN ('claimed', 'unknown') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_status', 'status', r.status);
  END IF;

  IF v_outcome = 'UNKNOWN' THEN
    UPDATE public.nurture_reviews
       SET status = 'unknown', failed_at = COALESCE(failed_at, now()),
           failure_reason = COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'Osäker leverans – manuell avstämning.')
     WHERE id = r.id;
    RETURN jsonb_build_object('ok', true, 'code', 'unknown', 'status', 'unknown',
                              'duplicate', false, 'releasedForRetry', false);
  END IF;

  IF v_outcome = 'NOT_SENT' THEN
    UPDATE public.nurture_reviews
       SET status = 'failed', failed_at = now(),
           failure_reason = COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'Bekräftat ej skickat – manuell avstämning.')
     WHERE id = r.id;
    RETURN jsonb_build_object('ok', true, 'code', 'not_sent', 'status', 'failed',
                              'duplicate', false, 'releasedForRetry', false);
  END IF;

  v_msg := btrim(COALESCE(p_transport_message_id, ''));
  IF v_msg = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'missing_message_id');
  END IF;

  UPDATE public.nurture_reviews
     SET status = 'sent', sent_at = COALESCE(sent_at, now()),
         transport_message_id = v_msg, failure_reason = ''
   WHERE id = r.id;

  SELECT * INTO n FROM public.growth_nurture_state WHERE lead_id = r.lead_id FOR UPDATE;
  IF FOUND THEN
    UPDATE public.growth_nurture_state
       SET steps_taken = COALESCE(steps_taken, 0) + 1,
           status = CASE WHEN n.status IN ('replied','cancelled') THEN n.status ELSE 'sent' END
     WHERE lead_id = r.lead_id;
  END IF;

  IF r.conversation_id IS NOT NULL THEN
    v_source_ref := 'nurture-transport:' || v_msg;
    INSERT INTO public.conversation_messages (
      conversation_id, lead_id, customer_id, direction, channel, redacted_body,
      intent, confidence, escalate, escalation_reason, suggested_action, source_ref
    )
    SELECT r.conversation_id, r.lead_id, r.customer_id, 'outbound', 'email',
           r.subject || E'\n\n' || r.body,
           'nurture_followup', 1, false, '', 'send_followup', v_source_ref
    WHERE NOT EXISTS (
      SELECT 1 FROM public.conversation_messages m
       WHERE m.conversation_id = r.conversation_id AND m.source_ref = v_source_ref
    );

    UPDATE public.conversations
       SET stage = CASE WHEN stage IN ('replied','meeting_booked','closed') THEN stage ELSE 'contacted' END,
           last_event_at = now()
     WHERE id = r.conversation_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'code', 'sent', 'status', 'sent',
                            'duplicate', false, 'releasedForRetry', false,
                            'transportMessageId', v_msg);
END;
$function$;