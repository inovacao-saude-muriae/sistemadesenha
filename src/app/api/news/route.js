import { prisma } from "../../../lib/prisma-client";

const imagePattern = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/;

export async function GET() {
  try {
    const data =
      await prisma.$queryRaw`SELECT id, title, image_url FROM public.news WHERE active = true ORDER BY created_at DESC LIMIT 8`;
    return Response.json({
      news: data.map((item) => ({
        id: item.id.toString(),
        title: item.title,
        image: item.image_url,
      })),
    });
  } catch (error) {
    return Response.json(
      { error: error.message || "Não foi possível carregar as notícias." },
      { status: 503 },
    );
  }
}

export async function POST(request) {
  try {
    const { title, image } = await request.json();
    const match = String(image || "").match(imagePattern);
    if (!title?.trim() || !match)
      return Response.json(
        { error: "Informe título e uma imagem válida." },
        { status: 400 },
      );
    const [, contentType, encodedImage] = match;
    if (encodedImage.length > 7_000_000)
      return Response.json(
        { error: "A imagem deve ter no máximo 5 MB." },
        { status: 400 },
      );
    const imageData = `data:${contentType};base64,${encodedImage}`;
    const data =
      await prisma.$queryRaw`INSERT INTO public.news (title, image_url) VALUES (${title.trim()}, ${imageData}) RETURNING id, title, image_url`;
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
      { error: error.message || "Não foi possível armazenar a notícia." },
      { status: 400 },
    );
  }
}

export async function DELETE(request) {
  try {
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id < 1)
      return Response.json({ error: "Notícia inválida." }, { status: 400 });
    await prisma.$executeRaw`UPDATE public.news SET active = false WHERE id = ${id}`;
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json(
      { error: error.message || "Não foi possível excluir a notícia." },
      { status: 400 },
    );
  }
}
