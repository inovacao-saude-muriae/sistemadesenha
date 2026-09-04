This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Supabase

Copy `.env.example` to `.env.local` and fill in the URL, anon key and service role key from the Supabase project. Then run `supabase/schema.sql` in the Supabase SQL Editor. The service role key is used only by server routes for creating users and storing news images; never expose it as a `NEXT_PUBLIC_` variable.

## Produção

1. Crie ou selecione o projeto Supabase de produção e execute `supabase/schema.sql` no SQL Editor. Para um banco que já existe, execute também `supabase/migrate.sql`. Confirme que o bucket público `news-images` e o Realtime de `queue_calls` estão ativos.
2. No provedor de hospedagem, cadastre estas variáveis para o ambiente de produção antes do build:
   - `DATABASE_URL`: conexão pooler do Supabase, normalmente com `pgbouncer=true`.
   - `DIRECT_URL`: conexão direta do Supabase, usada pelo Prisma.
   - `NEXT_PUBLIC_SUPABASE_URL`: URL do projeto de produção.
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: chave publicável/anon do projeto de produção.
   - `SUPABASE_SERVICE_ROLE_KEY`: chave secreta/service role do projeto de produção, sem o prefixo `NEXT_PUBLIC_`.

3. Faça o deploy com Node.js 22 ou superior:

   ```bash
   npm ci
   npm run build
   npm start
   ```

   Em Vercel, use `npm run build` como Build Command; o Start Command é gerenciado pela plataforma. Em outro servidor, mantenha `npm start` em execução e encaminhe a porta definida por `PORT`.

4. Crie os usuários no projeto de produção e confira o login, chamada de senha, monitoramento e upload de notícia. As variáveis `NEXT_PUBLIC_*` são incorporadas durante o build, portanto uma alteração nelas exige um novo deploy.

As credenciais que já tenham sido publicadas em qualquer cópia deste projeto devem ser revogadas no Supabase e substituídas por novas chaves. Nunca versione `.env`, `.env.local` ou chaves service role.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
