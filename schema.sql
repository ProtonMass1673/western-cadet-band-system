-- Western Cadet Band Management System — Postgres / Supabase schema
-- Run this whole file once in Supabase: SQL Editor > New query > paste > Run.
create table students(id uuid primary key,enrolment_no text unique not null,name text not null,grade int,status text default 'Active',section text,instrument text,rank text default 'Cadet',level text,since int,user_id uuid unique references auth.users on delete set null);
create table events(id uuid primary key,name text not null,type text,date date not null,location text);
create table attendance(id uuid primary key,student_id uuid references students on delete cascade,event_id uuid references events on delete cascade,status text not null,note text,recorded_by text,at timestamptz default now(),unique(student_id,event_id));
create table assets(id uuid primary key,code text unique not null,type text,brand text,status text default 'Available',condition text,notes text);
create table assignments(id uuid primary key,asset_id uuid references assets,student_id uuid references students,issued_on date,due_on date,returned_on date,cond_out text,cond_in text);
create unique index one_open_assignment on assignments(asset_id) where returned_on is null;
create table assessments(id uuid primary key,student_id uuid references students on delete cascade,category text,subject text,date date,score numeric,max_score numeric,notes text);
create table rank_history(id uuid primary key,student_id uuid references students on delete cascade,from_rank text,to_rank text,effective_on date,approved_by text,rationale text);
create table reviews(id uuid primary key,student_id uuid references students on delete cascade,from_rank text,proposed_rank text,evidence jsonb,recommendation text,notes text,status text,reviewed_by text,reviewed_on date,decided_by text,decided_on date);
create table notation(id uuid primary key,name text not null,category text,url text,updated date);
create table audit(id uuid primary key,user_role text,action text,at timestamptz default now());

-- Who can sign in, and as what. One row per Supabase Auth user.
create table profiles(id uuid primary key references auth.users on delete cascade, full_name text not null, email text, role text not null check (role in ('teacher','member','developer')), active boolean not null default true);
alter table profiles add column if not exists email text;
update profiles p set email=lower(u.email) from auth.users u where u.id=p.id and p.email is null;
create unique index if not exists profiles_email_unique on profiles(lower(email)) where email is not null;
-- Failed-login counter keyed by the account's canonical email (or unknown login ID).
-- No policies: only the authentication Edge Function uses the service-role client.
create table login_attempts(identifier text primary key, failures int not null default 0, locked_until timestamptz);

create function is_teacher() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from profiles where id=auth.uid() and role='teacher' and active) $$;
create function is_developer() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from profiles where id=auth.uid() and role='developer' and active) $$;
create function is_staff() returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from profiles where id=auth.uid() and role in ('teacher','developer') and active) $$;

-- The auth-login Edge Function atomically reserves each attempt with its
-- service-role key. Five failures lock the account for 15 minutes; success clears it.
create function login_start(p_identifier text) returns jsonb language plpgsql security definer set search_path=public as $$
declare k text:=lower(trim(p_identifier)); f int; u timestamptz;
begin
 insert into login_attempts(identifier,failures) values(k,1)
 on conflict(identifier) do update set
   failures=case when login_attempts.locked_until is not null and login_attempts.locked_until<=now() then 1 else login_attempts.failures+1 end,
   locked_until=null
 where login_attempts.locked_until is null or login_attempts.locked_until<=now()
 returning failures into f;
 if not found then select locked_until into u from login_attempts where identifier=k; return jsonb_build_object('locked',true,'until',u,'left',0); end if;
 if f>=5 then u:=now()+interval '15 minutes'; update login_attempts set locked_until=u where identifier=k; end if;
 return jsonb_build_object('locked',false,'until',u,'left',greatest(0,5-f));
end $$;
create function login_ok(p_identifier text) returns void language sql security definer set search_path=public as
$$ update login_attempts set failures=0,locked_until=null where identifier=lower(trim(p_identifier)) $$;
revoke all on function login_start(text),login_ok(text) from public,anon,authenticated;
grant execute on function login_start(text),login_ok(text) to service_role;

-- ===== Row-level security: nothing is readable unless a policy allows it =====
alter table profiles enable row level security; alter table login_attempts enable row level security;
create policy own_profile on profiles for select to authenticated using (id=auth.uid() or is_developer());
do $$ declare t text; begin foreach t in array array['students','events','attendance','assets','assignments','assessments','rank_history','reviews','notation','audit'] loop
 alter table public.profiles enable row level security;
 execute format('alter table %I enable row level security',t);
 execute format('create policy staff_read on %I for select to authenticated using (is_staff())',t);
 execute format('create policy developer_all on %I for all to authenticated using (is_developer()) with check (is_developer())',t);
end loop; end $$;
create policy teacher_add_students on students for insert to authenticated with check (is_teacher() and user_id is null);
create policy teacher_add_attendance on attendance for insert to authenticated with check (is_teacher());
-- Members: their own record only. Term-test / O/L marks stay hidden; band exam marks are visible.
create policy m_student on students for select to authenticated using (user_id=auth.uid());
create policy m_attendance on attendance for select to authenticated using (student_id in (select id from students where user_id=auth.uid()));
create policy m_assess on assessments for select to authenticated using (category='Band exam' and student_id in (select id from students where user_id=auth.uid()));
create policy m_rank on rank_history for select to authenticated using (student_id in (select id from students where user_id=auth.uid()));
create policy m_assign on assignments for select to authenticated using (student_id in (select id from students where user_id=auth.uid()));
create policy m_events on events for select to authenticated using (true);
create policy m_assets on assets for select to authenticated using (true);

-- ===== Create your first users =====
-- 1) Supabase dashboard > Authentication > Users > Add user (email + password, tick "Auto confirm").
-- 2) Then run these, replacing the emails:
--   insert into profiles(id,full_name,role) select id,'Bandmaster','teacher' from auth.users where email='teacher@yourschool.lk';
--   insert into profiles(id,full_name,role) select id,'Student A','member'  from auth.users where email='member@yourschool.lk';
-- 3) Link a member login to their student row:
--   update students set user_id=(select id from auth.users where email='member@yourschool.lk') where enrolment_no='MCWB-2026-0042';

