import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function jwtRole(token) {
  try {
    const payload = String(token || "").split(".")[1];
    if (!payload) return "";
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).role || "";
  } catch {
    return "";
  }
}

export const isSupabaseAdminConfigured = Boolean(
  supabaseUrl && serviceRoleKey && jwtRole(serviceRoleKey) === "service_role",
);
export const supabaseAdmin = isSupabaseAdminConfigured
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;
