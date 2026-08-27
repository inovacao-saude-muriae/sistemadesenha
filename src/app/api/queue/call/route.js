import { prisma } from "../../../../lib/prisma-client";

const validSectors = ["farmacia", "recepcao"];
const validTypes = ["normal", "preferencial"];

export async function POST(request) {
  try {
    if (!process.env.DATABASE_URL) {
      return Response.json(
        { error: "DATABASE_URL não foi configurada na Vercel." },
        { status: 503 },
      );
    }
    const { sector, type, attendantId = null } = await request.json();
    if (!validSectors.includes(sector) || !validTypes.includes(type)) {
      return Response.json(
        { error: "Serviço ou tipo de atendimento inválido." },
        { status: 400 },
      );
    }
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS public.queue_sequences (
        sector_id text NOT NULL,
        call_type text NOT NULL CHECK (call_type IN ('normal', 'preferencial')),
        current_number integer NOT NULL DEFAULT 0 CHECK (current_number BETWEEN 0 AND 1000),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (sector_id, call_type)
      )
    `;
    await prisma.$executeRaw`
      INSERT INTO public.queue_sequences (sector_id, call_type)
      SELECT id, call_type FROM public.sectors
      CROSS JOIN (VALUES ('normal'), ('preferencial')) AS types(call_type)
      ON CONFLICT (sector_id, call_type) DO NOTHING
    `;
    const rows = await prisma.$queryRaw`
      UPDATE public.queue_sequences
      SET current_number = CASE WHEN current_number >= 1000 THEN 1 ELSE current_number + 1 END,
          updated_at = now()
      WHERE sector_id = ${sector} AND call_type = ${type}
      RETURNING current_number
    `;
    if (!rows[0])
      return Response.json(
        { error: "A sequência deste serviço ainda não foi configurada." },
        { status: 503 },
      );
    const number = Number(rows[0].current_number);
    const databaseType = type === "preferencial" ? "preferential" : "normal";
    const numberString = `${type === "preferencial" ? "P" : "N"}${String(number).padStart(3, "0")}`;
    await prisma.$executeRaw`
      INSERT INTO public.queue_calls (sector_id, number_str, number_int, type, called_by)
      VALUES (${sector}, ${numberString}, ${number}, ${databaseType}::public.queue_type, ${attendantId || null})
    `;
    return Response.json({ number });
  } catch (error) {
    return Response.json(
      {
        error: `Falha no banco ao chamar a senha: ${error.message || "erro desconhecido"}`,
      },
      { status: 503 },
    );
  }
}
