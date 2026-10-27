drop policy if exists staff_read on public.notation;
drop policy if exists notation_active_accounts_read on public.notation;

create policy notation_active_accounts_read on public.notation
  for select to authenticated
  using (
    exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and active
        and role in ('teacher', 'member', 'developer')
    )
  );
