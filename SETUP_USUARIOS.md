# Configuração de Usuários

Todos os usuários do sistema são gerenciados no banco de dados Supabase.

## 📋 Estrutura

- **Tabela**: `public.profiles` (vinculada ao `auth.users`)
- **Campos**:
  - `id` — UUID do usuário (vem do auth.users)
  - `username` — identificador de acesso, no formato `nome.sobrenome`
  - `full_name` — Nome completo
  - `role` — Função: `admin` ou `attendant`
  - `sector_id` — Setor vinculado (farmacia, recepcao, ou null)

## 🔐 Primeiro Acesso

### Opção 1: Criar via Supabase Dashboard

> O Supabase Auth exige um e-mail neste formulário. Use o e-mail institucional real; ele ficará vinculado ao usuário `admin`, mas o login do sistema continuará sendo apenas `admin`.

1. Acesse seu projeto no [Supabase Dashboard](https://supabase.com/dashboard)
2. Vá em **Authentication → Users**
3. Clique em **"Add user"**
4. Preencha:

- **E-mail**: `programasti.saude@muriae.mg.gov.br`
- **Senha**: defina uma senha segura (exemplo de desenvolvimento: `admin123`)
- **Auto Confirm User**: marque esta opção

5. Após criar, vá em **Table Editor → profiles**
6. Adicione um registro:

   ```sql
   -- Execute antes, caso o banco ainda não tenha a coluna username:
   ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username text;
   ```

INSERT INTO public.profiles (id, username, full_name, role, sector_id)
VALUES ('COLE_AQUI_O_UUID_DO_AUTH', 'admin', 'Administrador', 'admin', NULL)
ON CONFLICT (id) DO UPDATE SET
username = EXCLUDED.username,
full_name = EXCLUDED.full_name,
role = EXCLUDED.role,
sector_id = EXCLUDED.sector_id,
active = true;

````

### Opção 2: Criar via SQL Editor

Execute no **SQL Editor** do Supabase:

```sql
-- 1. Garantir que os setores existem
INSERT INTO public.sectors (id, name)
VALUES
('farmacia', 'Farmácia'),
('recepcao', 'Recepção Saúde')
ON CONFLICT (id) DO NOTHING;

-- 2. O Auth não permite criar senha apenas com SQL neste fluxo.
--    Crie no Dashboard usando o e-mail real:
--    programasti.saude@muriae.mg.gov.br
--    O username usado no sistema será apenas: admin

-- 3. No Authentication → Users, copie o UUID do usuário criado e use-o abaixo
INSERT INTO public.profiles (id, username, full_name, role, sector_id)
VALUES ('COLE_AQUI_O_UUID_DO_AUTH', 'admin', 'Administrador', 'admin', NULL)
ON CONFLICT (id) DO UPDATE SET
username = EXCLUDED.username,
full_name = EXCLUDED.full_name,
role = EXCLUDED.role,
sector_id = EXCLUDED.sector_id,
active = true;
````

### Opção 3: Criar via Interface do Sistema (após ter 1 admin)

1. Faça login com o admin criado
2. Acesse **/admin**
3. Role até **"Gerenciamento de usuários"**
4. Clique em **"+ Novo usuário"**
5. Preencha o formulário:

- **Usuário**: formato `nome.sobrenome`
- **Senha**: defina uma senha segura
- **Nome completo**: nome do usuário
- **Função**: admin ou attendant
- **Setor**: escolha farmacia/recepcao ou deixe vazio

## 👥 Usuários Sugeridos

Após ter um admin, crie os demais usuários via interface:

| Usuário    | Senha         | Nome                 | Função    | Setor    |
| ---------- | ------------- | -------------------- | --------- | -------- |
| `admin`    | `admin123`    | Administrador        | admin     | —        |
| `recepcao` | `recepcao123` | Atendimento Recepção | attendant | recepcao |
| `farmacia` | `farmacia123` | Atendimento Farmácia | attendant | farmacia |

## 🔄 Gerenciamento

### Ver usuários cadastrados

```sql
SELECT
  p.id,
  p.username,
  p.full_name,
  p.role,
  p.sector_id
FROM public.profiles p
ORDER BY p.created_at DESC;
```

> O e-mail do Auth deve ser consultado em **Authentication → Users** no Supabase. Não conceda `SELECT` em `auth.users` para usuários comuns.

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
- 🔑 Login aceita somente o username, por exemplo `nome.sobrenome`
- ⚙️ O e-mail do Auth fica vinculado internamente ao perfil, mas o usuário acessa usando apenas o username
