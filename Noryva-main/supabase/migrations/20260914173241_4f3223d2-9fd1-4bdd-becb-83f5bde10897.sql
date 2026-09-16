ALTER TABLE public.contact_requests ADD COLUMN IF NOT EXISTS source_ip_hash text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS contact_requests_source_ip_hash_created_at_idx
  ON public.contact_requests (source_ip_hash, created_at DESC);