CREATE TABLE IF NOT EXISTS public.ai_sales_assistant_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  action text NOT NULL,
  contact_speed text NOT NULL,
  subject text NOT NULL DEFAULT '',
  email_draft text NOT NULL DEFAULT '',
  followup_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  human_takeover boolean NOT NULL DEFAULT false,
  strategy_reason text NOT NULL DEFAULT '',
  confidence numeric(3,2) NOT NULL DEFAULT 0,
  safety_flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  review_status text NOT NULL DEFAULT 'draft',
  reviewer_notes text NOT NULL DEFAULT '',
  prompt_version text NOT NULL,
  model text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_runs_action_chk CHECK (action IN ('Kontakta nu','Följ upp','Be om komplettering','Mänsklig handläggning')),
  CONSTRAINT ai_runs_speed_chk CHECK (contact_speed IN ('Omgående','Inom 24 timmar','Inom 2 arbetsdagar','Avvakta')),
  CONSTRAINT ai_runs_status_chk CHECK (review_status IN ('draft','approved','rejected','sent')),
  CONSTRAINT ai_runs_confidence_chk CHECK (confidence >= 0 AND confidence <= 1)
);

CREATE INDEX IF NOT EXISTS ai_runs_lead_id_idx ON public.ai_sales_assistant_runs (lead_id);
CREATE INDEX IF NOT EXISTS ai_runs_customer_id_idx ON public.ai_sales_assistant_runs (customer_id);
CREATE INDEX IF NOT EXISTS ai_runs_review_status_idx ON public.ai_sales_assistant_runs (review_status);
CREATE INDEX IF NOT EXISTS ai_runs_created_at_idx ON public.ai_sales_assistant_runs (created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ai_sales_assistant_runs TO authenticated;
GRANT ALL ON public.ai_sales_assistant_runs TO service_role;

ALTER TABLE public.ai_sales_assistant_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage ai runs"
  ON public.ai_sales_assistant_runs
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER ai_sales_assistant_runs_updated_at
  BEFORE UPDATE ON public.ai_sales_assistant_runs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();