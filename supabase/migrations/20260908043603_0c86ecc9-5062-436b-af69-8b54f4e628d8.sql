-- 1) Körläge per kund: live är hårdspärrat på databasnivå
ALTER TABLE public.customer_profiles
  ADD COLUMN IF NOT EXISTS execution_mode text NOT NULL DEFAULT 'test';

ALTER TABLE public.customer_profiles
  DROP CONSTRAINT IF EXISTS customer_profiles_execution_mode_chk;
ALTER TABLE public.customer_profiles
  ADD CONSTRAINT customer_profiles_execution_mode_chk
  CHECK (execution_mode IN ('test', 'review'));

-- 2) Konversationer
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  stage text NOT NULL DEFAULT 'new',
  human_owner uuid,
  last_event_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversations_stage_chk CHECK (stage IN ('new','draft_ready','approved','contacted','replied','meeting_booked','closed')),
  CONSTRAINT conversations_lead_uniq UNIQUE (lead_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage conversations" ON public.conversations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE INDEX IF NOT EXISTS conversations_customer_idx ON public.conversations(customer_id, last_event_at DESC);

-- 3) Konversationsmeddelanden (endast maskerad text)
CREATE TABLE IF NOT EXISTS public.conversation_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  direction text NOT NULL DEFAULT 'inbound',
  channel text NOT NULL DEFAULT 'mock',
  redacted_body text NOT NULL DEFAULT '',
  intent text NOT NULL DEFAULT 'ovrigt',
  confidence numeric NOT NULL DEFAULT 0,
  escalate boolean NOT NULL DEFAULT false,
  escalation_reason text NOT NULL DEFAULT '',
  suggested_action text NOT NULL DEFAULT '',
  action_id uuid REFERENCES public.sales_actions(id) ON DELETE SET NULL,
  source_ref text NOT NULL DEFAULT '',
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conversation_messages_direction_chk CHECK (direction IN ('inbound','outbound','internal')),
  CONSTRAINT conversation_messages_channel_chk CHECK (channel IN ('mock','manual','email','sms','calendar'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversation_messages TO authenticated;
GRANT ALL ON public.conversation_messages TO service_role;
ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage conversation messages" ON public.conversation_messages FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE INDEX IF NOT EXISTS conversation_messages_conv_idx ON public.conversation_messages(conversation_id, received_at DESC);

-- 4) Utfall / funnel per förfrågan
CREATE TABLE IF NOT EXISTS public.lead_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  stage text NOT NULL,
  channel text NOT NULL DEFAULT 'mock',
  score_band text NOT NULL DEFAULT 'unknown',
  note text NOT NULL DEFAULT '',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_outcomes_stage_chk CHECK (stage IN ('lead','contacted','replied','meeting','won','lost')),
  CONSTRAINT lead_outcomes_score_band_chk CHECK (score_band IN ('hog','medel','lag','unknown')),
  CONSTRAINT lead_outcomes_uniq UNIQUE (lead_id, stage)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_outcomes TO authenticated;
GRANT ALL ON public.lead_outcomes TO service_role;
ALTER TABLE public.lead_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage lead outcomes" ON public.lead_outcomes FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE INDEX IF NOT EXISTS lead_outcomes_customer_idx ON public.lead_outcomes(customer_id, stage);

-- 5) Replay-skydd för framtida inkommande callbacks
CREATE TABLE IF NOT EXISTS public.inbound_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  external_id text NOT NULL,
  signature_verified boolean NOT NULL DEFAULT false,
  payload_hash text NOT NULL DEFAULT '',
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inbound_webhook_events_uniq UNIQUE (source, external_id)
);
GRANT SELECT, INSERT ON public.inbound_webhook_events TO authenticated;
GRANT ALL ON public.inbound_webhook_events TO service_role;
ALTER TABLE public.inbound_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read inbound events" ON public.inbound_webhook_events FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins append inbound events" ON public.inbound_webhook_events FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));