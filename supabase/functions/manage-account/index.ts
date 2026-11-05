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

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return respond(405, { error: "Method not allowed." });
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return respond(415, { error: "Content-Type must be application/json." });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceRoleKey) return respond(500, { error: "Account service is not configured." });

  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const ipHash = await fingerprint(request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || "unknown");
  const { data: allowedByIp, error: ipRateError } = await admin.rpc("consume_edge_rate_limit", {
    p_key: `account-ip:${ipHash}`,
    p_limit: 60,
    p_window_seconds: 900,
  });
  if (ipRateError) return respond(500, { error: "Account service is not configured correctly." });
  if (!allowedByIp) {
    await admin.rpc("record_security_event", {
      p_event_type: "account_action_throttled",
      p_ip_fingerprint: ipHash,
    });
    return respond(429, { error: "Too many account requests. Try again later." });
  }
  if (!token) {
    await admin.rpc("record_security_event", { p_event_type: "account_denied", p_ip_fingerprint: ipHash });
    return respond(401, { error: "Sign in as a developer to manage accounts." });
  }

  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) {
    await admin.rpc("record_security_event", { p_event_type: "account_denied", p_ip_fingerprint: ipHash });
    return respond(401, { error: "Your session is invalid or expired." });
  }

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role,active")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError) return respond(500, { error: "Could not verify developer access." });
  if (!profile || profile.role !== "developer" || !profile.active) {
    await admin.rpc("record_security_event", {
      p_event_type: "account_denied",
      p_user_id: authData.user.id,
      p_ip_fingerprint: ipHash,
    });
    return respond(403, { error: "Only an active developer can manage accounts." });
  }

  const { data: allowedByUser, error: rateError } = await admin.rpc("consume_edge_rate_limit", {
    p_key: `account-user:${authData.user.id}`,
    p_limit: 30,
    p_window_seconds: 3600,
  });
  if (rateError) return respond(500, { error: "Account service is not configured correctly." });
  if (!allowedByUser) {
    await admin.rpc("record_security_event", {
      p_event_type: "account_action_throttled",
      p_user_id: authData.user.id,
      p_ip_fingerprint: ipHash,
    });
    return respond(429, { error: "Too many account changes. Try again later." });
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

  const action = String(body.action || "invite");

  if (action === "delete") {
    const userId = String(body.user_id || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) return respond(400, { error: "Select a valid account." });
    if (userId === authData.user.id) return respond(409, { error: "You cannot delete your own signed-in account." });

    const { data: target, error: targetError } = await admin
      .from("profiles")
      .select("id,full_name,email,role,active")
      .eq("id", userId)
      .maybeSingle();
    if (targetError) return respond(500, { error: "Could not find the account." });
    if (!target) return respond(404, { error: "The account was not found." });
    if (target.role === "developer" && target.active) {
      const { count, error: countError } = await admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "developer")
        .eq("active", true);
      if (countError) return respond(500, { error: "Could not verify the remaining developer accounts." });
      if ((count || 0) <= 1) return respond(409, { error: "You cannot delete the last active developer account." });
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) return respond(400, { error: deleteError.message || "Could not delete the account." });
    await admin.rpc("record_security_event", {
      p_event_type: "account_action",
      p_user_id: authData.user.id,
      p_ip_fingerprint: ipHash,
      p_identifier_fingerprint: await fingerprint(target.email || target.id),
    });
    return respond(200, { deleted: { id: target.id, full_name: target.full_name, email: target.email, role: target.role } });
  }

  if (action !== "invite") return respond(400, { error: "Choose invite or delete." });

  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const role = String(body.role || "");
  const studentId = String(body.student_id || "").trim();
  if (!name || name.length > 120 || /[\u0000-\u001f\u007f]/.test(name) || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return respond(400, { error: "Enter a name and valid email address." });
  }
  const allowedRoles = ["teacher", "member", "developer"];
  if (!allowedRoles.includes(role)) return respond(400, { error: "Choose a valid account role." });

  if (role === "member") {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(studentId)) return respond(400, { error: "Select a valid student record." });
    const { data: student, error } = await admin
      .from("students")
      .select("id,user_id")
      .eq("id", studentId)
      .maybeSingle();
    if (error) return respond(500, { error: "Could not check the selected student." });
    if (!student) return respond(404, { error: "The selected student record was not found." });
    if (student.user_id) return respond(409, { error: "That student already has an account." });
  }

  if (role !== "member" && studentId) return respond(400, { error: "A student record can only be linked to a student account." });

  const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { full_name: name, role },
  });
  if (inviteError || !inviteData.user) {
    return respond(400, { error: inviteError?.message || "Could not send the invitation." });
  }

  const invitedUser = inviteData.user;
  const { error: insertError } = await admin.from("profiles").insert({
    id: invitedUser.id,
    full_name: name,
    email,
    role,
    active: true,
  });
  if (insertError) {
    await admin.auth.admin.deleteUser(invitedUser.id);
    return respond(500, { error: "Could not create the account profile." });
  }

  if (role === "member") {
    const { data: linked, error: linkError } = await admin
      .from("students")
      .update({ user_id: invitedUser.id })
      .eq("id", studentId)
      .is("user_id", null)
      .select("id")
      .maybeSingle();
    if (linkError || !linked) {
      await admin.auth.admin.deleteUser(invitedUser.id);
      return respond(linkError ? 500 : 409, {
        error: linkError ? "Could not link the student record." : "That student already has an account.",
      });
    }
  }

  await admin.rpc("record_security_event", {
    p_event_type: "account_action",
    p_user_id: authData.user.id,
    p_ip_fingerprint: ipHash,
    p_identifier_fingerprint: await fingerprint(email),
  });

  return respond(201, {
    account: { id: invitedUser.id, full_name: name, role, active: true },
    student_id: role === "member" ? studentId : null,
  });
});

