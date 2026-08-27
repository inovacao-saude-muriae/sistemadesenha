import { supabaseAdmin } from "../../../lib/supabase-admin";

export async function POST(request) {
  try {
    const formData = await request.formData();
    const title = formData.get("title");
    const file = formData.get("file");

    if (!title || !file) {
      return Response.json({ error: "Título e imagem são obrigatórios." }, { status: 400 });
    }

    // 1. Upload da imagem para o Supabase Storage Bucket
    const fileExt = file.name.split(".").pop();
    const fileName = `${Date.now()}.${fileExt}`;
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from("news-images")
      .upload(fileName, file, { contentType: file.type });

    if (uploadError) throw uploadError;

    // 2. Obter a URL pública do arquivo
    const { data: urlData } = supabaseAdmin.storage
      .from("news-images")
      .getPublicUrl(fileName);

    const imageUrl = urlData.publicUrl;

    // 3. Salvar no banco apenas a URL leve
    const { data: news, error: dbError } = await supabaseAdmin
      .from("news")
      .insert({ title, image_url: imageUrl })
      .select()
      .single();

    if (dbError) throw dbError;

    return Response.json({ news });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}