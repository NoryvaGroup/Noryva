ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS customer_status text NOT NULL DEFAULT 'Ny',
  ADD COLUMN IF NOT EXISTS contacted_at timestamptz;

CREATE INDEX IF NOT EXISTS leads_customer_status_idx ON public.leads (customer_status);