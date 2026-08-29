import { isSupabaseAdminConfigured, supabaseAdmin } from "../../../lib/supabase-admin";
import { isSupabaseConfigured, supabase } from "../../../lib/supabase";

function getDb() {
  if (isSupabaseAdminConfigured && supabaseAdmin) return supabaseAdmin;
  if (isSupabaseConfigured && supabase) return supabase;
  return null;
}

// Resposta vazia estruturada quando não há banco configurado
function emptyResponse(days) {
  return Response.json({
    days,
    summary: { total: 0, today: 0, preferencial: 0, normal: 0 },
    bySector: [],
    byType: [],
    recent: [],
    recentBySector: {},
    noDb: true,
  });
}

export async function GET(request) {
  const url    = new URL(request.url);
  const days   = Math.min(90, Math.max(1, Number(url.searchParams.get("days")) || 30));
  const sector = url.searchParams.get("sector") || null;   // "farmacia" | "recepcao" | null
  const from   = url.searchParams.get("from")   || null;   // "YYYY-MM-DD"
  const to     = url.searchParams.get("to")     || null;   // "YYYY-MM-DD"

  const db = getDb();
  // Sem banco: retorna estrutura vazia em vez de 503
  if (!db) return emptyResponse(days);

  try {
    // Janela de datas: prioriza from/to explícitos, depois usa days
    const sinceDate = from
      ? new Date(`${from}T00:00:00`)
      : new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const untilDate = to ? new Date(`${to}T23:59:59`) : null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIso = today.toISOString();

    // ── consulta principal ──
    let query = db
      .from("queue_calls")
      .select("sector_id, type, created_at")
      .gte("created_at", sinceDate.toISOString());
    if (untilDate) query = query.lte("created_at", untilDate.toISOString());
    if (sector)    query = query.eq("sector_id", sector);

    // ── recentes (para a lista) ──
    let recentQuery = db
      .from("queue_calls")
      .select("sector_id, number_str, type, created_at")
      .gte("created_at", sinceDate.toISOString())
      .order("created_at", { ascending: false })
      .limit(200);
    if (untilDate)  recentQuery = recentQuery.lte("created_at", untilDate.toISOString());
    if (sector)     recentQuery = recentQuery.eq("sector_id", sector);

    const [allCalls, recentCalls] = await Promise.all([query, recentQuery]);

    if (allCalls.error)  throw allCalls.error;
    if (recentCalls.error) throw recentCalls.error;

    const calls  = allCalls.data  || [];
    const recent = recentCalls.data || [];

    // totais
    const total        = calls.length;
    const todayCount   = calls.filter((c) => c.created_at >= todayIso).length;
    const prefCount    = calls.filter((c) => ["preferencial","preferential"].includes(c.type)).length;
    const normalCount  = total - prefCount;

    // por setor
    const sectorMap = {};
    for (const c of calls) {
      sectorMap[c.sector_id] = (sectorMap[c.sector_id] || 0) + 1;
    }
    const bySector = Object.entries(sectorMap)
      .map(([s, count]) => ({ sector: s, total: count }))
      .sort((a, b) => b.total - a.total);

    // por tipo
    const typeMap = {};
    for (const c of calls) {
      typeMap[c.type] = (typeMap[c.type] || 0) + 1;
    }
    const byType = Object.entries(typeMap)
      .map(([type, count]) => ({ type, total: count }))
      .sort((a, b) => b.total - a.total);

    // recentes por setor (máx 50 por setor)
    const recentBySector = {};
    for (const item of recent) {
      const sid = item.sector_id || "desconhecido";
      if (!recentBySector[sid]) recentBySector[sid] = [];
      if (recentBySector[sid].length < 50) recentBySector[sid].push(item);
    }

    return Response.json({
      days,
      summary: { total, today: todayCount, preferencial: prefCount, normal: normalCount },
      bySector,
      byType,
      recent,
      recentBySector,
    });
  } catch (error) {
    console.error("Erro em /api/stats:", error.message);
    // Retorna estrutura vazia em vez de 503 para não travar o admin
    return emptyResponse(days);
  }
}
