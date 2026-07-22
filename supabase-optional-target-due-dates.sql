-- Allow records to be created before target/due dates are known.
alter table public.projects
  alter column target_date drop not null;

alter table public.tasks
  alter column due_date drop not null;

alter table public.transactions
  alter column due_date drop not null;
