import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Aceita tanto o formato JWT clássico (eyJ...) quanto o novo formato
// sb_secret_... introduzido pelo Supabase em 2025
function isValidServiceKey(key) {
  if (!key) return false;
  // Novo formato: sb_secret_<base62>
  if (/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(key)) return true;
  // Formato JWT clássico: verifica role=service_role no payload
  try {
    const payload = String(key).split(".")[1];
    if (!payload) return false;
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return decoded.role === "service_role";
  } catch {
    return false;
  }
}

export const isSupabaseAdminConfigured = Boolean(
  supabaseUrl && isValidServiceKey(serviceRoleKey),
);

export const supabaseAdmin = isSupabaseAdminConfigured
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;
