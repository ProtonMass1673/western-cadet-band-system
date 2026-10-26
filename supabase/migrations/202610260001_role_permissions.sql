-- Teachers are read-only except that they may add unlinked student records
-- and new attendance rows. Developers manage operational records.
create or replace function public.is_teacher()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'teacher' and active
  )
$$;

create or replace function public.is_developer()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'developer' and active
  )
$$;

create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('teacher', 'developer') and active
  )
$$;

drop policy if exists own_profile on public.profiles;
create policy own_profile on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_developer());

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'students', 'events', 'attendance', 'assets', 'assignments',
    'assessments', 'rank_history', 'reviews', 'notation', 'audit'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists teacher_all on public.%I', table_name);
    execute format('drop policy if exists staff_read on public.%I', table_name);
    execute format('drop policy if exists developer_all on public.%I', table_name);
    execute format(
      'create policy staff_read on public.%I for select to authenticated using (public.is_staff())',
      table_name
    );
    execute format(
      'create policy developer_all on public.%I for all to authenticated using (public.is_developer()) with check (public.is_developer())',
      table_name
    );
  end loop;
end $$;

drop policy if exists teacher_add_students on public.students;
create policy teacher_add_students on public.students
  for insert to authenticated
  with check (public.is_teacher() and user_id is null);

drop policy if exists teacher_add_attendance on public.attendance;
create policy teacher_add_attendance on public.attendance
  for insert to authenticated
  with check (public.is_teacher());

-- Keep the existing member-only read policies; students receive no write access.

