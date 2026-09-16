CREATE TABLE public.growth_nurture_state (
  lead_id uuid PRIMARY KEY REFERENCES public.leads(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  reason text NOT NULL DEFAULT '',
  intent_level text NOT NULL DEFAULT '',
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  next_step_at timestamptz,
  steps_taken integer NOT NULL DEFAULT 0,
  last_reply_intent text NOT NULL DEFAULT '',
  human_takeover boolean NOT NULL DEFAULT false,
  upgrade_signal boolean NOT NULL DEFAULT false,
  stopped_reason text NOT NULL DEFAULT '',
  execution_mode text NOT NULL DEFAULT 'review',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT growth_nurture_status_chk CHECK (status IN ('pending','review','approved','sent','replied','cancelled')),
  CONSTRAINT growth_nurture_mode_chk CHECK (execution_mode IN ('test','review'))
);

GRANT SELECT ON public.growth_nurture_state TO authenticated;
GRANT ALL ON public.growth_nurture_state TO service_role;

ALTER TABLE public.growth_nurture_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read nurture state"
ON public.growth_nurture_state
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER growth_nurture_state_updated_at
BEFORE UPDATE ON public.growth_nurture_state
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX growth_nurture_state_due_idx
ON public.growth_nurture_state (next_step_at)
WHERE status IN ('pending','review','approved');