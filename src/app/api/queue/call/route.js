import { prisma } from "@/lib/prisma-client";
import { supabase } from "@/lib/supabase";

export async function POST(request) {
  try {
    const { sector, type, attendantId } = await request.json();
    const prefix = type === "preferencial" ? "P" : "N";

    // Incremente o contador da sequência no banco de dados
    const updatedSeq = await prisma.$queryRaw`
      UPDATE public.queue_sequences
      SET current_number = CASE WHEN current_number >= 999 THEN 1 ELSE current_number + 1 END,
          updated_at = NOW()
      WHERE sector_id = ${sector} AND call_type = ${type}
      RETURNING current_number;
    `;

    if (!updatedSeq || !updatedSeq[0]) {
      return Response.json({ error: "Sequência não encontrada." }, { status: 404 });
    }

    const nextNumber = Number(updatedSeq[0].current_number);
    const numberStr = `${prefix}${String(nextNumber).padStart(3, "0")}`;

    // Registra no histórico de chamadas
    const newCall = await prisma.queue_calls.create({
      data: {
        sector_id: sector,
        number_int: nextNumber,
        number_str: numberStr,
        type,
        called_by: attendantId || null,
      },
    });

    // Avisa o Monitor via Supabase Realtime
    if (supabase) {
      await supabase.channel(`realtime-monitor-${sector}`).send({
        type: "broadcast",
        event: "new_call",
        payload: newCall,
      });
    }

    return Response.json({ number: nextNumber, numberStr });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}