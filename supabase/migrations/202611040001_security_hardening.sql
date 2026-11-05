create table if not exists public.edge_rate_limits (
  key text primary key,
  window_started_at timestamptz not null,
  hits integer not null check (hits >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.security_events (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in ('login_failed', 'login_throttled', 'account_denied', 'account_action', 'account_action_throttled', 'invalid_request')),
  user_id uuid,
  ip_fingerprint text,
  identifier_fingerprint text,
  created_at timestamptz not null default now()
);

alter table public.edge_rate_limits enable row level security;
alter table public.security_events enable row level security;
revoke all on public.edge_rate_limits, public.security_events from public, anon, authenticated;
grant all on public.edge_rate_limits, public.security_events to service_role;
revoke all on sequence public.security_events_id_seq from public, anon, authenticated;
grant usage, select on sequence public.security_events_id_seq to service_role;

alter table public.login_attempts add column if not exists updated_at timestamptz not null default now();

create or replace function public.login_start(p_identifier text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  k text := lower(trim(p_identifier));
  f integer;
  u timestamptz;
begin
  if k is null or length(k) = 0 or length(k) > 254 then
    return jsonb_build_object('locked', false, 'until', null, 'left', 0);
  end if;
  insert into public.login_attempts(identifier, failures, updated_at) values (k, 1, now())
  on conflict (identifier) do update
  set failures = case
        when public.login_attempts.locked_until is not null and public.login_attempts.locked_until <= now() then 1
        else public.login_attempts.failures + 1
      end,
      locked_until = null,
      updated_at = now()
  where public.login_attempts.locked_until is null or public.login_attempts.locked_until <= now()
  returning failures into f;
  if not found then
    select locked_until into u from public.login_attempts where identifier = k;
    return jsonb_build_object('locked', true, 'until', u, 'left', 0);
  end if;
  if f >= 5 then
    u := now() + interval '15 minutes';
    update public.login_attempts set locked_until = u, updated_at = now() where identifier = k;
  end if;
  if random() < 0.01 then
    delete from public.login_attempts where locked_until is null and updated_at < now() - interval '30 days';
  end if;
  return jsonb_build_object('locked', false, 'until', u, 'left', greatest(0, 5 - f));
end
$$;

create or replace function public.login_ok(p_identifier text)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.login_attempts
  set failures = 0, locked_until = null, updated_at = now()
  where identifier = lower(trim(p_identifier))
$$;

revoke all on function public.login_start(text), public.login_ok(text) from public, anon, authenticated;
grant execute on function public.login_start(text), public.login_ok(text) to service_role;

create or replace function public.consume_edge_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  n integer;
begin
  if p_key is null or length(p_key) > 160 or p_limit is null or p_limit < 1 or p_limit > 1000 or p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    return false;
  end if;
  insert into public.edge_rate_limits(key, window_started_at, hits, updated_at)
  values (p_key, now(), 1, now())
  on conflict (key) do update
  set hits = case
        when public.edge_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then 1
        else public.edge_rate_limits.hits + 1
      end,
      window_started_at = case
        when public.edge_rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds) then now()
        else public.edge_rate_limits.window_started_at
      end,
      updated_at = now()
  returning hits into n;
  if random() < 0.01 then
    delete from public.edge_rate_limits where updated_at < now() - interval '2 days';
    delete from public.security_events where created_at < now() - interval '90 days';
  end if;
  return n <= p_limit;
end
$$;

create or replace function public.record_security_event(
  p_event_type text,
  p_user_id uuid default null,
  p_ip_fingerprint text default null,
  p_identifier_fingerprint text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_event_type not in ('login_failed', 'login_throttled', 'account_denied', 'account_action', 'account_action_throttled', 'invalid_request') then
    return;
  end if;
  insert into public.security_events(event_type, user_id, ip_fingerprint, identifier_fingerprint)
  values (
    p_event_type,
    p_user_id,
    left(p_ip_fingerprint, 64),
    left(p_identifier_fingerprint, 64)
  );
end
$$;

revoke all on function public.consume_edge_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.record_security_event(text, uuid, text, text) from public, anon, authenticated;
grant execute on function public.consume_edge_rate_limit(text, integer, integer) to service_role;
grant execute on function public.record_security_event(text, uuid, text, text) to service_role;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'students_validation_check' and conrelid = 'public.students'::regclass) then
    alter table public.students add constraint students_validation_check check (
      length(btrim(name)) between 1 and 120
      and enrolment_no ~ '^[A-Za-z0-9][A-Za-z0-9-]{2,39}$'
      and (grade is null or grade between 6 and 13)
      and status is not null and status in ('Active', 'Inactive', 'Alumni')
      and (section is null or length(section) <= 80)
      and rank is not null and rank in ('Cadet', 'Lance Corporal', 'Corporal', 'Sergeant', 'Staff Sergeant', 'Warrant Officer')
      and (level is null or level in ('Beginner', 'Intermediate', 'Advanced'))
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'events_validation_check' and conrelid = 'public.events'::regclass) then
    alter table public.events add constraint events_validation_check check (
      length(btrim(name)) between 1 and 120
      and type is not null and type in ('Rehearsal', 'Parade', 'Performance', 'Camp')
      and (location is null or length(location) <= 200)
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'attendance_validation_check' and conrelid = 'public.attendance'::regclass) then
    alter table public.attendance add constraint attendance_validation_check check (
      status in ('Present', 'Late', 'Absent', 'Excused')
      and (note is null or length(note) <= 1000)
      and (recorded_by is null or length(recorded_by) <= 120)
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'assets_validation_check' and conrelid = 'public.assets'::regclass) then
    alter table public.assets add constraint assets_validation_check check (
      length(btrim(code)) between 1 and 80
      and (type is null or length(type) <= 100)
      and (brand is null or length(brand) <= 160)
      and status is not null and status in ('Available', 'Issued', 'Repair', 'Retired')
      and (condition is null or condition in ('Good', 'Fair', 'Needs repair'))
      and (notes is null or length(notes) <= 2000)
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'assignments_validation_check' and conrelid = 'public.assignments'::regclass) then
    alter table public.assignments add constraint assignments_validation_check check (
      (asset_id is not null and student_id is not null and issued_on is not null)
      and (due_on is null or due_on >= issued_on)
      and (returned_on is null or returned_on >= issued_on)
      and (cond_out is null or cond_out in ('Good', 'Fair'))
      and (cond_in is null or cond_in in ('Good', 'Fair', 'Damaged'))
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'assessments_validation_check' and conrelid = 'public.assessments'::regclass) then
    alter table public.assessments add constraint assessments_validation_check check (
      (student_id is not null and category is not null and category in ('Band exam', 'Term test', 'Playing skill'))
      and (subject is not null and length(btrim(subject)) between 1 and 160)
      and (date is not null and score is not null and score >= 0)
      and (max_score is not null and max_score > 0)
      and (score is null or max_score is null or score <= max_score)
      and (notes is null or length(notes) <= 2000)
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'notation_validation_check' and conrelid = 'public.notation'::regclass) then
    alter table public.notation add constraint notation_validation_check check (
      length(btrim(name)) between 1 and 160
      and category is not null and category in ('Stationary Songs', 'Group A', 'Group B', 'Group C', 'Group D', 'Brass', 'Woodwind', 'Percussion', 'Full band')
      and url is not null and url ~ '^https://(drive|docs)\.google\.com/'
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rank_history_validation_check' and conrelid = 'public.rank_history'::regclass) then
    alter table public.rank_history add constraint rank_history_validation_check check (
      student_id is not null
      and from_rank is not null and from_rank in ('Cadet', 'Lance Corporal', 'Corporal', 'Sergeant', 'Staff Sergeant', 'Warrant Officer')
      and to_rank is not null and to_rank in ('Cadet', 'Lance Corporal', 'Corporal', 'Sergeant', 'Staff Sergeant', 'Warrant Officer')
      and effective_on is not null
      and (approved_by is null or approved_by in ('Developer', 'Bandmaster', 'Teacher'))
      and (rationale is null or length(rationale) <= 2000)
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'reviews_validation_check' and conrelid = 'public.reviews'::regclass) then
    alter table public.reviews add constraint reviews_validation_check check (
      student_id is not null
      and from_rank is not null and from_rank in ('Cadet', 'Lance Corporal', 'Corporal', 'Sergeant', 'Staff Sergeant', 'Warrant Officer')
      and proposed_rank is not null and proposed_rank in ('Cadet', 'Lance Corporal', 'Corporal', 'Sergeant', 'Staff Sergeant', 'Warrant Officer')
      and evidence is not null and jsonb_typeof(evidence) = 'object'
      and (recommendation is null or recommendation in ('', 'Recommend promotion', 'Do not recommend', 'Defer'))
      and (notes is null or length(notes) <= 4000)
      and status is not null and status in ('Draft', 'Submitted', 'Approved', 'Deferred')
      and (reviewed_by is null or reviewed_by in ('Developer', 'Bandmaster', 'Teacher'))
      and (decided_by is null or decided_by in ('Developer', 'Bandmaster', 'Teacher'))
    ) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'audit_validation_check' and conrelid = 'public.audit'::regclass) then
    alter table public.audit add constraint audit_validation_check check (
      user_role is not null and user_role in ('Bandmaster', 'Teacher', 'Developer')
      and action is not null and length(action) <= 500
    ) not valid;
  end if;
end
$$;

