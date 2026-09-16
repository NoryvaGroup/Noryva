ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS launch_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS launch_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS launch_approved_by uuid;