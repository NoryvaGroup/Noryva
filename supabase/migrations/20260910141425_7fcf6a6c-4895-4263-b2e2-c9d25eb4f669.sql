CREATE TABLE public.agent_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  assigned_agent text NOT NULL,
  task_type text NOT NULL,
  priority text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'queued',
  instructions text NOT NULL DEFAULT '',
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification_status text NOT NULL DEFAULT 'not_started',
  verification_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  requires_approval boolean NOT NULL DEFAULT true,
  approval_status text NOT NULL DEFAULT 'not_required',
  source_event text NOT NULL DEFAULT '',
  idempotency_key text NOT NULL,
  execution_mode text NOT NULL DEFAULT 'test',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_tasks_idempotency_key UNIQUE (idempotency_key),
  CONSTRAINT agent_tasks_agent_chk CHECK (assigned_agent IN ('orchestrator','sales','systems_qa','customer_success','growth','admin_finance')),
  CONSTRAINT agent_tasks_type_chk CHECK (task_type IN ('sales_draft','delivery_check','followup_review','qa_review')),
  CONSTRAINT agent_tasks_priority_chk CHECK (priority IN ('low','normal','high')),
  CONSTRAINT agent_tasks_status_chk CHECK (status IN ('queued','in_progress','awaiting_review','done','failed','cancelled')),
  CONSTRAINT agent_tasks_verification_chk CHECK (verification_status IN ('not_started','passed','failed')),
  CONSTRAINT agent_tasks_approval_chk CHECK (approval_status IN ('not_required','pending','approved','rejected')),
  CONSTRAINT agent_tasks_mode_chk CHECK (execution_mode IN ('test','review'))
);

CREATE INDEX agent_tasks_status_idx ON public.agent_tasks (status, created_at DESC);
CREATE INDEX agent_tasks_lead_idx ON public.agent_tasks (lead_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_tasks TO authenticated;
GRANT ALL ON public.agent_tasks TO service_role;
ALTER TABLE public.agent_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins hanterar agentuppgifter" ON public.agent_tasks
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER agent_tasks_updated_at BEFORE UPDATE ON public.agent_tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.agent_task_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.agent_tasks(id) ON DELETE CASCADE,
  actor text NOT NULL,
  actor_user_id uuid,
  event_type text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_task_events_actor_chk CHECK (actor IN ('human','agent','system'))
);

CREATE INDEX agent_task_events_task_idx ON public.agent_task_events (task_id, created_at DESC);

GRANT SELECT, INSERT ON public.agent_task_events TO authenticated;
GRANT ALL ON public.agent_task_events TO service_role;
ALTER TABLE public.agent_task_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins läser agenthändelser" ON public.agent_task_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins skriver agenthändelser" ON public.agent_task_events
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));