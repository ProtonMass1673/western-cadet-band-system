-- Upgrade databases created with the original email-keyed login counter.
alter table public.login_attempts rename column email to identifier;

drop function if exists public.login_gate(text);
drop function if exists public.login_fail(text);
drop function if exists public.login_ok();

create or replace function public.login_start(p_identifier text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare k text:=lower(trim(p_identifier)); f int; u timestamptz;
begin
  insert into public.login_attempts(identifier,failures) values(k,1)
  on conflict(identifier) do update set
    failures=case when public.login_attempts.locked_until is not null and public.login_attempts.locked_until<=now() then 1 else public.login_attempts.failures+1 end,
    locked_until=null
  where public.login_attempts.locked_until is null or public.login_attempts.locked_until<=now()
  returning failures into f;
  if not found then
    select locked_until into u from public.login_attempts where identifier=k;
    return jsonb_build_object('locked',true,'until',u,'left',0);
  end if;
  if f>=5 then
    u:=now()+interval '15 minutes';
    update public.login_attempts set locked_until=u where identifier=k;
  end if;
  return jsonb_build_object('locked',false,'until',u,'left',greatest(0,5-f));
end $$;

create or replace function public.login_ok(p_identifier text)
returns void language sql security definer set search_path=public as
$$ update public.login_attempts set failures=0,locked_until=null where identifier=lower(trim(p_identifier)) $$;

revoke all on function public.login_start(text),public.login_ok(text) from public,anon,authenticated;
grant execute on function public.login_start(text),public.login_ok(text) to service_role;
