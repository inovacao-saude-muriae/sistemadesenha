import { NextResponse } from "next/server";
import { isSupabaseConfigured, supabase } from "../../../../lib/supabase";

function formatNumberString(num, type) {
  const prefix = type === "preferencial" || type === "preferential" ? "P" : "N";
  return `${prefix}${String(num).padStart(3, "0")}`;
}

export async function POST(request) {
  try {
    const body = await request.json();
    const { sector, type, attendantId } = body;

    if (!sector) {
      return NextResponse.json({ error: "Setor não informado." }, { status: 400 });
    }

    // Normaliza para 'preferencial' e 'normal' exatamente como exigido pela constraint da tabela
    const dbCallType =
      type === "preferential" || type === "preferencial"
        ? "preferencial"
        : "normal";

    const dbTypeCalls =
      type === "preferential" || type === "preferencial"
        ? "preferential"
        : "normal";

    if (!isSupabaseConfigured || !supabase) {
      const nextNum = Math.floor(Math.random() * 100) + 1;
      return NextResponse.json({ success: true, number: nextNum, type: dbCallType });
    }

    // 1. Busca sequências existentes para o setor
    const { data: seqList, error: seqFetchError } = await supabase
      .from("queue_sequences")
      .select("*")
      .eq("sector_id", sector);

    if (seqFetchError) {
      console.error("Erro ao buscar queue_sequences:", seqFetchError.message);
    }

    const seqData = seqList && seqList.length > 0 ? seqList[0] : null;

    let currentNum = 0;
    if (seqData) {
      currentNum =
        dbCallType === "preferencial"
          ? seqData.priority_current || 0
          : seqData.normal_current || 0;
    }

    const nextNum = currentNum >= 1000 ? 1 : currentNum + 1;
    const numberStr = formatNumberString(nextNum, dbCallType);
    const fieldToUpdate =
      dbCallType === "preferencial" ? "priority_current" : "normal_current";

    // 2. Atualiza ou cria o registro em queue_sequences enviando dbCallType correto ('preferencial' / 'normal')
    if (seqData) {
      const { error: updateError } = await supabase
        .from("queue_sequences")
        .update({
          [fieldToUpdate]: nextNum,
          call_type: dbCallType,
          updated_at: new Date().toISOString(),
        })
        .eq("sector_id", sector);

      if (updateError) {
        console.error("Erro ao atualizar queue_sequences:", updateError.message);
      }
    } else {
      const { error: insertSeqError } = await supabase
        .from("queue_sequences")
        .insert({
          sector_id: sector,
          call_type: dbCallType,
          normal_current: dbCallType === "normal" ? nextNum : 0,
          priority_current: dbCallType === "preferencial" ? nextNum : 0,
        });

      if (insertSeqError) {
        console.error("Erro ao criar fila em queue_sequences:", insertSeqError.message);
      }
    }

    // 3. Registra em queue_calls
    const { error: callError } = await supabase.from("queue_calls").insert({
      sector_id: sector,
      type: dbTypeCalls,
      call_type: dbCallType,
      number_int: nextNum,
      number_str: numberStr,
      attendant_id: attendantId || null,
    });

    if (callError) {
      console.error("Erro ao inserir em queue_calls:", callError.message);
      return NextResponse.json({ error: callError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      number: nextNum,
      numberStr,
      type: dbCallType,
    });
  } catch (err) {
    console.error("Erro interno na rota /api/queue/call:", err);
    return NextResponse.json({ error: "Erro interno no servidor." }, { status: 500 });
  }
}