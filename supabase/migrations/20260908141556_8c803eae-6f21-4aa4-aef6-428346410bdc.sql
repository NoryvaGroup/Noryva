REVOKE ALL ON FUNCTION public.claim_growth_analysis(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_growth_analysis(uuid, text) TO service_role;