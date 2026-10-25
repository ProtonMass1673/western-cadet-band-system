import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond(405, { error: "Method not allowed." });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !serviceRoleKey || !anonKey) return respond(500, { error: "Sign-in service is not configured." });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return respond(400, { error: "Request body must be valid JSON." });
  }

  const identifier = String(body.identifier || "").trim();
  const password = String(body.password || "");
  if (!identifier || identifier.length > 254 || !password || password.length > 1024) {
    return respond(400, { error: "Enter your student ID or teacher email, and password." });
  }

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
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

  // Known IDs and email sign-ins share one counter, so changing the sign-in label
  // does not give an account another set of attempts.
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
