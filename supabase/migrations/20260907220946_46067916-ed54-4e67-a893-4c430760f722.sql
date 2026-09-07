-- 1. Kundprofil (multi-tenant konfiguration av AI-motorn)
CREATE TABLE public.customer_profiles (
  customer_id uuid PRIMARY KEY REFERENCES public.customers(id) ON DELETE CASCADE,
  tone text NOT NULL DEFAULT 'professionell',
  language text NOT NULL DEFAULT 'sv',
  lead_prefix text NOT NULL DEFAULT '',
  qualification_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  followup_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  booking_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  notify_recipients text[] NOT NULL DEFAULT '{}'::text[],
  ai_assistant_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_profiles TO authenticated;
GRANT ALL ON public.customer_profiles TO service_role;
ALTER TABLE public.customer_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage customer profiles" ON public.customer_profiles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER customer_profiles_updated_at BEFORE UPDATE ON public.customer_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Säljåtgärder (drafts + statusmaskin + idempotens)
CREATE TABLE public.sales_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.ai_sales_assistant_runs(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  human_takeover boolean NOT NULL DEFAULT false,
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  followup_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  strategy_reason text NOT NULL DEFAULT '',
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_for timestamptz,
  idempotency_key text NOT NULL,
  execution_mode text NOT NULL DEFAULT 'test',
  execution_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  executed_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_actions_type_chk CHECK (action_type IN (
    'send_email','schedule_followup','request_information','handoff_to_human','update_crm','book_meeting')),
  CONSTRAINT sales_actions_status_chk CHECK (status IN (
    'draft','review','approved','rejected','executed','failed','cancelled')),
  CONSTRAINT sales_actions_mode_chk CHECK (execution_mode IN ('test','live')),
  CONSTRAINT sales_actions_idempotency_key_uniq UNIQUE (idempotency_key)
);

CREATE INDEX sales_actions_lead_idx ON public.sales_actions (lead_id, created_at DESC);
CREATE INDEX sales_actions_customer_idx ON public.sales_actions (customer_id, created_at DESC);
CREATE INDEX sales_actions_status_idx ON public.sales_actions (status, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_actions TO authenticated;
GRANT ALL ON public.sales_actions TO service_role;
ALTER TABLE public.sales_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage sales actions" ON public.sales_actions
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER sales_actions_updated_at BEFORE UPDATE ON public.sales_actions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Audit-/händelselogg (append-only)
CREATE TABLE public.ai_sales_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  action_id uuid REFERENCES public.sales_actions(id) ON DELETE SET NULL,
  run_id uuid REFERENCES public.ai_sales_assistant_runs(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  actor text NOT NULL DEFAULT 'system',
  actor_user_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_sales_events_actor_chk CHECK (actor IN ('ai','human','system'))
);

CREATE INDEX ai_sales_events_lead_idx ON public.ai_sales_events (lead_id, created_at DESC);
CREATE INDEX ai_sales_events_action_idx ON public.ai_sales_events (action_id, created_at DESC);

GRANT SELECT, INSERT ON public.ai_sales_events TO authenticated;
GRANT ALL ON public.ai_sales_events TO service_role;
ALTER TABLE public.ai_sales_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read events" ON public.ai_sales_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins append events" ON public.ai_sales_events
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));