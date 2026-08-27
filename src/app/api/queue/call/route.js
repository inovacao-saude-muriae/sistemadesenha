import { prisma } from "@/lib/prisma-client";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

const validSectors = ["farmacia", "recepcao"];
const validTypes = ["normal", "preferencial"];

export async function GET(request) {
  const sector = new URL(request.url).searchParams.get("sector");

  if (!validSectors.includes(sector)) {
    return Response.json({ error: "Serviço inválido." }, { status: 400 });
  }

  try {
    const [snapshot] = await prisma.$queryRaw`
      SELECT
        COALESCE((
          SELECT jsonb_agg(sequence_row) FROM (
            SELECT call_type, current_number
            FROM public.queue_sequences
            WHERE sector_id = ${sector}
          ) AS sequence_row
        ), '[]'::jsonb) AS sequences,
        COALESCE((
          SELECT jsonb_agg(call_row) FROM (
            SELECT number_int, type, created_at
            FROM public.queue_calls
            WHERE sector_id = ${sector}
            ORDER BY created_at DESC
            LIMIT 8
          ) AS call_row
        ), '[]'::jsonb) AS calls
    `;

    const sequences = snapshot?.sequences || [];
    const calls = snapshot?.calls || [];
    const current = { normalCurrent: 0, priorityCurrent: 0 };

    for (const sequence of sequences) {
      current[
        sequence.call_type === "preferencial"
          ? "priorityCurrent"
          : "normalCurrent"
      ] = Number(sequence.current_number);
    }

    return Response.json({
      ...current,
      history: calls.map((call) => ({
        number: call.number_int,
        type: call.type === "preferential" ? "preferencial" : "normal",
        time: new Intl.DateTimeFormat("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(call.created_at)),
      })),
    });
  } catch (error) {
    return Response.json(
      {
        error: `Falha ao consultar a sequência: ${
          error.message || "erro desconhecido"
        }`,
      },
      { status: 503 }
    );
  }
}

export async function POST(request) {
  try {
    if (!process.env.DATABASE_URL) {
      return Response.json(
        { error: "DATABASE_URL não foi configurada na Vercel." },
        { status: 503 }
      );
    }

    const { sector, type, attendantId = null } = await request.json();

    if (!validSectors.includes(sector) || !validTypes.includes(type)) {
      return Response.json(
        { error: "Serviço ou tipo de atendimento inválido." },
        { status: 400 }
      );
    }

    // Tenta chamar via RPC do Supabase se estiver configurado
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.rpc("call_next_queue", {
        p_sector_id: sector,
        p_type: type,
        p_attendant_id: attendantId,
      });

      if (!error && data && data.length > 0) {
        return Response.json({ number: Number(data[0].number_int) });
      }
    }

    // Fallback via Prisma com Query Raw Atômica
    const databaseType = type === "preferencial" ? "preferential" : "normal";
    const numberPrefix = type === "preferencial" ? "P" : "N";

    const result = await prisma.$queryRaw`
      WITH next_sequence AS (
        UPDATE public.queue_sequences
        SET current_number = CASE WHEN current_number >= 1000 THEN 1 ELSE current_number + 1 END,
            updated_at = now()
        WHERE sector_id = ${sector} AND call_type = ${type}
        RETURNING current_number
      ), inserted_call AS (
        INSERT INTO public.queue_calls (sector_id, number_str, number_int, type, called_by)
        SELECT 
          ${sector}, 
          ${numberPrefix} || LPAD(current_number::text, 3, '0'), 
          current_number, 
          ${databaseType}::public.queue_type, 
          ${attendantId || null}::uuid
        FROM next_sequence
        RETURNING number_int
      )
      SELECT number_int FROM inserted_call
    `;

    if (!result || !result[0]) {
      return Response.json(
        { error: "A sequência deste serviço ainda não foi configurada." },
        { status: 503 }
      );
    }

    return Response.json({ number: Number(result[0].number_int) });
  } catch (error) {
    return Response.json(
      {
        error: `Falha no banco ao chamar a senha: ${
          error.message || "erro desconhecido"
        }`,
      },
      { status: 503 }
    );
  }
}