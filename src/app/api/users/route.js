import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/* ─────────────────────────────────────────────────
   GET — lista todos os usuários Supabase
───────────────────────────────────────────────── */
export async function GET() {
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Supabase não configurado" },
      { status: 503 }
    );
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, role, sector_id")
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ users: data || [] });
  } catch (err) {
    console.error("Erro ao listar usuários:", err);
    return NextResponse.json(
      { error: err.message || "Erro ao listar usuários" },
      { status: 500 }
    );
  }
}

/* ─────────────────────────────────────────────────
   POST — cria novo usuário no Supabase Auth + Profile
───────────────────────────────────────────────── */
export async function POST(request) {
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Supabase não configurado" },
      { status: 503 }
    );
  }

  try {
    const body = await request.json();
    const { email, password, full_name, role, sector_id } = body;

    if (!email || !password || !full_name) {
      return NextResponse.json(
        { error: "Email, senha e nome completo são obrigatórios" },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Cria usuário no Auth
    const { data: authData, error: authError } =
      await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });

    if (authError) throw authError;

    // Cria profile
    const { error: profileError } = await supabase.from("profiles").insert({
      id: authData.user.id,
      full_name,
      role: role || "attendant",
      sector_id: sector_id || null,
    });

    if (profileError) {
      // Rollback: deleta o usuário do auth
      await supabase.auth.admin.deleteUser(authData.user.id);
      throw profileError;
    }

    return NextResponse.json({
      success: true,
      user: {
        id: authData.user.id,
        email,
        full_name,
        role: role || "attendant",
        sector_id,
      },
    });
  } catch (err) {
    console.error("Erro ao criar usuário:", err);
    return NextResponse.json(
      { error: err.message || "Erro ao criar usuário" },
      { status: 500 }
    );
  }
}

/* ─────────────────────────────────────────────────
   DELETE — remove usuário do Auth e Profile
───────────────────────────────────────────────── */
export async function DELETE(request) {
  if (!supabaseUrl || !supabaseServiceKey) {
    return NextResponse.json(
      { error: "Supabase não configurado" },
      { status: 503 }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("id");

    if (!userId) {
      return NextResponse.json(
        { error: "ID do usuário é obrigatório" },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Remove profile
    const { error: profileError } = await supabase
      .from("profiles")
      .delete()
      .eq("id", userId);

    if (profileError) throw profileError;

    // Remove do auth
    const { error: authError } = await supabase.auth.admin.deleteUser(userId);

    if (authError) throw authError;

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Erro ao excluir usuário:", err);
    return NextResponse.json(
      { error: err.message || "Erro ao excluir usuário" },
      { status: 500 }
    );
  }
}
