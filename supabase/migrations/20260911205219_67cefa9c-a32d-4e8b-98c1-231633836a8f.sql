ALTER TABLE public.agent_tasks DROP CONSTRAINT IF EXISTS agent_tasks_agent_chk;
ALTER TABLE public.agent_tasks ADD CONSTRAINT agent_tasks_agent_chk CHECK (assigned_agent = ANY (ARRAY[
  'orchestrator','sales','systems_qa','customer_success','growth','admin_finance',
  'noryva_manager','product_tech','growth_sales','qa_risk','operations_finance'
]));

ALTER TABLE public.agent_tasks DROP CONSTRAINT IF EXISTS agent_tasks_type_chk;
ALTER TABLE public.agent_tasks ADD CONSTRAINT agent_tasks_type_chk CHECK (task_type = ANY (ARRAY[
  'sales_draft','delivery_check','followup_review','qa_review','cto_improvement_review',
  'manager_directive','product_tech_review',
  'growth_sales_review','customer_success_review','qa_risk_review','operations_finance_review'
]));