import {
  supabaseAdmin,
  isSupabaseAdminConfigured,
} from "../../../lib/supabase-admin";

export async function POST(request) {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    return Response.json(
      { error: "Supabase não está configurado no servidor." },
      { status: 503 },
    );
  }
  try {
    const {
      name,
      login,
      password,
      sector,
      guiche = "none",
    } = await request.json();
    const normalizedLogin = String(login || "")
      .trim()
      .toLowerCase();
    const validGuiches = [
      "none",
      "guiche-1",
      "guiche-2",
      "guiche-3",
      "guiche-4",
    ];
    if (
      !name?.trim() ||
      !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(normalizedLogin) ||
      String(password || "").length < 6 ||
      !["farmacia", "recepcao"].includes(sector) ||
      !validGuiches.includes(guiche)
    ) {
      return Response.json(
        { error: "Informe nome, login válido, senha, setor e guichê válidos." },
        { status: 400 },
      );
    }
    const email = `${normalizedLogin}@central-atendimento.local`;
    const { data: created, error: authError } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: name.trim(),
          sector_id: sector,
          guiche_id: guiche,
        },
      });
    if (authError)
      return Response.json({ error: authError.message }, { status: 400 });
    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .insert({
        id: created.user.id,
        full_name: name.trim(),
        role: "attendant",
        sector_id: sector,
        guiche_id: guiche,
      });
    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      return Response.json({ error: profileError.message }, { status: 400 });
    }
    return Response.json({
      id: created.user.id,
      name: name.trim(),
      login: normalizedLogin,
      sector,
      guiche,
    });
  } catch {
    return Response.json(
      { error: "Não foi possível criar o usuário." },
      { status: 400 },
    );
  }
}
