create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create table if not exists public.agent_cron_auth (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  secret_sha256 text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant all on public.agent_cron_auth to service_role;

alter table public.agent_cron_auth enable row level security;

create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql set search_path = public;

drop trigger if exists update_agent_cron_auth_updated_at on public.agent_cron_auth;
create trigger update_agent_cron_auth_updated_at
before update on public.agent_cron_auth
for each row execute function public.update_updated_at_column();