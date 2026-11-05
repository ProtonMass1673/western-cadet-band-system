import { createClient } from "npm:@supabase/supabase-js@2.118.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "https://protonmass1673.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Vary": "Origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

const fingerprint = async (value: string) => {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const requestIp = (request: Request) =>
  request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "unknown";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond(405, { error: "Method not allowed." });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return respond(415, { error: "Content-Type must be application/json." });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !serviceRoleKey || !anonKey) return respond(500, { error: "Sign-in service is not configured." });

  const ipHash = await fingerprint(requestIp(request));
  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: allowedByIp, error: rateError } = await admin.rpc("consume_edge_rate_limit", {
    p_key: `login-ip:${ipHash}`,
    p_limit: 60,
    p_window_seconds: 900,
  });
  if (rateError) return respond(500, { error: "Sign-in service is not configured correctly." });
  if (!allowedByIp) {
    await admin.rpc("record_security_event", {
      p_event_type: "login_throttled",
      p_ip_fingerprint: ipHash,
    });
    return respond(429, { error: "Too many sign-in requests. Try again later." });
  }

  const contentLength = Number(request.headers.get("content-length") || "0");
  if (contentLength > 8192) return respond(413, { error: "Request is too large." });
  let body: Record<string, unknown>;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 8192) return respond(413, { error: "Request is too large." });
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return respond(400, { error: "Request body must be a JSON object." });
    body = parsed as Record<string, unknown>;
  } catch {
    return respond(400, { error: "Request body must be valid JSON." });
  }

  const identifier = String(body.identifier || "").trim();
  const password = String(body.password || "");
  if (!identifier || identifier.length > 254 || !password || password.length > 1024) {
    return respond(400, { error: "Enter your student ID or teacher email, and password." });
  }

  const normalized = identifier.toLowerCase();
  let profile: { id: string; full_name: string; email: string | null; role: string; active: boolean } | null = null;

  if (normalized.includes("@")) {
    const { data } = await admin.from("profiles")
      .select("id,full_name,email,role,active")
      .eq("email", normalized)
      .maybeSingle();
    profile = data;
  } else {
    const { data: student } = await admin.from("students")
      .select("user_id")
      .eq("enrolment_no", identifier.toUpperCase())
      .maybeSingle();
    if (student?.user_id) {
      const { data } = await admin.from("profiles")
        .select("id,full_name,email,role,active")
        .eq("id", student.user_id)
        .maybeSingle();
      profile = data;
    }
  }

  const counterId = profile?.email?.toLowerCase() || normalized;
  const { data: gate, error: gateError } = await admin.rpc("login_start", { p_identifier: counterId });
  if (gateError) return respond(500, { error: "Could not check sign-in attempts." });
  if (gate?.locked) return respond(429, { locked: true, until: gate.until, left: 0 });

  const allowed = profile && profile.active && profile.email &&
    ["teacher", "member", "developer"].includes(profile.role);
  let session = null;
  if (allowed) {
    const auth = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await auth.auth.signInWithPassword({ email: profile.email, password });
    if (!error) session = data.session;
  }

  if (!allowed || !session) {
    await admin.rpc("record_security_event", {
      p_event_type: "login_failed",
      p_ip_fingerprint: ipHash,
      p_identifier_fingerprint: await fingerprint(counterId),
    });
    const locked = gate?.left === 0;
    return respond(locked ? 429 : 401, {
      error: "Incorrect student ID/email or password.",
      locked,
      until: locked ? gate?.until || null : null,
      left: gate?.left ?? 0,
    });
  }

  const { error: resetError } = await admin.rpc("login_ok", { p_identifier: counterId });
  if (resetError) return respond(500, { error: "Could not reset the sign-in counter." });
  return respond(200, {
    session,
    user: { id: profile.id, full_name: profile.full_name, role: profile.role },
  });
});

