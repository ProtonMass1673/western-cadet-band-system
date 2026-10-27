drop policy if exists teacher_notation_manage on public.notation;

create policy teacher_notation_manage on public.notation
  for all to authenticated
  using (public.is_teacher())
  with check (public.is_teacher());
