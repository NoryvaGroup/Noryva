CREATE TABLE public.lead_reminder_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'contact_24h',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','claimed','sent','failed','unknown')),
  attempt_id uuid,
  claimed_at timestamptz,
  transport_message_id text,
  sent_at timestamptz,
  failed_at timestamptz,
  failure_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, kind)
);

GRANT SELECT ON public.lead_reminder_deliveries TO authenticated;
GRANT ALL ON public.lead_reminder_deliveries TO service_role;

ALTER TABLE public.lead_reminder_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view lead reminder deliveries"
  ON public.lead_reminder_deliveries FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER lead_reminder_deliveries_updated_at
  BEFORE UPDATE ON public.lead_reminder_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX lead_reminder_deliveries_status_idx
  ON public.lead_reminder_deliveries (status, kind);

-- Atomisk hämtning av EN påminnelse. Verifierar i samma transaktion att
-- förfrågan fortfarande är obehandlad ("Ny") och att påminnelsen är förfallen.
CREATE OR REPLACE FUNCTION public.claim_lead_reminder(
  p_lead_id uuid,
  p_kind text DEFAULT 'contact_24h',
  p_older_than_hours integer DEFAULT 24,
  p_stale_claim_minutes integer DEFAULT 15
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_lead public.leads%ROWTYPE;
  r public.lead_reminder_deliveries%ROWTYPE;
  v_attempt uuid;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF COALESCE(v_lead.customer_status, '') <> 'Ny' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'lead_not_pending',
                              'customerStatus', v_lead.customer_status);
  END IF;
  IF v_lead.created_at > now() - make_interval(hours => p_older_than_hours) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_due');
  END IF;

  INSERT INTO public.lead_reminder_deliveries (lead_id, customer_id, kind)
  VALUES (p_lead_id, v_lead.customer_id, p_kind)
  ON CONFLICT (lead_id, kind) DO NOTHING;

  SELECT * INTO r FROM public.lead_reminder_deliveries
   WHERE lead_id = p_lead_id AND kind = p_kind FOR UPDATE;

  IF r.status = 'sent' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'already_sent');
  END IF;
  IF r.status = 'unknown' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'delivery_unknown');
  END IF;
  IF r.status = 'claimed' THEN
    IF r.claimed_at > now() - make_interval(mins => p_stale_claim_minutes) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'in_progress');
    END IF;
    -- Gammal claim släpps ALDRIG automatiskt: kräver manuell avstämning.
    RETURN jsonb_build_object('ok', false, 'code', 'stale_claim');
  END IF;

  v_attempt := gen_random_uuid();
  UPDATE public.lead_reminder_deliveries
     SET status = 'claimed', attempt_id = v_attempt, claimed_at = now(),
         customer_id = COALESCE(customer_id, v_lead.customer_id)
   WHERE id = r.id;

  RETURN jsonb_build_object('ok', true, 'code', 'claimed',
                            'reminderId', r.id, 'attemptId', v_attempt,
                            'leadId', p_lead_id, 'customerId', v_lead.customer_id,
                            'kind', p_kind);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_lead_reminder(
  p_reminder_id uuid,
  p_attempt_id uuid,
  p_transport_message_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r public.lead_reminder_deliveries%ROWTYPE; v_msg text;
BEGIN
  IF p_transport_message_id IS NULL OR btrim(p_transport_message_id) = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'missing_message_id');
  END IF;
  v_msg := btrim(p_transport_message_id);

  SELECT * INTO r FROM public.lead_reminder_deliveries WHERE id = p_reminder_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF r.attempt_id IS DISTINCT FROM p_attempt_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'attempt_mismatch', 'status', r.status);
  END IF;
  IF r.status = 'sent' THEN
    IF COALESCE(r.transport_message_id, '') IS DISTINCT FROM v_msg THEN
      RETURN jsonb_build_object('ok', false, 'code', 'transport_mismatch');
    END IF;
    RETURN jsonb_build_object('ok', true, 'code', 'already_sent', 'duplicate', true,
                              'transportMessageId', r.transport_message_id);
  END IF;
  IF r.status <> 'claimed' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_status', 'status', r.status);
  END IF;

  UPDATE public.lead_reminder_deliveries
     SET status = 'sent', sent_at = now(), transport_message_id = v_msg, failure_reason = ''
   WHERE id = r.id;

  RETURN jsonb_build_object('ok', true, 'code', 'sent', 'duplicate', false,
                            'transportMessageId', v_msg);
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_lead_reminder(
  p_reminder_id uuid,
  p_attempt_id uuid,
  p_outcome text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r public.lead_reminder_deliveries%ROWTYPE; v_status text;
BEGIN
  SELECT * INTO r FROM public.lead_reminder_deliveries WHERE id = p_reminder_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF r.attempt_id IS DISTINCT FROM p_attempt_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'attempt_mismatch', 'status', r.status);
  END IF;
  IF r.status IN ('failed', 'unknown') THEN
    RETURN jsonb_build_object('ok', true, 'code', 'already_recorded', 'status', r.status);
  END IF;
  IF r.status <> 'claimed' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_status', 'status', r.status);
  END IF;

  v_status := CASE WHEN p_outcome = 'not_sent' THEN 'failed' ELSE 'unknown' END;

  UPDATE public.lead_reminder_deliveries
     SET status = v_status, failed_at = now(),
         failure_reason = COALESCE(NULLIF(btrim(p_reason), ''), 'Okänt transportfel.')
   WHERE id = r.id;

  RETURN jsonb_build_object('ok', true, 'code', v_status, 'status', v_status);
END;
$$;