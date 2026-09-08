-- Noryva 2.0 Growth Engine (additive only)

CREATE TABLE IF NOT EXISTS public.growth_experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  industry text NOT NULL DEFAULT '',
  name text NOT NULL,
  experiment_type text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','paused','completed')),
  min_sample_size integer NOT NULL DEFAULT 30,
  exploration_floor numeric NOT NULL DEFAULT 0.1,
  notes text NOT NULL DEFAULT '',
  started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.growth_experiments TO authenticated;
GRANT ALL ON public.growth_experiments TO service_role;
ALTER TABLE public.growth_experiments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage growth experiments" ON public.growth_experiments
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.growth_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES public.growth_experiments(id) ON DELETE CASCADE,
  name text NOT NULL,
  weight numeric NOT NULL DEFAULT 1 CHECK (weight >= 0),
  is_control boolean NOT NULL DEFAULT false,
  instruction text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (experiment_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.growth_variants TO authenticated;
GRANT ALL ON public.growth_variants TO service_role;
ALTER TABLE public.growth_variants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage growth variants" ON public.growth_variants
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.growth_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES public.growth_experiments(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES public.growth_variants(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (experiment_id, lead_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.growth_assignments TO authenticated;
GRANT ALL ON public.growth_assignments TO service_role;
ALTER TABLE public.growth_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage growth assignments" ON public.growth_assignments
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.growth_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  experiment_id uuid REFERENCES public.growth_experiments(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES public.growth_variants(id) ON DELETE SET NULL,
  outcome_type text NOT NULL CHECK (outcome_type IN ('lead_created','contacted','replied','meeting_booked','won','lost','revenue')),
  outcome_value numeric,
  revenue_value numeric,
  idempotency_key text NOT NULL UNIQUE,
  source text NOT NULL DEFAULT 'admin',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.growth_outcomes TO authenticated;
GRANT ALL ON public.growth_outcomes TO service_role;
ALTER TABLE public.growth_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage growth outcomes" ON public.growth_outcomes
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.growth_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  experiment_id uuid NOT NULL REFERENCES public.growth_experiments(id) ON DELETE CASCADE,
  winner_variant_id uuid REFERENCES public.growth_variants(id) ON DELETE SET NULL,
  metric text NOT NULL DEFAULT '',
  confidence numeric NOT NULL DEFAULT 0,
  reason text NOT NULL DEFAULT '',
  allocations jsonb NOT NULL DEFAULT '{}'::jsonb,
  needs_more_data boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.growth_recommendations TO authenticated;
GRANT ALL ON public.growth_recommendations TO service_role;
ALTER TABLE public.growth_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage growth recommendations" ON public.growth_recommendations
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.ai_cost_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  variant_id uuid REFERENCES public.growth_variants(id) ON DELETE SET NULL,
  tier text NOT NULL CHECK (tier IN ('deterministic','ai_light','ai_full','optimizer')),
  route text NOT NULL DEFAULT '',
  model text,
  input_tokens integer,
  output_tokens integer,
  estimated_cost numeric NOT NULL DEFAULT 0,
  assumed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.ai_cost_events TO authenticated;
GRANT ALL ON public.ai_cost_events TO service_role;
ALTER TABLE public.ai_cost_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read ai cost events" ON public.ai_cost_events
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins insert ai cost events" ON public.ai_cost_events
  FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS ai_cost_events_customer_created_idx ON public.ai_cost_events (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS growth_outcomes_customer_created_idx ON public.growth_outcomes (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS growth_assignments_lead_idx ON public.growth_assignments (lead_id);

ALTER TABLE public.customer_profiles
  ADD COLUMN IF NOT EXISTS ai_daily_budget_usd numeric NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS ai_monthly_budget_usd numeric NOT NULL DEFAULT 40;

CREATE TRIGGER update_growth_experiments_updated_at BEFORE UPDATE ON public.growth_experiments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER update_growth_variants_updated_at BEFORE UPDATE ON public.growth_variants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();