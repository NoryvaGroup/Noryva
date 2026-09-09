ALTER TABLE public.nurture_reviews ADD COLUMN IF NOT EXISTS source_revision text NOT NULL DEFAULT '';

-- Auktoritativt avtryck av underlaget + hård behörighetsprövning, beräknad i
-- databasen så att TS-lagret och SQL-övergången alltid ser exakt samma sanning.
CREATE OR REPLACE FUNCTION public.nurture_source_revision(p_lead_id uuid, p_lock boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

  -- Hårda spärrar. Samma regler som TS-lagret, men här är de auktoritativa.
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
  ELSIF v_level IN ('HÖG', 'AKUT') THEN
    v_reason := 'Intent ' || v_level || ' hanteras personligen – inget automatiskt utskick.';
  ELSIF v_intent.intent_terminal IS TRUE THEN
    v_reason := 'Utfallet är avgjort – ingen uppföljning skickas.';
  ELSIF v_conv.id IS NOT NULL AND v_conv.human_owner IS NOT NULL THEN
    v_reason := 'Konversationen har en mänsklig ägare – uppföljningen hanteras manuellt.';
  END IF;

  RETURN jsonb_build_object(
    'ok', v_reason = '',
    'reason', v_reason,
    'revision', md5(concat_ws('|',
      v_lead.customer_id::text,
      md5(COALESCE(v_lead.payload::text, '')),
      COALESCE(v_customer.status, ''),
      COALESCE(v_customer.name, ''),
      COALESCE(v_profile.execution_mode, ''),
      COALESCE(v_profile.updated_at::text, ''),
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
    )),
    'intentLevel', COALESCE(v_intent.intent_level, ''),
    'nurtureStatus', COALESCE(v_nurture.status, '')
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.nurture_source_revision(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nurture_source_revision(uuid, boolean) TO authenticated, service_role;

-- Godkännande: admin + oförändrat innehåll + oförändrat och fortfarande
-- godkänt underlag, allt i samma låsta transaktion.
CREATE OR REPLACE FUNCTION public.approve_nurture_review(
  p_review_id uuid,
  p_fingerprint text,
  p_source_revision text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE r public.nurture_reviews%ROWTYPE; v_src jsonb;
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

  v_src := public.nurture_source_revision(r.lead_id, true);

  IF (v_src->>'ok')::boolean IS NOT TRUE THEN
    UPDATE public.nurture_reviews
       SET status = 'blocked', blocked_reason = COALESCE(v_src->>'reason', 'Spärrad.')
     WHERE id = r.id;
    RETURN jsonb_build_object('ok', false, 'code', 'blocked', 'reason', v_src->>'reason');
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

DROP FUNCTION IF EXISTS public.approve_nurture_review(uuid, text);

REVOKE ALL ON FUNCTION public.approve_nurture_review(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_nurture_review(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancel_nurture_review(p_review_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE r public.nurture_reviews%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'code', 'forbidden');
  END IF;

  SELECT * INTO r FROM public.nurture_reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF r.status IN ('claimed','sent','unknown') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_status', 'status', r.status);
  END IF;

  UPDATE public.nurture_reviews
     SET status = 'cancelled', failure_reason = COALESCE(NULLIF(p_reason, ''), 'Avslagen av administratör.')
   WHERE id = r.id;

  RETURN jsonb_build_object('ok', true, 'code', 'cancelled');
END;
$function$;

-- Hämtning för utskick: samma auktoritativa omprövning, låst tillsammans med
-- statusövergången. Endast service-rollen får köra.
CREATE OR REPLACE FUNCTION public.claim_nurture_review(
  p_review_id uuid,
  p_source_revision text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE r public.nurture_reviews%ROWTYPE; v_attempt uuid; v_src jsonb;
BEGIN
  SELECT * INTO r FROM public.nurture_reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF r.status <> 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_claimable', 'status', r.status);
  END IF;
  IF r.blocked_reason <> '' OR r.recipient_email = '' OR r.subject = '' OR r.body = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'blocked', 'status', r.status);
  END IF;

  v_src := public.nurture_source_revision(r.lead_id, true);

  IF (v_src->>'ok')::boolean IS NOT TRUE THEN
    UPDATE public.nurture_reviews
       SET status = 'blocked', blocked_reason = COALESCE(v_src->>'reason', 'Spärrad.')
     WHERE id = r.id;
    RETURN jsonb_build_object('ok', false, 'code', 'blocked', 'reason', v_src->>'reason');
  END IF;

  IF (v_src->>'revision') IS DISTINCT FROM NULLIF(r.source_revision, '')
     OR (p_source_revision IS NOT NULL AND (v_src->>'revision') IS DISTINCT FROM p_source_revision) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'stale_source', 'revision', v_src->>'revision');
  END IF;

  v_attempt := gen_random_uuid();
  UPDATE public.nurture_reviews
     SET status = 'claimed', attempt_id = v_attempt, claimed_at = now()
   WHERE id = r.id;

  RETURN jsonb_build_object(
    'ok', true, 'code', 'claimed', 'reviewId', r.id, 'attemptId', v_attempt,
    'leadId', r.lead_id, 'customerId', r.customer_id, 'conversationId', r.conversation_id,
    'recipientEmail', r.recipient_email, 'subject', r.subject, 'body', r.body,
    'contentFingerprint', r.content_fingerprint, 'sourceRevision', r.source_revision
  );
END;
$function$;

DROP FUNCTION IF EXISTS public.claim_nurture_review(uuid);

REVOKE ALL ON FUNCTION public.claim_nurture_review(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_nurture_review(uuid, text) TO service_role;

-- Slutförande: statusövergång, stegräkning och konversationslogg i EN transaktion.
CREATE OR REPLACE FUNCTION public.complete_nurture_review(
  p_review_id uuid,
  p_attempt_id uuid,
  p_transport_message_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
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

  -- Ett faktiskt utskick räknas ALLTID en gång. Statusen backas aldrig från
  -- ett inkommet svar eller ett avslut.
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

CREATE OR REPLACE FUNCTION public.fail_nurture_review(
  p_review_id uuid, p_attempt_id uuid, p_outcome text, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE r public.nurture_reviews%ROWTYPE; v_status text;
BEGIN
  SELECT * INTO r FROM public.nurture_reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF r.attempt_id IS DISTINCT FROM p_attempt_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'attempt_mismatch', 'status', r.status);
  END IF;
  IF r.status IN ('failed','unknown') THEN
    RETURN jsonb_build_object('ok', true, 'code', 'already_recorded', 'status', r.status);
  END IF;
  IF r.status <> 'claimed' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_status', 'status', r.status);
  END IF;

  v_status := CASE WHEN p_outcome = 'not_sent' THEN 'failed' ELSE 'unknown' END;

  UPDATE public.nurture_reviews
     SET status = v_status, failed_at = now(),
         failure_reason = COALESCE(NULLIF(btrim(p_reason), ''), 'Okänt transportfel.')
   WHERE id = r.id;

  RETURN jsonb_build_object('ok', true, 'code', v_status, 'status', v_status);
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_nurture_review(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_nurture_review(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.fail_nurture_review(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_nurture_review(uuid, uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.cancel_nurture_review(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_nurture_review(uuid, text) TO authenticated, service_role;