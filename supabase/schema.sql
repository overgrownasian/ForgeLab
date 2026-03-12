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
