import { createAuthClient, isSupabaseConfigured } from "../../../lib/supabase";
import {
  isSupabaseAdminConfigured,
  supabaseAdmin,
} from "../../../lib/supabase-admin";

export async function POST(request) {
  if (!isSupabaseConfigured) {
    return Response.json(
      { error: "Supabase não está configurado." },
      { status: 503 },
    );
  }

  const supabase = createAuthClient();
  if (!supabase) {
    return Response.json(
      { error: "Supabase não está configurado." },
      { status: 503 },
    );
  }

  try {
    const { login, password } = await request.json();
    const email = String(login || "").trim().toLowerCase();
    
    // Se não contém @, adiciona domínio padrão (compatibilidade)
    const loginEmail = email.includes("@") 
      ? email 
      : `${email}@central-atendimento.local`;

    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password,
    });
    
    if (error || !data.user) {
      return Response.json(
        { error: "Login ou senha inválidos." },
        { status: 401 },
      );
    }

    const profileClient =
      isSupabaseAdminConfigured && supabaseAdmin ? supabaseAdmin : supabase;
    const { data: profile, error: profileError } = await profileClient
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
      id: data.user.id,
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
