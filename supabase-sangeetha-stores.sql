create table if not exists public.sangeetha_stores (
  id bigint generated always as identity primary key,
  store_number integer,
  google_place_id text unique,
  official_store_id bigint,
  data_source text not null default 'catalog',
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
  store_sqft integer,
  locator_name text,
  locator_address text,
  locator_latitude double precision,
  locator_longitude double precision,
  google_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sangeetha_stores_source_identifier_check
    check (google_place_id is not null or official_store_id is not null or data_source = 'manual')
);

create sequence if not exists public.sangeetha_store_number_seq;

alter table public.sangeetha_stores add column if not exists store_number integer;
alter table public.sangeetha_stores add column if not exists data_source text;
alter table public.sangeetha_stores add column if not exists store_sqft integer;

alter table public.sangeetha_stores alter column data_source set default 'catalog';
update public.sangeetha_stores set data_source = 'catalog' where data_source is null;
alter table public.sangeetha_stores alter column data_source set not null;

alter table public.sangeetha_stores drop constraint if exists sangeetha_stores_source_identifier_check;
alter table public.sangeetha_stores
  add constraint sangeetha_stores_source_identifier_check
  check (google_place_id is not null or official_store_id is not null or data_source = 'manual');

alter table public.sangeetha_stores drop constraint if exists sangeetha_stores_store_sqft_check;
alter table public.sangeetha_stores
  add constraint sangeetha_stores_store_sqft_check
  check (store_sqft is null or store_sqft >= 0);

alter table public.sangeetha_stores alter column store_number set default nextval('public.sangeetha_store_number_seq');

with numbered as (
  select id, nextval('public.sangeetha_store_number_seq') as next_store_number
  from public.sangeetha_stores
  where store_number is null
  order by id
)
update public.sangeetha_stores as stores
set store_number = numbered.next_store_number
from numbered
where stores.id = numbered.id;

select setval(
  'public.sangeetha_store_number_seq',
  coalesce((select max(store_number) from public.sangeetha_stores), 1),
  exists (select 1 from public.sangeetha_stores)
);

alter table public.sangeetha_stores alter column store_number set not null;

create unique index if not exists sangeetha_stores_official_store_id_uidx on public.sangeetha_stores (official_store_id) where official_store_id is not null;
create unique index if not exists sangeetha_stores_store_number_uidx on public.sangeetha_stores (store_number);
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

create or replace function public.sync_sangeetha_store_number_sequence()
returns void
language sql
security definer
set search_path = public
as $$
  select setval(
    'public.sangeetha_store_number_seq',
    coalesce((select max(store_number) from public.sangeetha_stores), 1),
    exists (select 1 from public.sangeetha_stores)
  );
$$;

revoke execute on function public.sync_sangeetha_store_number_sequence() from public, anon, authenticated;
grant execute on function public.sync_sangeetha_store_number_sequence() to service_role;

grant select on public.sangeetha_stores to anon, authenticated;
grant select, insert, update, delete on public.sangeetha_stores to service_role;

alter table public.sangeetha_stores enable row level security;

drop policy if exists "Public can read sangeetha stores" on public.sangeetha_stores;
create policy "Public can read sangeetha stores"
on public.sangeetha_stores
for select
to anon, authenticated
using (true);
