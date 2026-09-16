CREATE TABLE public.agent_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agenda text NOT NULL CHECK (char_length(trim(agenda)) BETWEEN 10 AND 2000),
  meeting_type text NOT NULL CHECK (meeting_type IN ('strategy','product','growth','risk','operations','general')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','manager_kickoff','round_1','cross_review','qa_review','manager_synthesis','awaiting_approval','completed','paused_budget','failed')),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  started_at timestamptz,
  completed_at timestamptz,
  selected_roles text[] NOT NULL DEFAULT '{}'::text[],
  current_round integer NOT NULL DEFAULT 0 CHECK (current_round BETWEEN 0 AND 2),
  needs_cross_review boolean,
  final_summary text NOT NULL DEFAULT '',
  recommendation text NOT NULL DEFAULT '',
  alternatives jsonb NOT NULL DEFAULT '[]'::jsonb,
  expected_effect text NOT NULL DEFAULT '',
  risk_level text NOT NULL DEFAULT 'unknown' CHECK (risk_level IN ('unknown','low','medium','high')),
  estimated_effort text NOT NULL DEFAULT '',
  estimated_cost_sek numeric NOT NULL DEFAULT 0 CHECK (estimated_cost_sek >= 0),
  approval_status text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected')),
  error text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(selected_roles) <= 4),
  CHECK (selected_roles <@ ARRAY['product_tech','growth_sales','customer_success','qa_risk','operations_finance']::text[])
);
GRANT SELECT, INSERT, UPDATE ON public.agent_meetings TO authenticated;
GRANT ALL ON public.agent_meetings TO service_role;
ALTER TABLE public.agent_meetings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage agent meetings" ON public.agent_meetings FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE UNIQUE INDEX agent_meetings_one_active_idx ON public.agent_meetings ((true)) WHERE status IN ('draft','manager_kickoff','round_1','cross_review','qa_review','manager_synthesis','paused_budget');
CREATE INDEX agent_meetings_created_at_idx ON public.agent_meetings (created_at DESC);
CREATE TRIGGER set_agent_meetings_updated_at BEFORE UPDATE ON public.agent_meetings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.agent_meeting_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id uuid NOT NULL REFERENCES public.agent_meetings(id) ON DELETE CASCADE,
  round integer NOT NULL CHECK (round BETWEEN 0 AND 2),
  sequence integer NOT NULL CHECK (sequence > 0),
  role text NOT NULL CHECK (role IN ('noryva_manager','product_tech','growth_sales','customer_success','qa_risk','operations_finance','system')),
  message_type text NOT NULL CHECK (message_type IN ('kickoff','analysis','critique','qa_review','synthesis','system')),
  content text NOT NULL CHECK (char_length(trim(content)) BETWEEN 1 AND 12000),
  reply_to_message_id uuid REFERENCES public.agent_meeting_messages(id) ON DELETE SET NULL,
  task_id uuid REFERENCES public.agent_tasks(id) ON DELETE SET NULL,
  provider_run_id text NOT NULL DEFAULT '',
  ledger_id uuid REFERENCES public.agent_run_ledger(id) ON DELETE SET NULL,
  input_tokens integer NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens integer NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  estimated_cost_sek numeric NOT NULL DEFAULT 0 CHECK (estimated_cost_sek >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (meeting_id, sequence)
);
GRANT SELECT, INSERT ON public.agent_meeting_messages TO authenticated;
GRANT ALL ON public.agent_meeting_messages TO service_role;
ALTER TABLE public.agent_meeting_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read meeting messages" ON public.agent_meeting_messages FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins create meeting messages" ON public.agent_meeting_messages FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX agent_meeting_messages_meeting_idx ON public.agent_meeting_messages (meeting_id, sequence);

CREATE OR REPLACE FUNCTION public.claim_agent_meeting_step(p_meeting_id uuid, p_expected_status text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed boolean;
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(), 'admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  UPDATE public.agent_meetings
  SET updated_at = now()
  WHERE id = p_meeting_id AND status = p_expected_status
  RETURNING true INTO claimed;
  RETURN coalesce(claimed, false);
END;
$$;
REVOKE ALL ON FUNCTION public.claim_agent_meeting_step(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_agent_meeting_step(uuid, text) TO authenticated, service_role;