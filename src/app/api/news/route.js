import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

const BUCKET = "news-images";

function getDb() {
  if (isSupabaseAdminConfigured && supabaseAdmin) return supabaseAdmin;
  if (isSupabaseConfigured && supabase) return supabase;
  return null;
}

// Retorna lista de candidatos JWT para o Storage, do mais privilegiado ao menos
// Testa SERVICE_JWT (legado service_role), depois ANON_JWT (legado anon),
// depois SERVICE_ROLE_KEY (caso seja JWT clássico) e ANON_KEY (caso seja JWT)
function getStorageJwtCandidates() {
  const candidates = [
    process.env.SUPABASE_SERVICE_JWT,
    process.env.SUPABASE_ANON_JWT,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  ];
  // Filtra: só aceita JWTs clássicos (eyJ...) — o Storage rejeita sb_secret_*
  return candidates.filter(
    (k) => k && /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(k)
  );
}

// Tenta o upload com cada candidato JWT até um funcionar
async function uploadToStorage(fileName, buffer, contentType) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const candidates  = getStorageJwtCandidates();

  if (!supabaseUrl || candidates.length === 0) {
    throw new Error("Nenhuma chave JWT disponível para o Storage.");
  }

  let lastError = "";
  for (const jwt of candidates) {
    const res = await fetch(
      `${supabaseUrl}/storage/v1/object/${BUCKET}/${fileName}`,
      {
        method:  "POST",
        headers: {
          "apikey":        jwt,
          "Authorization": `Bearer ${jwt}`,
          "Content-Type":  contentType,
          "x-upsert":      "false",
        },
        body: buffer,
      }
    );

    if (res.ok) {
      return `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${fileName}`;
    }

    lastError = await res.text().catch(() => res.statusText);
    // Se não for problema de autenticação, não tenta próxima chave
    if (!res.status.toString().startsWith("4")) break;
  }

  throw new Error(`Upload falhou: ${lastError}`);
}

async function deleteFromStorage(filePath) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const candidates  = getStorageJwtCandidates();
  if (!supabaseUrl || candidates.length === 0) return;

  for (const jwt of candidates) {
    const res = await fetch(
      `${supabaseUrl}/storage/v1/object/${BUCKET}/${filePath}`,
      {
        method:  "DELETE",
        headers: { "apikey": jwt, "Authorization": `Bearer ${jwt}` },
      }
    );
    if (res.ok) return;
  }
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
        id:    String(item.id),
        title: item.title,
        image: item.image_url,
      })),
    });
  } catch (err) {
    console.error("Erro ao carregar notícias:", err);
    return Response.json({ news: [] });
  }
}

// POST — upload da imagem para o Storage e salva URL no banco
export async function POST(request) {
  const db = getDb();
  if (!db) return Response.json({ error: "Banco não configurado." }, { status: 503 });

  try {
    const formData = await request.formData();
    const title    = String(formData.get("title") || "").trim();
    const file     = formData.get("image");

    if (!title) {
      return Response.json({ error: "Informe um título." }, { status: 400 });
    }
    if (!file || typeof file === "string") {
      return Response.json({ error: "Envie um arquivo de imagem." }, { status: 400 });
    }

    const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
    if (!allowedTypes.includes(file.type)) {
      return Response.json({ error: "Formato inválido. Use JPG, PNG, WEBP ou GIF." }, { status: 400 });
    }
    if (file.size > 5 * 1024 * 1024) {
      return Response.json({ error: "Imagem deve ter no máximo 5 MB." }, { status: 400 });
    }

    const ext      = (file.name.split(".").pop() || "jpg").toLowerCase();
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const buffer   = Buffer.from(await file.arrayBuffer());

    const imageUrl = await uploadToStorage(fileName, buffer, file.type);

    // Salva no banco
    const { data, error: dbError } = await db
      .from("news")
      .insert({ title, image_url: imageUrl })
      .select("id, title, image_url")
      .single();

    if (dbError) {
      await deleteFromStorage(fileName);
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

// DELETE — soft delete no banco + remove arquivo do Storage
export async function DELETE(request) {
  const db = getDb();
  if (!db) return Response.json({ error: "Banco não configurado." }, { status: 503 });

  try {
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id < 1) {
      return Response.json({ error: "ID inválido." }, { status: 400 });
    }

    const { data: row } = await db
      .from("news")
      .select("image_url")
      .eq("id", id)
      .maybeSingle();

    const { error } = await db.from("news").update({ active: false }).eq("id", id);
    if (error) throw error;

    if (row?.image_url?.includes(`/${BUCKET}/`)) {
      const filePath = row.image_url.split(`/${BUCKET}/`)[1];
      if (filePath) await deleteFromStorage(filePath);
    }

    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: err.message || "Erro ao excluir." }, { status: 500 });
  }
}
