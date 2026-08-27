import { prisma } from "../../../../lib/prisma-client";

const validSectors = ["farmacia", "recepcao"];
const validTypes = ["normal", "preferencial"];

export async function POST(request) {
  try {
    const { sector, type, attendantId = null } = await request.json();
    if (!validSectors.includes(sector) || !validTypes.includes(type)) {
      return Response.json(
        { error: "Serviço ou tipo de atendimento inválido." },
        { status: 400 },
      );
    }
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
      { error: error.message || "Não foi possível chamar a senha." },
      { status: 503 },
    );
  }
}
