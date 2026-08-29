-- ═══════════════════════════════════════════════════════════
-- SCRIPT PARA CRIAR USUÁRIOS INICIAIS
-- Rodar no SQL Editor do Supabase (dev e prod)
-- ═══════════════════════════════════════════════════════════

-- IMPORTANTE: Este script cria os usuários no auth.users usando a API administrativa.
-- Você precisará executar manualmente via dashboard do Supabase ou usar o CLI.

-- Alternativamente, crie os usuários via Admin Panel do Supabase:
-- https://supabase.com/dashboard → Authentication → Users → "Add user"

-- ═══════════════════════════════════════════════════════════
-- USUÁRIOS PADRÃO PARA CRIAÇÃO MANUAL
-- ═══════════════════════════════════════════════════════════

/*
1. ADMINISTRADOR
   Email: admin@sistema.local
   Senha: admin123
   Role: admin
   Setor: (nenhum)

2. ATENDIMENTO RECEPÇÃO
   Email: recepcao@sistema.local
   Senha: recepcao123
   Role: attendant
   Setor: recepcao

3. ATENDIMENTO FARMÁCIA
   Email: farmacia@sistema.local
   Senha: farmacia123
   Role: attendant
   Setor: farmacia
*/

-- ═══════════════════════════════════════════════════════════
-- INSTRUÇÕES PARA CRIAR VIA INTERFACE DO ADMIN
-- ═══════════════════════════════════════════════════════════

-- 1. Acesse o painel admin do sistema em /admin
-- 2. Clique em "+ Novo usuário"
-- 3. Preencha os dados de cada usuário acima
-- 4. Os usuários serão criados automaticamente nas tabelas auth.users e profiles

-- ═══════════════════════════════════════════════════════════
-- SCRIPT SQL PARA VERIFICAR USUÁRIOS EXISTENTES
-- ═══════════════════════════════════════════════════════════

SELECT 
  p.id,
  u.email,
  p.full_name,
  p.role,
  p.sector_id,
  p.created_at
FROM public.profiles p
LEFT JOIN auth.users u ON u.id = p.id
ORDER BY p.created_at DESC;

-- ═══════════════════════════════════════════════════════════
-- GARANTIR QUE OS SETORES EXISTEM
-- ═══════════════════════════════════════════════════════════

INSERT INTO public.sectors (id, name)
VALUES 
  ('farmacia', 'Farmácia'),
  ('recepcao', 'Recepção Saúde')
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════
-- NOTA SOBRE SENHAS
-- ═══════════════════════════════════════════════════════════

-- As senhas são gerenciadas pelo Supabase Auth e ficam criptografadas
-- na tabela auth.users (não acessível via SQL direto).

-- Para alterar a senha de um usuário:
-- 1. Use a interface do admin para deletar e recriar
-- 2. Ou use o Supabase Dashboard → Authentication → Users → ⋯ → Reset Password
