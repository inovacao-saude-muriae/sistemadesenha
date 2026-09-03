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
    const username = String(login || "")
      .trim()
      .toLowerCase();
    if (!/^[a-z0-9]+(?:[._][a-z0-9]+)*$/.test(username)) {
      return Response.json(
        { error: "Usuário inválido. Use nome.sobrenome." },
        { status: 400 },
      );
    }

    let loginEmail = `${username}@central-atendimento.local`;
    if (isSupabaseAdminConfigured && supabaseAdmin) {
      const { data: usernameProfile, error: usernameError } =
        await supabaseAdmin
          .from("profiles")
          .select("id")
          .ilike("username", username)
          .maybeSingle();

      if (usernameError || !usernameProfile) {
        console.error("Login: username não encontrado", {
          username,
          error: usernameError?.message,
        });
        if (usernameError?.message?.toLowerCase().includes("invalid api key")) {
          return Response.json(
            { error: "Configuração do Supabase inválida no servidor." },
            { status: 503 },
          );
        }
        return Response.json(
          { error: "Login ou senha inválidos." },
          { status: 401 },
        );
      }

      const { data: authUser, error: authUserError } =
        await supabaseAdmin.auth.admin.getUserById(usernameProfile.id);
      if (authUserError || !authUser.user?.email) {
        console.error("Login: usuário Auth não encontrado", {
          profileId: usernameProfile.id,
          error: authUserError?.message,
        });
        return Response.json(
          { error: "Login ou senha inválidos." },
          { status: 401 },
        );
      }
      loginEmail = authUser.user.email;
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password,
    });

    if (error || !data.user) {
      console.error("Login: senha ou usuário rejeitado pelo Supabase Auth", {
        email: loginEmail,
        error: error?.message,
      });
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
    if (profileError || !profile?.active) {
      console.error("Login: perfil sem acesso ativo", {
        userId: data.user.id,
        error: profileError?.message,
        active: profile?.active,
      });
      return Response.json(
        { error: "Usuário sem acesso ativo." },
        { status: 403 },
      );
    }
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
