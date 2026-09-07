REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;
COMMENT ON FUNCTION public.get_public_landing(text) IS 'Avsiktligt publik: returnerar endast publik information för publicerade kundsidor. Aldrig mottagarmail eller integrationsadress.';