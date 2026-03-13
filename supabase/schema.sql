create table if not exists public.alchemy_combinations (
  pair_key text primary key,
  first_element text not null,
  second_element text not null,
  element text not null,
  emoji text not null,
  flavor_text text,
  source text not null default 'openai',
  model text,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.alchemy_combinations
  add column if not exists flavor_text text;

create unique index if not exists alchemy_combinations_pair_key_idx
  on public.alchemy_combinations (pair_key);

alter table public.alchemy_combinations enable row level security;

drop policy if exists "Public can read combinations" on public.alchemy_combinations;
create policy "Public can read combinations"
  on public.alchemy_combinations
  for select
  to anon, authenticated
  using (true);

drop policy if exists "Public can insert new combinations" on public.alchemy_combinations;
create policy "Public can insert new combinations"
  on public.alchemy_combinations
  for insert
  to anon, authenticated
  with check (true);

create table if not exists public.player_states (
  user_id uuid primary key references auth.users (id) on delete cascade,
  discovered_elements jsonb not null default '[]'::jsonb,
  display_name text,
  theme text not null default 'default',
  revealed_recipe_results jsonb not null default '[]'::jsonb,
  achievements jsonb not null default '[]'::jsonb,
  world_first_discovery_count integer not null default 0,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.player_states
  add column if not exists discovered_elements jsonb not null default '[]'::jsonb,
  add column if not exists display_name text,
  add column if not exists theme text not null default 'default',
  add column if not exists revealed_recipe_results jsonb not null default '[]'::jsonb,
  add column if not exists achievements jsonb not null default '[]'::jsonb,
  add column if not exists world_first_discovery_count integer not null default 0,
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'player_states'
      and column_name = 'elements'
  ) then
    execute $migration$
      update public.player_states
      set discovered_elements = coalesce(discovered_elements, elements, '[]'::jsonb)
    $migration$;
  end if;
end
$$;

alter table public.player_states enable row level security;

drop policy if exists "Users can read their own player state" on public.player_states;
create policy "Users can read their own player state"
  on public.player_states
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own player state" on public.player_states;
create policy "Users can insert their own player state"
  on public.player_states
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own player state" on public.player_states;
create policy "Users can update their own player state"
  on public.player_states
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
