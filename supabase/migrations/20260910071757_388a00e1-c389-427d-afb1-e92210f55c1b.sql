CREATE TABLE public.customer_mail_channels (
  customer_id uuid PRIMARY KEY REFERENCES public.customers(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'smtp' CHECK (provider IN ('smtp','postmark','other')),
  sender_email text NOT NULL DEFAULT '',
  sender_name text,
  reply_to_email text NOT NULL DEFAULT '',
  inbound_route_key text UNIQUE,
  connection_alias text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','verified','disabled')),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.customer_mail_channels TO service_role;

ALTER TABLE public.customer_mail_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read mail channels"
ON public.customer_mail_channels FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER customer_mail_channels_updated_at
BEFORE UPDATE ON public.customer_mail_channels
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.customer_mail_channels TO authenticated;