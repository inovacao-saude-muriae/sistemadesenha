import { NextResponse } from "next/server";
import { getQueueDb, resetSectorSequence } from "../../../../lib/queue-server";

const VALID_SECTORS = ["farmacia", "recepcao"];

export async function POST(request) {
  try {
    const { sector } = await request.json();

    if (!sector) {
      return NextResponse.json({ error: "Setor não informado." }, { status: 400 });
    }

    // "all" reseta todos os setores de uma vez
    const sectorsToReset =
      sector === "all" ? VALID_SECTORS : [sector];

    if (!sectorsToReset.every((s) => VALID_SECTORS.includes(s))) {
      return NextResponse.json({ error: "Setor inválido." }, { status: 400 });
    }

    const db = getQueueDb();
    if (!db) {
      return NextResponse.json({ success: true, localOnly: true });
    }

    await Promise.all(sectorsToReset.map((s) => resetSectorSequence(db, s)));
    return NextResponse.json({ success: true, sectors: sectorsToReset });
  } catch (err) {
    console.error("Erro interno na rota /api/queue/reset:", err);
    return NextResponse.json(
      { error: err.message || "Não foi possível zerar a fila." },
      { status: 500 },
    );
  }
}
