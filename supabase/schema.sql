create table if not exists public.sectors (
  id text primary key check (id in ('farmacia', 'recepcao')),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null default 'attendant' check (role in ('admin', 'attendant')),
  sector_id text references public.sectors(id),
  guiche_id text not null default 'none' check (guiche_id in ('none', 'guiche-1', 'guiche-2', 'guiche-3', 'guiche-4')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists guiche_id text not null default 'none';
alter table public.profiles drop constraint if exists profiles_guiche_id_check;
alter table public.profiles add constraint profiles_guiche_id_check check (guiche_id in ('none', 'guiche-1', 'guiche-2', 'guiche-3', 'guiche-4'));

create table if not exists public.queues (
  sector_id text primary key references public.sectors(id),
  current_number integer not null default 0 check (current_number between 0 and 1000),
  updated_at timestamptz not null default now()
);

create table if not exists public.queue_calls (
  id bigint generated always as identity primary key,
  sector_id text not null references public.sectors(id),
  number integer not null check (number between 1 and 1000),
  call_type text not null check (call_type in ('normal', 'preferencial')),
  status text not null default 'called' check (status in ('called', 'served', 'cancelled')),
  attendant_id uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  sound_enabled boolean not null default true
);

create table if not exists public.news (
  id bigint generated always as identity primary key,
  title text not null,
  image_url text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into storage.buckets (id, name, public) values ('news-images', 'news-images', true) on conflict (id) do nothing;

insert into public.sectors (id, name) values ('farmacia', 'Farmácia'), ('recepcao', 'Recepção Saúde') on conflict (id) do nothing;
insert into public.queues (sector_id) values ('farmacia'), ('recepcao') on conflict (sector_id) do nothing;

create index if not exists queue_calls_sector_created_idx on public.queue_calls (sector_id, created_at desc);
create index if not exists queue_calls_status_idx on public.queue_calls (status);

alter table public.sectors enable row level security;
alter table public.profiles enable row level security;
alter table public.queues enable row level security;
alter table public.queue_calls enable row level security;
alter table public.settings enable row level security;
alter table public.news enable row level security;

create or replace function public.my_sector() returns text language sql stable security definer set search_path = public as $$
  select sector_id from public.profiles where id = auth.uid() and active = true;
$$;

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and active = true);
$$;

create policy "authenticated can read sectors" on public.sectors for select to authenticated using (true);
create policy "users read own profile" on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "sector queues are private" on public.queues for select to authenticated using (sector_id = public.my_sector() or public.is_admin());
create policy "attendants update own queue" on public.queues for update to authenticated using (sector_id = public.my_sector() or public.is_admin()) with check (sector_id = public.my_sector() or public.is_admin());
create policy "sector calls are private" on public.queue_calls for select to authenticated using (sector_id = public.my_sector() or public.is_admin());
create policy "attendants insert calls" on public.queue_calls for insert to authenticated with check (sector_id = public.my_sector() and attendant_id = auth.uid());
create policy "users manage own settings" on public.settings for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.queue_calls replica identity full;
alter publication supabase_realtime add table public.queue_calls;