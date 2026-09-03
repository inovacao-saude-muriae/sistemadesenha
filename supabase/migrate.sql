-- ============================================================
-- MIGRAÇÃO — rodar nos dois bancos (dev e prod) no SQL Editor
-- Só adiciona o que falta, não quebra o que já existe
-- ============================================================

-- ── 0. Username dos usuários ──
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists guiche_id text not null default 'none';
alter table public.profiles add column if not exists active boolean not null default true;

alter table public.profiles drop constraint if exists profiles_guiche_id_check;
alter table public.profiles add constraint profiles_guiche_id_check
  check (guiche_id in ('none', 'guiche-1', 'guiche-2', 'guiche-3', 'guiche-4'));

create unique index if not exists profiles_username_unique_idx
  on public.profiles (lower(username))
  where username is not null;

-- ── 1. Tabela de sequências de fila (substitui queue_counters) ──
create table if not exists public.queue_sequences (
  sector_id    text    not null references public.sectors(id),
  call_type    text    not null check (call_type in ('normal', 'preferencial')),
  current_number integer not null default 0 check (current_number between 0 and 1000),
  updated_at   timestamptz not null default now(),
  primary key (sector_id, call_type)
);

-- Popula com os setores existentes
insert into public.queue_sequences (sector_id, call_type)
select s.id, t.call_type
from public.sectors s
cross join (values ('normal'), ('preferencial')) as t(call_type)
on conflict (sector_id, call_type) do nothing;

-- ── 2. Tabela de notícias ──
create table if not exists public.news (
  id         bigint generated always as identity primary key,
  title      text    not null,
  image_url  text    not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── 3. Bucket de imagens (Storage) ──
insert into storage.buckets (id, name, public)
values ('news-images', 'news-images', true)
on conflict (id) do nothing;

-- ── 4. Políticas RLS para news ──
alter table public.news enable row level security;

drop policy if exists "news leitura publica"    on public.news;
drop policy if exists "news service_role grava" on public.news;

create policy "news leitura publica"
  on public.news for select
  using (active = true);

create policy "news service_role grava"
  on public.news for all
  to service_role
  using (true)
  with check (true);

-- ── 5. Políticas RLS para o Storage ──
drop policy if exists "storage leitura publica"    on storage.objects;
drop policy if exists "storage service_role upload" on storage.objects;
drop policy if exists "storage service_role delete" on storage.objects;

create policy "storage leitura publica"
  on storage.objects for select
  using (bucket_id = 'news-images');

create policy "storage service_role upload"
  on storage.objects for insert
  to service_role
  with check (bucket_id = 'news-images');

create policy "storage service_role delete"
  on storage.objects for delete
  to service_role
  using (bucket_id = 'news-images');

-- ── 6. RLS nas tabelas existentes (caso não tenha) ──
alter table public.queue_calls enable row level security;
alter table public.sectors     enable row level security;
alter table public.profiles    enable row level security;

drop policy if exists "authenticated can read sectors" on public.sectors;
create policy "authenticated can read sectors"
  on public.sectors for select to authenticated using (true);

drop policy if exists "monitors can read calls" on public.queue_calls;
create policy "monitors can read calls"
  on public.queue_calls for select using (true);

drop policy if exists "service_role insert calls" on public.queue_calls;
create policy "service_role insert calls"
  on public.queue_calls for all
  to service_role
  using (true) with check (true);

-- ── 7. Função atômica call_queue ──
create or replace function public.call_queue(p_sector_id text, p_call_type text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  next_num  integer;
  normalized text;
begin
  normalized := case
    when p_call_type in ('preferencial', 'preferential') then 'preferencial'
    else 'normal'
  end;

  insert into public.queue_sequences (sector_id, call_type, current_number, updated_at)
  values (p_sector_id, normalized, 1, now())
  on conflict (sector_id, call_type)
  do update set
    current_number = case
      when public.queue_sequences.current_number >= 1000 then 1
      else public.queue_sequences.current_number + 1
    end,
    updated_at = now()
  returning current_number into next_num;

  return jsonb_build_object('number', next_num, 'call_type', normalized);
end;
$$;

grant execute on function public.call_queue(text, text) to service_role;

-- ── 8. Realtime na tabela queue_calls ──
alter table public.queue_calls replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and tablename = 'queue_calls'
  ) then
    alter publication supabase_realtime add table public.queue_calls;
  end if;
end $$;

-- ── 9. Índices de performance ──
create index if not exists queue_calls_sector_created_idx
  on public.queue_calls (sector_id, created_at desc);

create index if not exists queue_calls_type_idx
  on public.queue_calls (type);
