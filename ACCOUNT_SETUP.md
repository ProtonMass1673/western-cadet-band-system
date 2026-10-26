# Supabase setup and student enrollment

The connected app uses Supabase for student records, attendance, accounts, and role-based access. The HTML file points to the school's Supabase project and is published on GitHub Pages. The schema, authentication functions, Supabase Auth URLs, and custom SMTP sender have been configured there.

## Supabase database and functions

For a new project, run `schema.sql` once in **SQL Editor**. For an existing installation, apply the migrations in order: `supabase/migrations/202610190001_profiles_email.sql`, `supabase/migrations/202610190002_developer_role.sql`, `supabase/migrations/202610230001_student_id_login.sql`, then `supabase/migrations/202610260001_role_permissions.sql`.

The two functions are:

- `manage-account`: developer-only account invitations and deletions; student invitations are linked to a student record.
- `auth-login`: maps a student enrolment number or staff email to a Supabase Auth user and enforces the five-failure lockout.

Both functions use Supabase's hosted `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` values. Never place the service-role key in the HTML file. The account function verifies the caller's session and teacher/developer role in its own code. The login function must be callable before a session exists, so set **Verify JWT off for `auth-login` only**. If deploying with the Supabase CLI, deploy it with `--no-verify-jwt`:

```text
supabase functions deploy manage-account --project-ref <project-ref>
supabase functions deploy auth-login --project-ref <project-ref> --no-verify-jwt
```

The repository's `supabase/config.toml` sets `verify_jwt = false` for both functions; each function still validates the user's JWT and role inside the function. Only developers may invite or delete accounts. Account deletion removes the Supabase Auth user and profile and unlinks (but does not delete) a student record.

## Teacher and developer permissions

- Teachers can read band records, add student/member records, and add attendance for sessions that already exist.
- Teachers cannot edit or delete records, create events, invite accounts, or delete accounts.
- Developers can add, edit, and delete operational band records, and can invite or delete accounts. The last active developer account and the developer currently signed in are protected from deletion.
- These rules are enforced by Supabase Row Level Security as well as by hiding unavailable actions in the app. Student accounts remain read-only and limited to their linked student record.

## Publish the app with GitHub Pages

The workflow at `.github/workflows/deploy-pages.yml` publishes only the app as `index.html`; it does not publish the SQL schema or Edge Function source as website files. To deploy it:

1. Create a GitHub repository and add this project folder to its `main` branch. With GitHub Free, Pages requires a public repository; check the repository visibility before publishing the source.
2. In the repository, open **Settings → Pages** and choose **GitHub Actions** as the source.
3. Push the files to `main` or run the **Deploy Western Cadet Band app to GitHub Pages** workflow from **Actions**. Copy the published HTTPS URL from the successful run.
4. In Supabase **Authentication → URL Configuration**, set the Site URL to that published app URL and add the same URL to allowed redirect URLs.
5. In Supabase **Authentication → SMTP Settings**, configure the school's approved email provider. Enter SMTP credentials in Supabase only; do not put them in this file or send them in chat.
6. Send a test invitation to an approved staff address, follow the link, set a strong password, and confirm sign-in.

## Create the first developer account

The first developer must be bootstrapped in Supabase before the app can invite accounts. In **Authentication → Users**, create or invite the developer using their school-approved email address. Then run this in **SQL Editor**, replacing the email and name:

```sql
insert into public.profiles (id, full_name, email, role, active)
select id, 'System Developer', lower(email), 'developer', true
from auth.users
where lower(email) = lower('developer@school.lk')
on conflict (id) do update
set full_name = excluded.full_name,
    email = excluded.email,
    role = 'developer',
    active = true;
```

Developer and teacher accounts sign in with their registered email address, not a developer ID. The initial developer can invite teachers and students; only a developer can invite another developer. Do not use a short shared password. Set a unique password of at least 8 characters through the invitation flow.

## Enroll a student and give them their own dashboard

1. Sign in as a teacher or developer and open **Members → Add member**. A teacher can add a new member, but only a developer can edit or delete existing member records.
2. Enter the student's name, unique enrolment number (student ID), grade, section, and instrument, then save. This creates that student's database row.
3. Ask a developer to open **Accounts → Invite account**. Choose **Student**, enter their school-approved email address, and select the matching student record. Only developers can invite accounts; the invitation function links the account to that one student row.
4. The student opens the invitation email and sets their own strong password.
5. The student signs in with their **enrolment number** and chosen password. The account opens that student's **My profile** dashboard. Row-level security restricts student records to the linked student; teachers can manage the band and mark attendance.

Each student needs a different enrolment number and individual email/account. The link is stored in `students.user_id`; do not manually copy another student's user ID. If you add a student record before inviting them, it remains unlinked and appears in the invitation selector.

## Login limit

Five consecutive failed sign-in attempts lock the account for 15 minutes. A successful sign-in resets the counter. The `auth-login` Edge Function uses the account's canonical email for the counter, so entering the same account by enrolment number or email cannot grant another set of attempts. The local demo's browser-only counter is not a production security control.

## Demo accounts

The local demo has ten fictional students with IDs `MCWB-2026-0040` through `MCWB-2026-0049`, and a demo teacher `teacher@demo.lk`. Their demo passwords are displayed in the app only when Supabase is not configured. Do not use demo credentials or enter real student data in demo mode.

