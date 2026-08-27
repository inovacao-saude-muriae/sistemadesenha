import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Atenção: Variáveis de ambiente do Supabase não encontradas no arquivo .env');
}

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const supabase = isSupabaseConfigured ? createClient(supabaseUrl, supabaseAnonKey) : null;

export async function callQueueAtomic(sectorId, callType) {
  if (!isSupabaseConfigured || !supabase) return null;
  const { data, error } = await supabase.rpc('call_queue', { p_sector_id: sectorId, p_call_type: callType });
  if (error) throw error;
  const result = typeof data === 'object' && data !== null ? data : { number: data };
  return Number(result.number ?? result.queue_number ?? result.current_number ?? result.next_number);
}