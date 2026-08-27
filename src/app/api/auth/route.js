import { supabase, isSupabaseConfigured } from "../../../lib/supabase";

export async function POST(request) {
  if (!isSupabaseConfigured || !supabase) {
    return Response.json(
      { error: "Supabase não está configurado." },
      { status: 503 },
    );
  }

  try {
    const { login, password } = await request.json();
    const normalizedLogin = String(login || "")
      .trim()
      .toLowerCase();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: `${normalizedLogin}@central-atendimento.local`,
      password,
    });
    if (error || !data.user)
      return Response.json(
        { error: "Login ou senha inválidos." },
        { status: 401 },
      );

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("full_name, role, sector_id, guiche_id, active")
      .eq("id", data.user.id)
      .single();
    if (profileError || !profile?.active)
      return Response.json(
        { error: "Usuário sem acesso ativo." },
        { status: 403 },
      );
    return Response.json({
      name: profile.full_name,
      initials: profile.full_name
        .split(/\s+/)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase(),
      role: profile.role,
      sector: profile.sector_id,
      guiche: profile.guiche_id || "none",
    });
  } catch {
    return Response.json(
      { error: "Não foi possível validar o acesso." },
      { status: 400 },
    );
  }
}
