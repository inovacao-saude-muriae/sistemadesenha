import {
  isSupabaseAdminConfigured,
  supabaseAdmin,
} from "../../../lib/supabase-admin";
import { isSupabaseConfigured, supabase } from "../../../lib/supabase";

function getDb() {
  if (isSupabaseAdminConfigured && supabaseAdmin) return supabaseAdmin;
  if (isSupabaseConfigured && supabase) return supabase;
  return null;
}

export async function GET(request) {
  const days = Math.min(
    90,
    Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 30),
  );

  const db = getDb();
  if (!db) {
    return Response.json(
      { error: "Banco de dados não configurado." },
      { status: 503 },
    );
  }

  try {
    const since = new Date(
      Date.now() - days * 24 * 60 * 60 * 1000,
    ).toISOString();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIso = today.toISOString();

    // Buscar todos os dados necessários em paralelo
    const [allCalls, recentCalls] = await Promise.all([
      db
        .from("queue_calls")
        .select("sector_id, type, created_at")
        .gte("created_at", since),
      db
        .from("queue_calls")
        .select("sector_id, number_str, type, created_at")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

    if (allCalls.error) throw allCalls.error;
    if (recentCalls.error) throw recentCalls.error;

    const calls = allCalls.data || [];

    // Calcular sumário
    const total = calls.length;
    const todayCount = calls.filter((c) => c.created_at >= todayIso).length;

    // Agrupar por setor
    const sectorMap = {};
    for (const c of calls) {
      sectorMap[c.sector_id] = (sectorMap[c.sector_id] || 0) + 1;
    }
    const bySector = Object.entries(sectorMap)
      .map(([sector, count]) => ({ sector, total: count }))
      .sort((a, b) => b.total - a.total);

    // Agrupar por tipo
    const typeMap = {};
    for (const c of calls) {
      typeMap[c.type] = (typeMap[c.type] || 0) + 1;
    }
    const byType = Object.entries(typeMap)
      .map(([type, count]) => ({ type, total: count }))
      .sort((a, b) => b.total - a.total);

    return Response.json({
      days,
      summary: { total, today: todayCount },
      bySector,
      byType,
      recent: recentCalls.data || [],
    });
  } catch (error) {
    return Response.json(
      { error: error.message || "Não foi possível carregar o histórico." },
      { status: 503 },
    );
  }
}
