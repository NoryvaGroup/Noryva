ALTER TABLE public.agent_meetings DROP CONSTRAINT agent_meetings_created_by_fkey;
ALTER FUNCTION public.claim_agent_meeting_step(uuid, text) SECURITY INVOKER;