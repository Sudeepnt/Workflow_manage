create table if not exists public.sangeetha_stores (
  id bigint generated always as identity primary key,
  google_place_id text unique,
  official_store_id bigint,
  name text not null,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  address text,
  business_status text,
  google_maps_uri text,
  store_code text,
  phone text,
  hours text,
  city text,
  state text,
  verification_status text not null default 'google_directory_only',
  locator_name text,
  locator_address text,
  locator_latitude double precision,
  locator_longitude double precision,
  google_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sangeetha_stores_source_identifier_check
    check (google_place_id is not null or official_store_id is not null)
);

create unique index if not exists sangeetha_stores_official_store_id_uidx on public.sangeetha_stores (official_store_id) where official_store_id is not null;
create index if not exists sangeetha_stores_synced_at_idx on public.sangeetha_stores (google_synced_at desc nulls last);
create index if not exists sangeetha_stores_coordinates_idx on public.sangeetha_stores (latitude, longitude);
create index if not exists sangeetha_stores_verification_status_idx on public.sangeetha_stores (verification_status);

create or replace function public.set_sangeetha_stores_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_sangeetha_stores_updated_at on public.sangeetha_stores;
create trigger set_sangeetha_stores_updated_at
before update on public.sangeetha_stores
for each row
execute function public.set_sangeetha_stores_updated_at();

grant select on public.sangeetha_stores to anon, authenticated;
grant select, insert, update, delete on public.sangeetha_stores to service_role;

alter table public.sangeetha_stores enable row level security;

drop policy if exists "Public can read sangeetha stores" on public.sangeetha_stores;
create policy "Public can read sangeetha stores"
on public.sangeetha_stores
for select
to anon, authenticated
using (true);
