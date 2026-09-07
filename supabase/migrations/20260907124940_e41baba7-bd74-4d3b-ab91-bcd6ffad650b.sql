CREATE TYPE public.app_role AS ENUM ('admin');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own roles" ON public.user_roles FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  industry text NOT NULL CHECK (industry IN ('tak','varuautomater')),
  schema_version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  headline text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  cta_label text NOT NULL DEFAULT 'Skicka förfrågan',
  contact_email text NOT NULL DEFAULT '',
  contact_phone text NOT NULL DEFAULT '',
  service_area text NOT NULL DEFAULT '',
  recipient_email text NOT NULL DEFAULT '',
  delivery_webhook_url text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated;
GRANT ALL ON public.customers TO service_role;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage customers" ON public.customers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER customers_updated_at BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.form_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  label text NOT NULL,
  field_type text NOT NULL DEFAULT 'text' CHECK (field_type IN ('text','textarea','select','email','tel')),
  options text[] NOT NULL DEFAULT '{}',
  required boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (customer_id, field_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.form_questions TO authenticated;
GRANT ALL ON public.form_questions TO service_role;
ALTER TABLE public.form_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage questions" ON public.form_questions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER form_questions_updated_at BEFORE UPDATE ON public.form_questions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  industry text NOT NULL,
  schema_version integer NOT NULL DEFAULT 1,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text NOT NULL UNIQUE,
  delivery_status text NOT NULL DEFAULT 'pending' CHECK (delivery_status IN ('pending','not_configured','delivered','failed')),
  delivery_error text NOT NULL DEFAULT '',
  delivered_at timestamptz,
  source_ip_hash text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.leads TO authenticated;
GRANT ALL ON public.leads TO service_role;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read leads" ON public.leads FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX leads_customer_created_idx ON public.leads (customer_id, created_at DESC);
CREATE INDEX leads_ip_created_idx ON public.leads (source_ip_hash, created_at DESC);

CREATE OR REPLACE FUNCTION public.get_public_landing(p_slug text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'slug', c.slug,
    'name', c.name,
    'industry', c.industry,
    'schema_version', c.schema_version,
    'headline', c.headline,
    'description', c.description,
    'cta_label', c.cta_label,
    'contact_email', c.contact_email,
    'contact_phone', c.contact_phone,
    'service_area', c.service_area,
    'questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'field_key', q.field_key,
        'label', q.label,
        'field_type', q.field_type,
        'options', q.options,
        'required', q.required
      ) ORDER BY q.sort_order, q.created_at)
      FROM public.form_questions q WHERE q.customer_id = c.id
    ), '[]'::jsonb)
  )
  FROM public.customers c
  WHERE c.slug = p_slug AND c.status = 'published'
$$;
REVOKE ALL ON FUNCTION public.get_public_landing(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_landing(text) TO anon, authenticated, service_role;