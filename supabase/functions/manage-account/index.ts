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
  if (!url || !serviceRoleKey) return respond(500, { error: "Account service is not configured." });

  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return respond(401, { error: "Sign in as a teacher to create accounts." });

  const admin = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return respond(401, { error: "Your session is invalid or expired." });

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("role,active")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (profileError) return respond(500, { error: "Could not verify teacher access." });
  if (!profile || !["teacher", "developer"].includes(profile.role) || !profile.active) {
    return respond(403, { error: "Only an active teacher or developer can create accounts." });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return respond(400, { error: "Request body must be valid JSON." });
  }

  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const role = String(body.role || "");
  const studentId = String(body.student_id || "").trim();
  if (!name || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return respond(400, { error: "Enter a name and valid email address." });
  }
  const allowedRoles = profile.role === "developer" ? ["teacher", "member", "developer"] : ["teacher", "member"];
  if (!allowedRoles.includes(role)) return respond(403, { error: "Only a developer can create developer accounts." });

  if (role === "member") {
    if (!studentId) return respond(400, { error: "Select the student record to link." });
    const { data: student, error } = await admin
      .from("students")
      .select("id,user_id")
      .eq("id", studentId)
      .maybeSingle();
    if (error) return respond(500, { error: "Could not check the selected student." });
    if (!student) return respond(404, { error: "The selected student record was not found." });
    if (student.user_id) return respond(409, { error: "That student already has an account." });
  }

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

  return respond(201, {
    account: { id: invitedUser.id, full_name: name, role, active: true },
    student_id: role === "member" ? studentId : null,
  });
});