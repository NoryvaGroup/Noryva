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
    'accepts_leads', (c.delivery_webhook_url <> ''),
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