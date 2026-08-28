import {
  isSupabaseAdminConfigured,
  supabaseAdmin,
} from "@/lib/supabase-admin";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

const imagePattern = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/;

// Retorna o melhor cliente disponível (admin > anon > null)
function getDb() {
  if (isSupabaseAdminConfigured && supabaseAdmin) return supabaseAdmin;
  if (isSupabaseConfigured && supabase) return supabase;
  return null;
}

// GET: Busca as notícias ativas
export async function GET() {
  const db = getDb();
  if (!db) {
    return Response.json({ news: [] });
  }

  try {
    const { data, error } = await db
      .from("news")
      .select("id, title, image_url")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(8);

    if (error) {
      // Tabela ainda não criada no banco — retorna vazio sem logar como erro grave
      if (error.code === "42P01") {
        return Response.json({ news: [] });
      }
      console.error("Erro ao carregar notícias:", error.message);
      return Response.json({ news: [] });
    }

    return Response.json({
      news: (data || []).map((item) => ({
        id: String(item.id),
        title: item.title,
        image: item.image_url,
      })),
    });
  } catch (err) {
    console.error("Erro ao carregar notícias:", err);
    return Response.json({ news: [] });
  }
}

// POST: Adiciona nova notícia
export async function POST(request) {
  const db = getDb();
  if (!db) {
    return Response.json(
      { error: "Banco de dados não configurado." },
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

    const { data, error } = await db
      .from("news")
      .insert({ title: title.trim(), image_url: imageData })
      .select("id, title, image_url")
      .single();

    if (error) throw error;

    return Response.json({
      news: {
        id: String(data.id),
        title: data.title,
        image: data.image_url,
      },
    });
  } catch (err) {
    return Response.json(
      { error: err.message || "Erro ao salvar notícia." },
      { status: 500 }
    );
  }
}

// DELETE: Remove (desativa) uma notícia por ID
export async function DELETE(request) {
  const db = getDb();
  if (!db) {
    return Response.json(
      { error: "Banco de dados não configurado." },
      { status: 503 }
    );
  }

  try {
    const id = Number(new URL(request.url).searchParams.get("id"));

    if (!Number.isInteger(id) || id < 1) {
      return Response.json({ error: "ID inválido." }, { status: 400 });
    }

    const { error } = await db
      .from("news")
      .update({ active: false })
      .eq("id", id);

    if (error) throw error;

    return Response.json({ ok: true });
  } catch (err) {
    return Response.json(
      { error: err.message || "Erro ao excluir notícia." },
      { status: 500 }
    );
  }
}
