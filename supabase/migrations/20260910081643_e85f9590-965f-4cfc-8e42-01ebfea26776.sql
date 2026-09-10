REVOKE EXECUTE ON FUNCTION public.claim_lead_reminder(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.complete_lead_reminder(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fail_lead_reminder(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_lead_reminder(uuid, text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_lead_reminder(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_lead_reminder(uuid, uuid, text, text) TO service_role;