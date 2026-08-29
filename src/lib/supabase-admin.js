import { createClient } from "@supabase/supabase-js";

const supabaseUrl    = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Aceita JWT clássico (eyJ...) E novo formato sb_secret_*
function isValidServiceKey(key) {
  if (!key) return false;
  // Novo formato Supabase 2025
  if (/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(key)) return true;
  // JWT clássico — só verifica estrutura, não o payload
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return true;
  return false;
}

export const isSupabaseAdminConfigured = Boolean(
  supabaseUrl && isValidServiceKey(serviceRoleKey)
);

export const supabaseAdmin = isSupabaseAdminConfigured
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;
