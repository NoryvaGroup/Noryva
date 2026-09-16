ALTER TABLE public.customer_profiles
  ADD COLUMN IF NOT EXISTS local_postal_prefix text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS regional_postal_prefix text NOT NULL DEFAULT '';

ALTER TABLE public.customer_profiles
  DROP CONSTRAINT IF EXISTS customer_profiles_postal_prefix_format;
ALTER TABLE public.customer_profiles
  ADD CONSTRAINT customer_profiles_postal_prefix_format
  CHECK (local_postal_prefix ~ '^([0-9]{2,5})?$' AND regional_postal_prefix ~ '^([0-9]{2,5})?$');

UPDATE public.customer_profiles
SET local_postal_prefix = '50', regional_postal_prefix = '51'
WHERE customer_id = '802728cd-acc5-49df-ad8b-3ec473006086';