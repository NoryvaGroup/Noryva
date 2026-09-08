CREATE TABLE IF NOT EXISTS public.growth_lead_state (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  intent_score integer NOT NULL DEFAULT 0,
  intent_level text NOT NULL DEFAULT 'LÅG',
  intent_reason text NOT NULL DEFAULT '',
  intent_terminal boolean NOT NULL DEFAULT false,
  intent_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.growth_lead_state TO authenticated;
GRANT ALL ON public.growth_lead_state TO service_role;

ALTER TABLE public.growth_lead_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage growth lead state"
ON public.growth_lead_state FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS growth_lead_state_customer_idx ON public.growth_lead_state (customer_id, intent_updated_at DESC);

CREATE TRIGGER growth_lead_state_updated_at
BEFORE UPDATE ON public.growth_lead_state
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();