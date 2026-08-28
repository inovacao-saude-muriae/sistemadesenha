import { NextResponse } from "next/server";
import {
  formatNumberString,
  getQueueDbClients,
  insertQueueCall,
  isInvalidApiKeyError,
  nextQueueNumberForSector,
  normalizeCallType,
} from "../../../../lib/queue-server";

export async function POST(request) {
  try {
    const body = await request.json();
    const { sector, type, attendantId } = body;

    if (!sector || !["farmacia", "recepcao"].includes(sector)) {
      return NextResponse.json(
        { error: "Setor não informado." },
        { status: 400 },
      );
    }

    const { sequenceType, callType } = normalizeCallType(type);
    const clients = getQueueDbClients();

    if (!clients.length) {
      return NextResponse.json(
        { error: "Supabase não está configurado.", useLocal: true },
        { status: 503 },
      );
    }

    let lastError = null;
    for (const db of clients) {
      try {
        const nextNum = await nextQueueNumberForSector(db, sector, sequenceType);
        const numberStr = formatNumberString(nextNum, sequenceType);
        await insertQueueCall(db, {
          sector,
          nextNum,
          numberStr,
          sequenceType,
          callType,
          attendantId,
        });
        return NextResponse.json({
          success: true,
          number: nextNum,
          numberStr,
          type: sequenceType,
        });
      } catch (error) {
        lastError = error;
        if (!isInvalidApiKeyError(error)) break;
      }
    }

    if (isInvalidApiKeyError(lastError)) {
      return NextResponse.json(
        {
          error: "Chave do Supabase inválida. Usando sequência local.",
          useLocal: true,
        },
        { status: 503 },
      );
    }

    console.error("Erro interno na rota /api/queue/call:", lastError);
    return NextResponse.json(
      { error: lastError?.message || "Erro interno no servidor." },
      { status: 500 },
    );
  } catch (err) {
    console.error("Erro interno na rota /api/queue/call:", err);
    return NextResponse.json(
      { error: err.message || "Erro interno no servidor." },
      { status: 500 },
    );
  }
}
