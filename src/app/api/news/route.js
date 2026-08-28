import { prisma } from "@/lib/prisma-client";

const imagePattern = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/;

// GET: Busca as notícias ativas
export async function GET() {
  if (!process.env.DATABASE_URL) {
    return Response.json(
      { error: "DATABASE_URL não configurada." },
      { status: 503 }
    );
  }
  try {
    const data = await prisma.$queryRaw`
      SELECT id, title, image_url 
      FROM public.news 
      WHERE active = true 
      ORDER BY created_at DESC 
      LIMIT 8
    `;
    
    return Response.json({
      news: data.map((item) => ({
        id: item.id.toString(),
        title: item.title,
        image: item.image_url,
      })),
    });
  } catch (error) {
    console.error("Erro ao carregar notícias:", error);
    return Response.json({ news: [] });
  }
}

// POST: Adiciona nova notícia
export async function POST(request) {
  if (!process.env.DATABASE_URL) {
    return Response.json(
      { error: "DATABASE_URL não configurada." },
      { status: 503 }
    );
  }
  try {
    const { title, image } = await request.json();
    const match = String(image || "").match(imagePattern);

    if (!title?.trim() || !match) {
      return Response.json(
        { error: "Informe um título e uma imagem válida." },
        { status: 400 }
      );
    }

    const [, contentType, encodedImage] = match;
    if (encodedImage.length > 7_000_000) {
      return Response.json(
        { error: "A imagem deve ter no máximo 5 MB." },
        { status: 400 }
      );
    }

    const imageData = `data:${contentType};base64,${encodedImage}`;
    const data = await prisma.$queryRaw`
      INSERT INTO public.news (title, image_url) 
      VALUES (${title.trim()}, ${imageData}) 
      RETURNING id, title, image_url
    `;

    const news = data[0];
    return Response.json({
      news: {
        id: news.id.toString(),
        title: news.title,
        image: news.image_url,
      },
    });
  } catch (error) {
    return Response.json(
      { error: error.message || "Erro ao salvar notícia." },
      { status: 500 }
    );
  }
}

// DELETE: Remove uma notícia por ID
export async function DELETE(request) {
  if (!process.env.DATABASE_URL) {
    return Response.json(
      { error: "DATABASE_URL não configurada." },
      { status: 503 }
    );
  }
  try {
    const id = Number(new URL(request.url).searchParams.get("id"));

    if (!Number.isInteger(id) || id < 1) {
      return Response.json({ error: "ID inválido." }, { status: 400 });
    }

    await prisma.$executeRaw`
      UPDATE public.news 
      SET active = false 
      WHERE id = ${id}
    `;

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error.message || "Erro ao excluir notícia." },
      { status: 500 }
    );
  }
}