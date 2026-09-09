CREATE TABLE public.nurture_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  occurrence_key text NOT NULL,
  step_index integer NOT NULL DEFAULT 0,
  due_at timestamp with time zone NOT NULL,
  intent_level text NOT NULL DEFAULT '',
  company_name text NOT NULL DEFAULT '',
  recipient_email text NOT NULL DEFAULT '',
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_fingerprint text NOT NULL,
  source_fingerprint text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending_review',
  blocked_reason text NOT NULL DEFAULT '',
  execution_mode text NOT NULL DEFAULT 'review',
  approved_by uuid,
  approved_at timestamp with time zone,
  attempt_id uuid,
  claimed_at timestamp with time zone,
  transport_message_id text,
  sent_at timestamp with time zone,
  failed_at timestamp with time zone,
  failure_reason text NOT NULL DEFAULT '',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT nurture_reviews_status_check CHECK (status IN ('pending_review','blocked','approved','claimed','sent','failed','unknown','cancelled')),
  CONSTRAINT nurture_reviews_mode_check CHECK (execution_mode IN ('test','review')),
  CONSTRAINT nurture_reviews_occurrence_unique UNIQUE (lead_id, occurrence_key)
);

CREATE UNIQUE INDEX nurture_reviews_transport_message_id_key
  ON public.nurture_reviews (transport_message_id)
  WHERE transport_message_id IS NOT NULL;
CREATE INDEX nurture_reviews_status_idx ON public.nurture_reviews (status, due_at);
CREATE INDEX nurture_reviews_customer_idx ON public.nurture_reviews (customer_id);

GRANT SELECT ON public.nurture_reviews TO authenticated;
GRANT ALL ON public.nurture_reviews TO service_role;

ALTER TABLE public.nurture_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read nurture reviews"
  ON public.nurture_reviews FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER nurture_reviews_updated_at
  BEFORE UPDATE ON public.nurture_reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Godkännande: admin, radlås, exakt innehållsavtryck, en gång.
CREATE OR REPLACE FUNCTION public.approve_nurture_review(p_review_id uuid, p_fingerprint text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r public.nurture_reviews%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
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

  UPDATE public.nurture_reviews
     SET status = 'approved', approved_by = auth.uid(), approved_at = now()
   WHERE id = r.id;

  RETURN jsonb_build_object('ok', true, 'code', 'approved', 'reviewId', r.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_nurture_review(p_review_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r public.nurture_reviews%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
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
$$;

-- Hämtning för utskick: endast service_role. Returnerar sändbart innehåll exakt en gång.
CREATE OR REPLACE FUNCTION public.claim_nurture_review(p_review_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r public.nurture_reviews%ROWTYPE; v_attempt uuid;
BEGIN
  SELECT * INTO r FROM public.nurture_reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF r.status <> 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_claimable', 'status', r.status);
  END IF;
  IF r.blocked_reason <> '' OR r.recipient_email = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'blocked', 'status', r.status);
  END IF;

  v_attempt := gen_random_uuid();
  UPDATE public.nurture_reviews
     SET status = 'claimed', attempt_id = v_attempt, claimed_at = now()
   WHERE id = r.id;

  RETURN jsonb_build_object(
    'ok', true, 'code', 'claimed', 'reviewId', r.id, 'attemptId', v_attempt,
    'leadId', r.lead_id, 'customerId', r.customer_id, 'conversationId', r.conversation_id,
    'recipientEmail', r.recipient_email, 'subject', r.subject, 'body', r.body,
    'contentFingerprint', r.content_fingerprint
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_nurture_review(
  p_review_id uuid, p_attempt_id uuid, p_transport_message_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r public.nurture_reviews%ROWTYPE; n public.growth_nurture_state%ROWTYPE;
BEGIN
  IF p_transport_message_id IS NULL OR btrim(p_transport_message_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'missing_message_id');
  END IF;

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
         transport_message_id = btrim(p_transport_message_id), failure_reason = ''
   WHERE id = r.id;

  SELECT * INTO n FROM public.growth_nurture_state WHERE lead_id = r.lead_id FOR UPDATE;
  IF FOUND AND n.status NOT IN ('replied','cancelled') THEN
    UPDATE public.growth_nurture_state
       SET status = 'sent', steps_taken = COALESCE(steps_taken, 0) + 1
     WHERE lead_id = r.lead_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'code', 'sent', 'duplicate', false,
                            'leadId', r.lead_id, 'customerId', r.customer_id,
                            'conversationId', r.conversation_id,
                            'transportMessageId', btrim(p_transport_message_id));
END;
$$;

-- Misslyckande: släpper ALDRIG tillbaka ett hämtat utskick automatiskt.
CREATE OR REPLACE FUNCTION public.fail_nurture_review(
  p_review_id uuid, p_attempt_id uuid, p_outcome text, p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

REVOKE ALL ON FUNCTION public.approve_nurture_review(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_nurture_review(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_nurture_review(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_nurture_review(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_nurture_review(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.approve_nurture_review(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_nurture_review(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_nurture_review(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_nurture_review(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_nurture_review(uuid, uuid, text, text) TO service_role;