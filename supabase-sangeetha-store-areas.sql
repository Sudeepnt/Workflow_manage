create table if not exists public.sangeetha_store_areas (
  id bigint generated always as identity primary key,
  area_number integer,
  name text not null,
  points jsonb not null default '[]'::jsonb,
  centroid_latitude double precision,
  centroid_longitude double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sangeetha_store_areas_points_check check (jsonb_typeof(points) = 'array')
);

create sequence if not exists public.sangeetha_store_areas_number_seq;

alter table public.sangeetha_store_areas add column if not exists area_number integer;
alter table public.sangeetha_store_areas add column if not exists centroid_latitude double precision;
alter table public.sangeetha_store_areas add column if not exists centroid_longitude double precision;

alter table public.sangeetha_store_areas
  alter column area_number set default nextval('public.sangeetha_store_areas_number_seq');

with numbered as (
  select id, nextval('public.sangeetha_store_areas_number_seq') as next_area_number
  from public.sangeetha_store_areas
  where area_number is null
  order by id
)
update public.sangeetha_store_areas as areas
set area_number = numbered.next_area_number
from numbered
where areas.id = numbered.id;

select setval(
  'public.sangeetha_store_areas_number_seq',
  coalesce((select max(area_number) from public.sangeetha_store_areas), 0),
  true
);

alter table public.sangeetha_store_areas alter column area_number set not null;

create unique index if not exists sangeetha_store_areas_area_number_uidx on public.sangeetha_store_areas (area_number);

create or replace function public.set_sangeetha_store_areas_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_sangeetha_store_areas_updated_at on public.sangeetha_store_areas;
create trigger set_sangeetha_store_areas_updated_at
before update on public.sangeetha_store_areas
for each row
execute function public.set_sangeetha_store_areas_updated_at();

revoke insert, update, delete on public.sangeetha_store_areas from anon, authenticated;
revoke usage on sequence public.sangeetha_store_areas_number_seq from anon, authenticated;
grant select on public.sangeetha_store_areas to anon, authenticated;

alter table public.sangeetha_store_areas enable row level security;

drop policy if exists "Public can read sangeetha store areas" on public.sangeetha_store_areas;
create policy "Public can read sangeetha store areas"
on public.sangeetha_store_areas
for select
to anon, authenticated
using (true);

drop policy if exists "Public can insert sangeetha store areas" on public.sangeetha_store_areas;
drop policy if exists "Public can update sangeetha store areas" on public.sangeetha_store_areas;
drop policy if exists "Public can delete sangeetha store areas" on public.sangeetha_store_areas;
