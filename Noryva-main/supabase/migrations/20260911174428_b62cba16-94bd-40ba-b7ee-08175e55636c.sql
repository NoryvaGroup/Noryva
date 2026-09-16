ALTER TABLE public.agent_tasks
  ADD COLUMN IF NOT EXISTS provider_type text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS provider_agent_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS provider_run_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS run_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS run_budget integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS runs_used integer NOT NULL DEFAULT 0;

ALTER TABLE public.agent_tasks DROP CONSTRAINT IF EXISTS agent_tasks_provider_chk;
ALTER TABLE public.agent_tasks ADD CONSTRAINT agent_tasks_provider_chk
  CHECK (provider_type = ANY (ARRAY['none'::text, 'openai_agents'::text, 'legacy_responses'::text]));

ALTER TABLE public.agent_tasks DROP CONSTRAINT IF EXISTS agent_tasks_run_status_chk;
ALTER TABLE public.agent_tasks ADD CONSTRAINT agent_tasks_run_status_chk
  CHECK (run_status = ANY (ARRAY['not_started'::text, 'requested'::text, 'running'::text, 'completed'::text, 'failed'::text, 'blocked'::text]));

ALTER TABLE public.agent_tasks DROP CONSTRAINT IF EXISTS agent_tasks_run_budget_chk;
ALTER TABLE public.agent_tasks ADD CONSTRAINT agent_tasks_run_budget_chk
  CHECK (run_budget >= 0 AND run_budget <= 5 AND runs_used >= 0 AND runs_used <= run_budget);

ALTER TABLE public.agent_tasks DROP CONSTRAINT IF EXISTS agent_tasks_agent_chk;
ALTER TABLE public.agent_tasks ADD CONSTRAINT agent_tasks_agent_chk
  CHECK (assigned_agent = ANY (ARRAY['orchestrator'::text, 'sales'::text, 'systems_qa'::text, 'customer_success'::text, 'growth'::text, 'admin_finance'::text, 'noryva_manager'::text, 'product_tech'::text]));

ALTER TABLE public.agent_tasks DROP CONSTRAINT IF EXISTS agent_tasks_type_chk;
ALTER TABLE public.agent_tasks ADD CONSTRAINT agent_tasks_type_chk
  CHECK (task_type = ANY (ARRAY['sales_draft'::text, 'delivery_check'::text, 'followup_review'::text, 'qa_review'::text, 'cto_improvement_review'::text, 'manager_directive'::text, 'product_tech_review'::text]));