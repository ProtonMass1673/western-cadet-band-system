# Western Cadet Band System security review

Review date: 4 November 2026

## Summary

The local project has been hardened in the browser code, Edge Functions, and a new database migration. The Edge Function and database changes are not live yet: this workspace has no Supabase CLI, and the Supabase dashboard requires the project owner to sign in. The GitHub repository is public and Pages is now configured to deploy through Actions; a fresh deployment must complete before the site URL is available.

## Changes prepared

- Removed built-in demo accounts, demo passwords, sample student data, and the browser-only authentication fallback. The app now fails closed when Supabase settings are absent.
- Kept the browser-facing Supabase publishable key only. The service-role key is read from Supabase Function secrets in server-side code and is absent from the HTML and current local files.
- Added per-IP sign-in throttling (60 attempts per 15 minutes) alongside the existing five-failure, 15-minute per-account lockout. Rate-limit keys and logged identifiers are SHA-256 fingerprints.
- Added account-function IP throttling (60 requests per 15 minutes) and a developer account-action limit (30 requests per hour), JSON content-type checks, 8 KiB request-body limits, strict UUID checks, and tighter name/email validation.
- Added a service-role-only `security_events` table and RPCs. Events include failed logins, invalid account access, successful account actions, and throttled requests; fingerprints are retained for up to 90 days. Old lockout and rate-limit rows are periodically pruned.
- Added a database migration with server-side checks for student records, attendance, events, assets, assignments, assessments, notation links, and audit rows. These checks are `NOT VALID`, so existing data is not scanned during installation; new writes and updates are checked.
- Escaped apostrophes in rendered text, restricts notation links to HTTPS Google Drive/Docs hosts in both the app and migration, and opens them with `noopener noreferrer`.
- Added `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy` to both Edge Function responses. Function responses also use `Cache-Control: no-store`.
- Pinned each GitHub Pages workflow action to its full upstream commit SHA to prevent a moved version tag from silently changing the code that runs during deployment.
- Updated the setup guide with the migration-before-function-deploy order and Supabase Auth security settings to enable.

## Existing controls confirmed in source

- Supabase Auth verifies passwords and stores salted bcrypt hashes; the app does not implement password hashing itself.
- Database tables already have RLS policies for staff, developers, and student-owned records. The account function independently verifies the JWT and active developer role before account administration.
- Database access uses the Supabase REST/PostgREST client interface with fixed table names and encoded UUID filters. There is no raw SQL query built from form input.
- Browser sessions are not cookie-based. The app keeps the access token in JavaScript memory and does not save it in local storage, so CSRF via ambient cookies does not apply. The theme preference is the only persistent browser setting. Sessions expire on page reload because no refresh token is stored.
- The app does not currently set a Content Security Policy. GitHub Pages does not let this workflow configure response headers; a meta policy would not protect the existing inline script and event handlers adequately. CSP remains a hosting/rework item.
- Suspicious activity is recorded in the service-only `security_events` table, but there is no alert delivery or active monitoring integration. Someone with developer/operations access must periodically review logs or connect them to an alerting service.
- Password reset is not implemented as an in-app flow. Supabase invitation/reset link expiration and leaked-password controls remain hosted Auth settings and must be checked in the project dashboard.
- The project has no payment, price, or file-upload feature, so payment verification and upload-type/size controls are not applicable to this app.

## Verification performed

- `node --test tests/security-review.test.mjs`: 7 tests passed. These check browser JavaScript syntax, Edge Function executable syntax after stripping TypeScript annotations, absence of privileged-key patterns and demo credentials, URL/XSS safeguards, RLS/lockout source controls, Edge Function authorization/throttling/input limits, and migration controls.
- Scanned diffs for all 25 commits available from GitHub for high-confidence service-role keys, JWTs, AWS keys, GitHub tokens, and Google API keys: no matches. All commit author emails used GitHub's `users.noreply.github.com` form.
- Checked the pinned `@supabase/supabase-js` dependency against the official release list. Version `2.118.0` is the latest stable release shown; `2.119.0` is still marked canary. The functions use only this one direct package. An npm audit was not available because this workspace has no npm executable or lockfile.
- Deno and the Supabase CLI are unavailable in this workspace. Edge Functions were not runtime-tested and the SQL migration was not executed against the hosted project.
- No Supabase dashboard session was available in the open browser tabs, so hosted Auth settings and secret-vault contents could not be checked or changed.

## Remaining work before calling production secured

1. In Supabase SQL Editor, apply `supabase/migrations/202611040001_security_hardening.sql` to project `jvjwepsmgnleltoduzul`.
2. Deploy the updated `auth-login` and `manage-account` functions only after the migration succeeds. Keep `verify_jwt = false` for these functions because their code performs the necessary session and role checks.
3. In Supabase Auth settings, set the minimum password length to at least 12, set OTP/invitation/password-reset link expiry to 3600 seconds or less, enable leaked-password protection if available on the plan, and require MFA for developer accounts. Supabase Auth uses bcrypt for password hashes. See the [Supabase password security guide](https://supabase.com/docs/guides/auth/password-security) and [production checklist](https://supabase.com/docs/guides/security/production-checklist).
4. If the short developer password previously shared in chat is still active, replace it through the normal Supabase Auth password flow. It was not found in repository history.
5. The repository is now public, and its source, complete commit history, Actions history, and logs can be viewed or copied by anyone. Pages is configured to deploy from GitHub Actions; verify the new workflow run and use its published URL. GitHub Free requires a public repository for Pages and unpublishes Pages if it is made private. GitHub Pages also does not expose arbitrary security-header configuration for this workflow. Use a host that supports response headers if you need a strict Content Security Policy. [GitHub repository visibility](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility), [GitHub Pages plan requirements](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)
6. After applying the migration and deploying, run live tests for login lockout/rate limiting, RLS isolation, account-role denial, and security-event creation from a test account. Do not use real student accounts for denial tests.
7. Set up a routine review or alert pipeline for `security_events`; the table records events but does not notify anyone by itself. For strict CSP and custom response headers, use a host that supports them and deploy a restrictive policy after removing inline scripts and handlers.

## Scope limits

The history scan uses high-confidence credential patterns; it is not a substitute for GitHub secret scanning or a full entropy-based scanner. The hosted Supabase Auth configuration and production database policies were not re-read in this session. The source code review and local tests do not certify the live system until the migration and function deployments are completed and verified.

