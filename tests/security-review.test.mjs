import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const html = readFileSync(new URL('../Western Cadet Band Management System.html', import.meta.url), 'utf8');
const app = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';
const login = readFileSync(new URL('../supabase/functions/auth-login/index.ts', import.meta.url), 'utf8');
const account = readFileSync(new URL('../supabase/functions/manage-account/index.ts', import.meta.url), 'utf8');
const config = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const hardening = readFileSync(new URL('../supabase/migrations/202611040001_security_hardening.sql', import.meta.url), 'utf8');
const stripFunctionTypes = (source) => source
  .replaceAll('(status: number, body: unknown)', '(status, body)')
  .replaceAll('(value: string)', '(value)')
  .replaceAll('(request: Request)', '(request)')
  .replaceAll('let profile: { id: string; full_name: string; email: string | null; role: string; active: boolean } | null = null;', 'let profile = null;')
  .replaceAll('let body: Record<string, unknown>;', 'let body;')
  .replaceAll('const parsed: unknown =', 'const parsed =')
  .replaceAll(' as Record<string, unknown>', '');

test('browser application JavaScript parses', () => {
  assert.ok(app.length > 1000);
  const result = spawnSync(process.execPath, ['--check', '-'], { input: app, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('Edge Function executable syntax parses after removing TypeScript annotations', () => {
  for (const source of [login, account]) {
    const result = spawnSync(process.execPath, ['--check', '--input-type=module', '-'], { input: stripFunctionTypes(source), encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
});

test('browser bundle contains no privileged keys or demo credentials', () => {
  assert.match(html, /sb_publishable_[A-Za-z0-9_-]+/);
  assert.doesNotMatch(html, /sb_secret_|service_role|SUPABASE_SERVICE_ROLE_KEY|Teacher#123|Student#123/);
  assert.doesNotMatch(html, /localStorage\.(?:bm|session|token)|localStorage\[['"](?:bm|session|token)/i);
});

test('rendering escapes HTML and notation links are restricted to Drive', () => {
  assert.match(html, /&#39;/);
  assert.match(html, /safeUrl=v=>/);
  assert.match(html, /drive\.google\.com.*docs\.google\.com/);
  assert.match(html, /noopener noreferrer/);
});

test('database tables enable RLS and lockout functions are restricted', () => {
  assert.match(schema, /enable row level security/i);
  for (const table of ['students', 'events', 'attendance', 'assets', 'assignments', 'assessments', 'rank_history', 'reviews', 'notation', 'audit', 'profiles', 'login_attempts']) {
    assert.match(schema, new RegExp(`'${table}'|alter table (?:public\\.)?${table} enable row level security`, 'i'), `${table} must be included in RLS setup`);
  }
  assert.match(schema, /revoke all on function login_start\(text\),login_ok\(text\) from public,anon,authenticated/i);
});

test('edge functions enforce server-side authorization, input limits, and throttling', () => {
  assert.match(login, /auth\.signInWithPassword/);
  assert.match(login, /consume_edge_rate_limit/);
  assert.match(login, /record_security_event/);
  assert.match(login, /request\.text\(\)/);
  assert.match(login, /8192/);
  assert.match(login, /login_start/);
  assert.match(account, /auth\.getUser\(token\)/);
  assert.match(account, /profile\.role !== "developer"/);
  assert.match(account, /consume_edge_rate_limit/);
  assert.match(account, /account-ip:/);
  assert.match(account, /account-user:/);
  assert.match(account, /request\.text\(\)/);
  assert.match(account, /8192/);
  assert.match(config, /\[functions\.auth-login\][\s\S]*?verify_jwt = false/);
  assert.match(config, /\[functions\.manage-account\][\s\S]*?verify_jwt = false/);
});

test('security migration adds server-side validation and service-only logging', () => {
  assert.match(hardening, /create table if not exists public\.edge_rate_limits/i);
  assert.match(hardening, /create table if not exists public\.security_events/i);
  assert.match(hardening, /revoke all on public\.edge_rate_limits, public\.security_events from public, anon, authenticated/i);
  assert.match(hardening, /grant execute on function public\.consume_edge_rate_limit\(text, integer, integer\) to service_role/i);
  assert.match(hardening, /students_validation_check[\s\S]*?not valid/i);
  assert.match(hardening, /attendance_validation_check[\s\S]*?not valid/i);
  assert.ok(hardening.includes("url ~ '^https://(drive|docs)\\.google\\.com/'"));
});

