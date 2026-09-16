create table public.contact_requests (
  id uuid not null default gen_random_uuid() primary key,
  namn text not null,
  foretag text not null,
  epost text not null,
  telefon text not null,
  hemsida text,
  forbattra text not null,
  meddelande text,
  created_at timestamptz not null default now()
);
grant insert on public.contact_requests to anon, authenticated;
grant select on public.contact_requests to authenticated;
grant all on public.contact_requests to service_role;
alter table public.contact_requests enable row level security;
create policy "Besokare kan skicka in forfragan" on public.contact_requests for insert to anon, authenticated with check (true);
create policy "Inloggade kan lasa forfragningar" on public.contact_requests for select to authenticated using (true);