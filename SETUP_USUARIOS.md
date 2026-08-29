# Configuração de Usuários

Todos os usuários do sistema são gerenciados no banco de dados Supabase.

## 📋 Estrutura

- **Tabela**: `public.profiles` (vinculada ao `auth.users`)
- **Campos**:
  - `id` — UUID do usuário (vem do auth.users)
  - `full_name` — Nome completo
  - `role` — Função: `admin` ou `attendant`
  - `sector_id` — Setor vinculado (farmacia, recepcao, ou null)

## 🔐 Primeiro Acesso

### Opção 1: Criar via Supabase Dashboard

1. Acesse seu projeto no [Supabase Dashboard](https://supabase.com/dashboard)
2. Vá em **Authentication → Users**
3. Clique em **"Add user"**
4. Preencha:
   - **Email**: `admin@sistema.local`
   - **Password**: `admin123`
   - **Auto Confirm User**: ✅ (marque esta opção)
5. Após criar, vá em **Table Editor → profiles**
6. Adicione um registro:
   ```sql
   INSERT INTO profiles (id, full_name, role, sector_id)
   VALUES 
     ('UUID_DO_USUARIO_CRIADO', 'Administrador', 'admin', null);
   ```

### Opção 2: Criar via SQL Editor

Execute no **SQL Editor** do Supabase:

```sql
-- 1. Garantir que os setores existem
INSERT INTO public.sectors (id, name)
VALUES 
  ('farmacia', 'Farmácia'),
  ('recepcao', 'Recepção Saúde')
ON CONFLICT (id) DO NOTHING;

-- 2. Criar usuário admin via dashboard (veja Opção 1)
--    Email: admin@sistema.local
--    Senha: admin123

-- 3. Após criar, adicionar o profile
--    (substitua 'UUID_AQUI' pelo ID real do usuário criado)
INSERT INTO public.profiles (id, full_name, role, sector_id)
VALUES 
  ('UUID_AQUI', 'Administrador', 'admin', null);
```

### Opção 3: Criar via Interface do Sistema (após ter 1 admin)

1. Faça login com o admin criado
2. Acesse **/admin**
3. Role até **"Gerenciamento de usuários"**
4. Clique em **"+ Novo usuário"**
5. Preencha o formulário:
   - **Email**: pode ser email real ou formato `nome@sistema.local`
   - **Senha**: defina uma senha segura
   - **Nome completo**: nome do usuário
   - **Função**: admin ou attendant
   - **Setor**: escolha farmacia/recepcao ou deixe vazio

## 👥 Usuários Sugeridos

Após ter um admin, crie os demais usuários via interface:

| Email | Senha | Nome | Função | Setor |
|-------|-------|------|--------|-------|
| `admin@sistema.local` | `admin123` | Administrador | admin | — |
| `recepcao@sistema.local` | `recepcao123` | Atendimento Recepção | attendant | recepcao |
| `farmacia@sistema.local` | `farmacia123` | Atendimento Farmácia | attendant | farmacia |

## 🔄 Gerenciamento

### Ver usuários cadastrados
```sql
SELECT 
  p.id,
  u.email,
  p.full_name,
  p.role,
  p.sector_id
FROM public.profiles p
LEFT JOIN auth.users u ON u.id = p.id
ORDER BY p.created_at DESC;
```

### Deletar usuário
Via interface do admin ou SQL:
```sql
-- Remove profile
DELETE FROM public.profiles WHERE id = 'UUID_DO_USUARIO';

-- Remove do auth (via Dashboard → Authentication → Users → Delete)
```

### Alterar senha
- **Via Dashboard**: Authentication → Users → ⋯ → Reset Password
- **Via API**: use a interface do admin para deletar e recriar o usuário

## 📝 Notas

- ⚠️ **Não existem mais usuários hard-coded no código**
- ✅ Todos os usuários devem ser criados no banco de dados
- 🔒 Senhas são criptografadas pelo Supabase Auth
- 📧 Login aceita email completo ou apenas o nome antes do @ (ex: `admin` → `admin@central-atendimento.local`)
