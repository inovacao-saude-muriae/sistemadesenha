import { createClient } from "@supabase/supabase-js";

const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

// Cliente padrão — usado para auth e operações gerais
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

// Cliente dedicado ao Realtime — sem desabilitar persistSession,
// para que o WebSocket consiga se autenticar corretamente no browser.
// Usado exclusivamente pelo monitor para receber eventos em tempo real.
let _realtimeClient = null;
export function getRealtimeClient() {
  if (!isSupabaseConfigured) return null;
  if (!_realtimeClient) {
    _realtimeClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
      realtime: {
        params: { eventsPerSecond: 10 },
      },
    });
  }
  return _realtimeClient;
}

export function createAuthClient() {
  if (!isSupabaseConfigured) return null;
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function callQueueAtomic(sectorId, callType) {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data, error } = await supabase.rpc("call_queue", {
    p_sector_id: sectorId,
    p_call_type: callType,
  });
  if (error) throw error;
  const result =
    typeof data === "object" && data !== null ? data : { number: data };
  return Number(
    result.number ??
      result.queue_number ??
      result.current_number ??
      result.next_number,
  );
}
