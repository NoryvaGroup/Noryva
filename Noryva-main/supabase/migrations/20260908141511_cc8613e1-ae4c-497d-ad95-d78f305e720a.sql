CREATE TABLE IF NOT EXISTS public.growth_analysis_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  analysis_version text NOT NULL,
  status text NOT NULL DEFAULT 'in_progress',
  attempts integer NOT NULL DEFAULT 1,
  run_id uuid,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id, analysis_version)
);

GRANT SELECT ON public.growth_analysis_claims TO authenticated;
GRANT ALL ON public.growth_analysis_claims TO service_role;

ALTER TABLE public.growth_analysis_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read analysis claims"
  ON public.growth_analysis_claims FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER growth_analysis_claims_updated_at
  BEFORE UPDATE ON public.growth_analysis_claims
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.claim_growth_analysis(p_lead_id uuid, p_analysis_version text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_status text;
BEGIN
  INSERT INTO public.growth_analysis_claims (lead_id, analysis_version, status)
  VALUES (p_lead_id, p_analysis_version, 'in_progress')
  ON CONFLICT (lead_id, analysis_version) DO NOTHING;

  IF FOUND THEN
    RETURN 'claimed';
  END IF;

  SELECT status INTO v_status
    FROM public.growth_analysis_claims
   WHERE lead_id = p_lead_id AND analysis_version = p_analysis_version;

  RETURN COALESCE(v_status, 'in_progress');
END;
$$;

REVOKE ALL ON FUNCTION public.claim_growth_analysis(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_growth_analysis(uuid, text) TO service_role;