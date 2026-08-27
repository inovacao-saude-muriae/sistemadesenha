import { prisma } from "../../../lib/prisma-client";

export async function GET(request) {
  const days = Math.min(
    90,
    Math.max(1, Number(new URL(request.url).searchParams.get("days")) || 30),
  );
  try {
    const [summary, bySector, byType, recent] = await Promise.all([
      prisma.$queryRaw`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS today FROM public.queue_calls WHERE created_at >= CURRENT_DATE - (${days} * INTERVAL '1 day')`,
      prisma.$queryRaw`SELECT sector_id AS sector, COUNT(*)::int AS total FROM public.queue_calls WHERE created_at >= CURRENT_DATE - (${days} * INTERVAL '1 day') GROUP BY sector_id ORDER BY total DESC`,
      prisma.$queryRaw`SELECT type, COUNT(*)::int AS total FROM public.queue_calls WHERE created_at >= CURRENT_DATE - (${days} * INTERVAL '1 day') GROUP BY type ORDER BY total DESC`,
      prisma.$queryRaw`SELECT sector_id AS sector, number_str, type, created_at FROM public.queue_calls ORDER BY created_at DESC LIMIT 10`,
    ]);
    return Response.json({
      days,
      summary: summary[0],
      bySector,
      byType,
      recent,
    });
  } catch (error) {
    return Response.json(
      { error: error.message || "Não foi possível carregar o histórico." },
      { status: 503 },
    );
  }
}
