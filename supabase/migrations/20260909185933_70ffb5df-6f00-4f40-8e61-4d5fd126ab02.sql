-- 1. Extra fält på granskningsposten (additivt)
ALTER TABLE public.nurture_reviews
  ADD COLUMN IF NOT EXISTS reason text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS human_takeover boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS intent_score integer NOT NULL DEFAULT 0;

-- 2. Reservationsregister för inkommande svar
CREATE TABLE IF NOT EXISTS public.nurture_inbound_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.nurture_reviews(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  source_ref text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','done','failed')),
  attempts integer NOT NULL DEFAULT 1,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.nurture_inbound_events TO authenticated;
GRANT ALL ON public.nurture_inbound_events TO service_role;

ALTER TABLE public.nurture_inbound_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins kan läsa inkommande svar" ON public.nurture_inbound_events;
CREATE POLICY "Admins kan läsa inkommande svar"
  ON public.nurture_inbound_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') IS TRUE);

DROP TRIGGER IF EXISTS nurture_inbound_events_updated_at ON public.nurture_inbound_events;
CREATE TRIGGER nurture_inbound_events_updated_at
  BEFORE UPDATE ON public.nurture_inbound_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Atomär reservation: exakt en behandling per inkommande meddelande
CREATE OR REPLACE FUNCTION public.reserve_nurture_inbound(
  p_review_id uuid, p_lead_id uuid, p_source_ref text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE e public.nurture_inbound_events%ROWTYPE;
BEGIN
  IF p_source_ref IS NULL OR btrim(p_source_ref) = '' THEN
    RETURN jsonb_build_object('state', 'invalid');
  END IF;

  INSERT INTO public.nurture_inbound_events (review_id, lead_id, source_ref)
  VALUES (p_review_id, p_lead_id, btrim(p_source_ref))
  ON CONFLICT (source_ref) DO NOTHING
  RETURNING * INTO e;

  IF FOUND THEN
    RETURN jsonb_build_object('state', 'reserved', 'attempts', 1);
  END IF;

  SELECT * INTO e FROM public.nurture_inbound_events
   WHERE source_ref = btrim(p_source_ref) FOR UPDATE;

  IF e.status = 'done' THEN
    RETURN jsonb_build_object('state', 'done', 'result', e.result);
  END IF;

  IF e.status = 'reserved' AND e.updated_at > now() - interval '2 minutes' THEN
    RETURN jsonb_build_object('state', 'in_progress', 'attempts', e.attempts);
  END IF;

  UPDATE public.nurture_inbound_events
     SET status = 'reserved', attempts = e.attempts + 1
   WHERE id = e.id;
  RETURN jsonb_build_object('state', 'reserved', 'attempts', e.attempts + 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_nurture_inbound(
  p_source_ref text, p_ok boolean, p_result jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  UPDATE public.nurture_inbound_events
     SET status = CASE WHEN p_ok THEN 'done' ELSE 'failed' END,
         result = COALESCE(p_result, '{}'::jsonb)
   WHERE source_ref = btrim(p_source_ref);
  RETURN jsonb_build_object('ok', FOUND);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_nurture_inbound(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_nurture_inbound(text, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_nurture_inbound(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_nurture_inbound(text, boolean, jsonb) TO service_role;

-- 4. Källprövning: okänd eller saknad intent-nivå spärrar
CREATE OR REPLACE FUNCTION public.nurture_source_revision(p_lead_id uuid, p_lock boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_lead public.leads%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_profile public.customer_profiles%ROWTYPE;
  v_nurture public.growth_nurture_state%ROWTYPE;
  v_intent public.growth_lead_state%ROWTYPE;
  v_conv public.conversations%ROWTYPE;
  v_outcomes text;
  v_reason text := '';
  v_level text;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'Förfrågan finns inte.', 'revision', '');
  END IF;

  SELECT * INTO v_customer FROM public.customers WHERE id = v_lead.customer_id;
  SELECT * INTO v_profile FROM public.customer_profiles WHERE customer_id = v_lead.customer_id;

  IF p_lock THEN
    SELECT * INTO v_nurture FROM public.growth_nurture_state WHERE lead_id = p_lead_id FOR UPDATE;
    SELECT * INTO v_conv FROM public.conversations WHERE lead_id = p_lead_id FOR UPDATE;
  ELSE
    SELECT * INTO v_nurture FROM public.growth_nurture_state WHERE lead_id = p_lead_id;
    SELECT * INTO v_conv FROM public.conversations WHERE lead_id = p_lead_id;
  END IF;

  SELECT * INTO v_intent FROM public.growth_lead_state WHERE lead_id = p_lead_id;

  SELECT COALESCE(string_agg(o.outcome_type || ':' || o.id::text, ',' ORDER BY o.created_at, o.id), '')
    INTO v_outcomes
    FROM public.growth_outcomes o WHERE o.lead_id = p_lead_id;

  v_level := upper(COALESCE(NULLIF(v_intent.intent_level, ''), ''));

  IF v_customer.id IS NULL OR v_customer.status <> 'published' THEN
    v_reason := 'Kunden är inte aktiv.';
  ELSIF v_nurture.lead_id IS NULL THEN
    v_reason := 'Ingen uppföljningsplan finns för förfrågan.';
  ELSIF v_nurture.status IN ('cancelled') THEN
    v_reason := 'Uppföljningen är avslutad.';
  ELSIF v_nurture.status IN ('replied') THEN
    v_reason := 'Leadet har svarat – hanteras i konversationen.';
  ELSIF v_nurture.human_takeover IS TRUE THEN
    v_reason := 'Kräver mänsklig handläggning.';
  ELSIF COALESCE(v_nurture.last_reply_intent, '') = 'avbojer' THEN
    v_reason := 'Leadet har tackat nej – ingen vidare uppföljning.';
  ELSIF v_nurture.execution_mode NOT IN ('test', 'review') THEN
    v_reason := 'Ogiltigt körläge – endast test och granskning tillåts.';
  ELSIF v_level = '' THEN
    v_reason := 'Intent saknas för förfrågan – kör om analysen innan uppföljning.';
  ELSIF v_level NOT IN ('LÅG', 'NORMAL') THEN
    v_reason := 'Intent ' || v_level || ' hanteras personligen – inget automatiskt utskick.';
  ELSIF v_intent.intent_terminal IS TRUE THEN
    v_reason := 'Utfallet är avgjort – ingen uppföljning skickas.';
  ELSIF v_conv.id IS NOT NULL AND v_conv.human_owner IS NOT NULL THEN
    v_reason := 'Konversationen har en mänsklig ägare – uppföljningen hanteras manuellt.';
  END IF;

  RETURN jsonb_build_object(
    'ok', v_reason = '',
    'reason', v_reason,
    'revision', encode(digest(concat_ws('|',
      v_lead.customer_id::text,
      encode(digest(COALESCE(v_lead.payload::text, ''), 'sha256'), 'hex'),
      COALESCE(v_customer.status, ''),
      COALESCE(v_customer.name, ''),
      COALESCE(v_profile.execution_mode, ''),
      COALESCE(v_profile.updated_at::text, ''),
      COALESCE(v_profile.qualification_profile::text, ''),
      COALESCE(v_profile.followup_rules::text, ''),
      COALESCE(v_nurture.status, ''),
      COALESCE(v_nurture.steps_taken::text, ''),
      COALESCE(v_nurture.human_takeover::text, ''),
      COALESCE(v_nurture.last_reply_intent, ''),
      COALESCE(v_nurture.next_step_at::text, ''),
      COALESCE(v_nurture.questions::text, ''),
      COALESCE(v_nurture.execution_mode, ''),
      COALESCE(v_intent.intent_level, ''),
      COALESCE(v_intent.intent_score::text, ''),
      COALESCE(v_intent.intent_terminal::text, ''),
      COALESCE(v_conv.human_owner::text, ''),
      COALESCE(v_conv.stage, ''),
      v_outcomes
    ), 'sha256'), 'hex'),
    'intentLevel', COALESCE(v_intent.intent_level, ''),
    'intentScore', COALESCE(v_intent.intent_score, 0),
    'nurtureStatus', COALESCE(v_nurture.status, '')
  );
END;
$function$;

-- 5. Godkännande: förfallet tillfälle krävs, intent måste vara LÅG/NORMAL
CREATE OR REPLACE FUNCTION public.approve_nurture_review(p_review_id uuid, p_fingerprint text, p_source_revision text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r public.nurture_reviews%ROWTYPE; v_src jsonb; v_level text;
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;

  SELECT * INTO r FROM public.nurture_reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF r.content_fingerprint IS DISTINCT FROM p_fingerprint THEN
    RETURN jsonb_build_object('ok', false, 'code', 'stale', 'status', r.status);
  END IF;
  IF r.status <> 'pending_review' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_status', 'status', r.status);
  END IF;
  IF r.blocked_reason <> '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'blocked', 'reason', r.blocked_reason);
  END IF;
  IF r.recipient_email = '' OR r.subject = '' OR r.body = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'incomplete');
  END IF;
  IF r.due_at > now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_due');
  END IF;

  v_src := public.nurture_source_revision(r.lead_id, true);

  IF (v_src->>'ok')::boolean IS NOT TRUE THEN
    UPDATE public.nurture_reviews
       SET status = 'blocked', blocked_reason = COALESCE(v_src->>'reason', 'Spärrad.')
     WHERE id = r.id;
    RETURN jsonb_build_object('ok', false, 'code', 'blocked', 'reason', v_src->>'reason');
  END IF;

  v_level := upper(COALESCE(v_src->>'intentLevel', ''));
  IF v_level NOT IN ('LÅG', 'NORMAL') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'intent_not_allowed', 'reason', v_level);
  END IF;

  IF (v_src->>'revision') IS DISTINCT FROM p_source_revision
     OR (v_src->>'revision') IS DISTINCT FROM NULLIF(r.source_revision, '') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'stale_source',
                              'revision', v_src->>'revision');
  END IF;

  UPDATE public.nurture_reviews
     SET status = 'approved', approved_by = auth.uid(), approved_at = now()
   WHERE id = r.id;

  RETURN jsonb_build_object('ok', true, 'code', 'approved', 'reviewId', r.id);
END;
$function$;

-- 6. Slutförande: avvikande meddelande-id på redan skickad post avvisas
CREATE OR REPLACE FUNCTION public.complete_nurture_review(p_review_id uuid, p_attempt_id uuid, p_transport_message_id text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  r public.nurture_reviews%ROWTYPE;
  n public.growth_nurture_state%ROWTYPE;
  v_msg text;
  v_source_ref text;
BEGIN
  IF p_transport_message_id IS NULL OR btrim(p_transport_message_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'missing_message_id');
  END IF;
  v_msg := btrim(p_transport_message_id);

  SELECT * INTO r FROM public.nurture_reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF r.attempt_id IS DISTINCT FROM p_attempt_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'attempt_mismatch', 'status', r.status);
  END IF;
  IF r.status = 'sent' THEN
    IF COALESCE(r.transport_message_id, '') IS DISTINCT FROM v_msg THEN
      RETURN jsonb_build_object('ok', false, 'code', 'transport_mismatch',
                                'transportMessageId', r.transport_message_id);
    END IF;
    RETURN jsonb_build_object('ok', true, 'code', 'already_sent', 'duplicate', true,
                              'transportMessageId', r.transport_message_id);
  END IF;
  IF r.status <> 'claimed' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_status', 'status', r.status);
  END IF;

  UPDATE public.nurture_reviews
     SET status = 'sent', sent_at = now(),
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

  RETURN jsonb_build_object('ok', true, 'code', 'sent', 'duplicate', false,
                            'leadId', r.lead_id, 'customerId', r.customer_id,
                            'conversationId', r.conversation_id,
                            'transportMessageId', v_msg);
END;
$function$;