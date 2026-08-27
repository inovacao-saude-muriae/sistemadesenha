import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabase } from "../../../../lib/supabase";

export async function POST(request) {
  try {
    const body = await request.json();
    const { sector, type, attendantId } = body;

    if (!sector) {
      return NextResponse.json({ error: "Setor não informado." }, { status: 400 });
    }

    const typeFormatted =
      type === "preferential" || type === "preferencial"
        ? "preferential"
        : "normal";

    if (!isSupabaseConfigured || !supabase) {
      return NextResponse.json(
        { error: "Supabase não configurado." },
        { status: 500 }
      );
    }

    // 1. Busca a sequência atual do setor
    const { data: seqData, error: seqError } = await supabase
      .from("queue_sequences")
      .select("*")
      .eq("sector_id", sector)
      .single();

    let currentNum = 0;
    if (seqData) {
      currentNum =
        typeFormatted === "preferential"
          ? seqData.priority_current || 0
          : seqData.normal_current || 0;
    }

    const nextNum = currentNum >= 1000 ? 1 : currentNum + 1;
    const fieldToUpdate =
      typeFormatted === "preferential" ? "priority_current" : "normal_current";

    // 2. Atualiza a sequência no banco de dados
    if (seqData) {
      await supabase
        .from("queue_sequences")
        .update({ [fieldToUpdate]: nextNum, updated_at: new Date().toISOString() })
        .eq("sector_id", sector);
    } else {
      await supabase.from("queue_sequences").insert({
        sector_id: sector,
        normal_current: typeFormatted === "normal" ? nextNum : 0,
        priority_current: typeFormatted === "preferential" ? nextNum : 0,
      });
    }

    // 3. Registra a nova chamada (dispara o Realtime na TV)
    const { error: callError } = await supabase.from("queue_calls").insert({
      sector_id: sector,
      type: typeFormatted,
      number_int: nextNum,
      attendant_id: attendantId || null,
    });

    if (callError) {
      return NextResponse.json({ error: callError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, number: nextNum, type: typeFormatted });
  } catch (err) {
    return NextResponse.json({ error: "Erro interno no servidor." }, { status: 500 });
  }
}