import { NextResponse } from "next/server";
import { getQueueDb, resetSectorSequence } from "../../../../lib/queue-server";

export async function POST(request) {
  try {
    const { sector } = await request.json();
    if (!sector || !["farmacia", "recepcao"].includes(sector)) {
      return NextResponse.json({ error: "Setor inválido." }, { status: 400 });
    }

    const db = getQueueDb();
    if (!db) {
      return NextResponse.json({ success: true, localOnly: true });
    }

    await resetSectorSequence(db, sector);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Erro interno na rota /api/queue/reset:", err);
    return NextResponse.json(
      { error: err.message || "Não foi possível zerar a fila." },
      { status: 500 },
    );
  }
}
