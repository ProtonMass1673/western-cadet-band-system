alter table public.profiles add column if not exists email text;

update public.profiles p
set email = lower(u.email)
from auth.users u
where u.id = p.id and p.email is null;

create unique index if not exists profiles_email_unique
on public.profiles (lower(email))
where email is not null;