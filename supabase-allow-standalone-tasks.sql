-- Allow internal/admin tasks that are not attached to a project.
-- This matches the app behavior where Tasks.project is optional.
alter table public.tasks
  alter column project drop not null;
