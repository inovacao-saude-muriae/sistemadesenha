import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

const BUCKET = "news-images";

function getDb() {
  if (isSupabaseAdminConfigured && supabaseAdmin) return supabaseAdmin;
  if (isSupabaseConfigured && supabase) return supabase;
  return null;
}

// GET — lista notícias ativas
export async function GET() {
  const db = getDb();
  if (!db) return Response.json({ news: [] });

  try {
    const { data, error } = await db
      .from("news")
      .select("id, title, image_url")
      .eq("active", true)
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) {
      if (error.code === "42P01") return Response.json({ news: [] });
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

// POST — faz upload da imagem para o Storage e salva a URL no banco
export async function POST(request) {
  const db = getDb();
  if (!db) return Response.json({ error: "Banco não configurado." }, { status: 503 });

  try {
    const formData   = await request.formData();
    const title      = String(formData.get("title") || "").trim();
    const file       = formData.get("image"); // File object

    if (!title) {
      return Response.json({ error: "Informe um título." }, { status: 400 });
    }

    if (!file || typeof file === "string") {
      return Response.json({ error: "Envie um arquivo de imagem." }, { status: 400 });
    }

    // Validação de tipo e tamanho (máx 5 MB)
    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
    if (!allowedTypes.includes(file.type)) {
      return Response.json({ error: "Formato inválido. Use JPG, PNG, WEBP ou GIF." }, { status: 400 });
    }
    if (file.size > 5 * 1024 * 1024) {
      return Response.json({ error: "A imagem deve ter no máximo 5 MB." }, { status: 400 });
    }

    // Gera nome único para o arquivo
    const ext      = file.name.split(".").pop().toLowerCase() || "jpg";
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const buffer   = Buffer.from(await file.arrayBuffer());

    // Upload para o Supabase Storage
    const { error: uploadError } = await db.storage
      .from(BUCKET)
      .upload(fileName, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) throw new Error(`Upload falhou: ${uploadError.message}`);

    // URL pública do arquivo
    const { data: urlData } = db.storage.from(BUCKET).getPublicUrl(fileName);
    const imageUrl = urlData?.publicUrl;

    if (!imageUrl) throw new Error("Não foi possível obter a URL pública da imagem.");

    // Salva no banco
    const { data, error: dbError } = await db
      .from("news")
      .insert({ title, image_url: imageUrl })
      .select("id, title, image_url")
      .single();

    if (dbError) {
      // Tenta limpar o arquivo que foi enviado
      await db.storage.from(BUCKET).remove([fileName]).catch(() => {});
      throw dbError;
    }

    return Response.json({
      news: { id: String(data.id), title: data.title, image: data.image_url },
    });
  } catch (err) {
    console.error("Erro ao salvar notícia:", err);
    return Response.json({ error: err.message || "Erro ao salvar notícia." }, { status: 500 });
  }
}

// DELETE — desativa notícia (soft delete) e remove imagem do Storage
export async function DELETE(request) {
  const db = getDb();
  if (!db) return Response.json({ error: "Banco não configurado." }, { status: 503 });

  try {
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id < 1) {
      return Response.json({ error: "ID inválido." }, { status: 400 });
    }

    // Busca a URL para remover do Storage
    const { data: row } = await db
      .from("news")
      .select("image_url")
      .eq("id", id)
      .maybeSingle();

    // Soft delete no banco
    const { error } = await db.from("news").update({ active: false }).eq("id", id);
    if (error) throw error;

    // Remove do Storage se for uma URL do bucket (não base64 legado)
    if (row?.image_url && row.image_url.includes(BUCKET)) {
      const parts   = row.image_url.split(`/${BUCKET}/`);
      const filePath = parts[1];
      if (filePath) {
        await db.storage.from(BUCKET).remove([filePath]).catch(() => {});
      }
    }

    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message || "Erro ao excluir." }, { status: 500 });
  }
}
