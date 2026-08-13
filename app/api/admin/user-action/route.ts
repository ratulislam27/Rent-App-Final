import { getSupabaseAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const accessToken = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!accessToken) return Response.json({ error: "Authentication required." }, { status: 401 });
    const admin = getSupabaseAdminClient();
    const { data: authData, error: authError } = await admin.auth.getUser(accessToken);
    if (authError || !authData.user) return Response.json({ error: "Invalid administrator session." }, { status: 401 });
    const { data: actor } = await admin.from("profiles").select("id,is_admin,is_active").eq("id", authData.user.id).single();
    if (!actor?.is_admin || !actor.is_active) return Response.json({ error: "Administrator access required." }, { status: 403 });

    const body = await request.json() as { userId?: string; action?: "deactivate" | "reactivate" | "reset-password"; temporaryPassword?: string };
    if (!body.userId || !body.action) return Response.json({ error: "Invalid request." }, { status: 400 });
    const { data: target } = await admin.from("profiles").select("id,is_admin,is_active").eq("id", body.userId).single();
    if (!target || target.is_admin) return Response.json({ error: "The platform administrator cannot be changed here." }, { status: 400 });

    if (body.action === "reset-password") {
      if (!body.temporaryPassword || body.temporaryPassword.length < 8) return Response.json({ error: "Temporary password must have at least 8 characters." }, { status: 400 });
      const result = await admin.auth.admin.updateUserById(body.userId, { password: body.temporaryPassword });
      if (result.error) throw result.error;
      const profileUpdate = await admin.from("profiles").update({ force_password_change: true }).eq("id", body.userId);
      if (profileUpdate.error) throw profileUpdate.error;
    } else if (body.action === "deactivate") {
      const result = await admin.auth.admin.updateUserById(body.userId, { ban_duration: "876000h" });
      if (result.error) throw result.error;
      const profileUpdate = await admin.from("profiles").update({ is_active: false }).eq("id", body.userId);
      if (profileUpdate.error) throw profileUpdate.error;
    } else {
      const result = await admin.auth.admin.updateUserById(body.userId, { ban_duration: "none" });
      if (result.error) throw result.error;
      const profileUpdate = await admin.from("profiles").update({ is_active: true }).eq("id", body.userId);
      if (profileUpdate.error) throw profileUpdate.error;
    }

    await admin.from("admin_audit_logs").insert({ admin_user_id: actor.id, target_user_id: body.userId, action: body.action, details: { source: "admin-panel" } });
    return Response.json({ ok: true });
  } catch (reason) {
    return Response.json({ error: reason instanceof Error ? reason.message : "Administrator action failed." }, { status: 500 });
  }
}
